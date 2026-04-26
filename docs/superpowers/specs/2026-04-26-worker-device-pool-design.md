# Worker / Device Pool — Design

Status: draft (pending user approval)
Date: 2026-04-26

## Problem

Mobilewright wraps Playwright's test runner. Playwright owns workers as parallel test processes; on test failure, it kills the worker and respawns a new one for the retry. The device fixture today is `scope: 'worker'`, so killing-and-respawning forces full device reallocation on every retry.

For mobile devices that's wasteful — and on slow remotes (e.g. `mobile-use`) it can mean a 5-minute boot/lease per retry. Two more goals stem from the same shape:

1. **N workers, N devices.** When a config asks for N parallel workers, we want N distinct devices in flight, whether local sims or remote handsets.
2. **No reallocation on retry.** A failed test should reuse an already-allocated device — we just kill and relaunch the app under test.
3. **Fast device should pick up slack.** If 1 device allocates in 1s and the rest take 10 min, the fast one should be running tests during that window rather than idling because all jobs are pre-claimed by still-allocating slots.

We cannot modify Playwright. The full implementation must live inside mobilewright.

## Goals

- Slow allocation runs at most once per pool slot per test run, regardless of test failure or retry count.
- A worker process whose device is ready can run any test queued for any worker slot, by sharing physical devices across worker processes through per-test leasing.
- Pool size grows lazily: a new allocation is started only when a waiter cannot be matched to any free slot, capped at `config.workers`. Concurrent waiters can trigger concurrent allocations (up to the cap).
- The architecture stays replaceable: HTTP transport, driver implementation, and pool storage are all swappable without touching domain logic.

## Non-goals

- Multi-project / multi-platform configs in the same run. The architecture is designed to extend to this (per-project caps via `project.workers`, criteria-based slot matching), but the first implementation targets a single global `workers` cap and a single criteria set. See "Extension points."
- Crash recovery across coordinator restarts. If the dispatcher process dies mid-run, leased remote devices may be orphaned; existing handling for that case is unchanged.
- Removing the public `ios.launch()` / `android.launch()` API. It remains the entry point for non-test scripting.
- v1 driver coverage: **`mobilecli` only.** The `mobile-use` driver couples allocation with the WebSocket connection (`fleet.allocate` happens inside `MobileUseDriver.connect()`), so a per-test fixture that connects/disconnects would re-lease on every test, defeating the design. Supporting `mobile-use` cleanly requires either a driver-level "attach to existing session" API or a coordinator-owned WS that proxies device calls — both are out of scope for this work. v1 implements `MobileUseAllocator` as a stub that throws a clear "not yet supported with the test runner; use the public `ios.launch()` API or the `mobilecli` driver" error.

## Public API surface

This design adds **no** public API. The test author's surface is identical to today:

- Imports: `import { test, expect } from '@mobilewright/test'`.
- Config: `defineConfig({ workers, retries, projects, ... })` — same Playwright concepts (`workers`, `--shard`, `retries`).
- Fixtures: `{ device, screen, bundleId, platform, deviceName }` — same names and types.

The `device` fixture's scope changes from worker to test, but scope is not part of the test author's API; they just see `device` materialize for each test, as `screen` already does.

Everything below — `DevicePool`, ports, adapters, HTTP endpoints, the `MOBILEWRIGHT_COORDINATOR_URL` env var, the auto-injected `globalSetup`/`globalTeardown` — is internal plumbing. None of it is exported from `@mobilewright/test` or `mobilewright`. Test authors should never need to know it exists.

Observable behavior changes for them:

- Slow device allocation runs at most once per pool slot per test run; retries reuse already-allocated devices.
- N workers actually use N devices in parallel.
- A device that finishes allocating early picks up tests that would otherwise wait on slower allocations.

## Architecture

The system is structured in clean-architecture layers. Dependencies point inward. Outer-layer details (HTTP, drivers) implement interfaces owned by inner layers.

| Layer | Components |
|---|---|
| Domain | `DeviceSlot` (entity, owns the state machine), `Allocation` (entity, owns one lease) |
| Application | `DevicePool` (use case — orchestrates slots, enforces cap, drives the allocator) |
| Ports (defined inward) | `DeviceAllocator`, `DevicePoolClient` |
| Adapters (outer) | `MobilecliAllocator`, `MobileUseAllocator`, `DevicePoolHttpServer`, `HttpDevicePoolClient` |
| Composition root | `device-pool/setup.ts` (auto-injected `globalSetup`) and `launchers.ts` (per-script composition) |

### Domain — `DeviceSlot`

A slot owns its state machine. Allowed states: `allocating | available | allocated`. Transitions:

- `new()` → `allocating`
- `markAvailable(deviceId, platform)` requires `allocating` → `available`
- `claim(allocation)` requires `available` → `allocated`
- `release()` requires `allocated` → `available`
- `markFailed(error)` requires `allocating` → terminal-failed (slot is removed by `DevicePool`)

Illegal transitions throw. The slot also carries `installedApps: Set<string>` mutated only through `recordInstalled(bundleId)`. Whether `installedApps` is best modeled as part of the slot entity or as application-layer cache is a small judgment call; this design places it on the slot because it represents persistent state of the underlying device.

### Domain — `Allocation`

Represents one granted lease. Carries `allocationId`, `deviceId`, `platform`, and the index of the slot it holds. Created by `DevicePool` when a slot is claimed; destroyed on release.

The HTTP adapter (`DevicePoolHttpServer`) maintains its own map of `allocationId → socket` for liveness detection and calls `pool.release(allocationId)` on socket close. The entity does not know about Node sockets.

### Application — `DevicePool`

Pure logic. No HTTP, no driver instantiation. Constructor takes:

```ts
new DevicePool({
  allocator: DeviceAllocator,
  maxSlots: number,             // = config.workers
  allocationTimeoutMs?: number, // default 10 min, applies to a single allocator.allocate() call
})
```

Public methods (called by `DevicePoolHttpServer` or directly in tests):

- `allocate(criteria, releaseSignal): Promise<Allocation>` — resolves with a granted allocation. `releaseSignal` is the abort signal whose firing means the caller is gone (socket close); used to drop waiters.
- `release(allocationId): void`
- `recordInstalled(allocationId, bundleId): void`
- `hasInstalled(allocationId, bundleId): boolean`
- `shutdown(): Promise<void>` — cancels waiters, calls `allocator.release()` for every slot, marks the pool unusable.

Allocate algorithm:

1. If a free slot matches `criteria`, claim and return.
2. Otherwise enqueue a waiter on the FIFO queue.
3. If `slots.length < maxSlots`, push a new slot (`allocating`) and start `allocator.allocate(criteria, takenDeviceIds)` in the background. On success, transition the slot to `available` and immediately re-run step 1 against the head waiter. On failure, drop the slot and reject the head waiter.
4. When any allocated slot is released, transition to `available` and re-run step 1 against the head waiter.

Determinism: the use case is fully testable with a fake `DeviceAllocator` (no HTTP, no Node sockets, no drivers). Tests assert state transitions, queueing, cap enforcement, and timeout behavior.

### Ports

```ts
interface DeviceAllocator {
  allocate(criteria: AllocationCriteria, takenDeviceIds: Set<string>, signal?: AbortSignal): Promise<{ deviceId: string; platform: 'ios' | 'android' }>;
  release(deviceId: string): Promise<void>;
}

interface DevicePoolClient {
  allocate(criteria: AllocationCriteria): Promise<{ allocation: AllocationHandle; release: () => Promise<void> }>;
  recordInstalled(allocationId: string, bundleId: string): Promise<void>;
  hasInstalled(allocationId: string, bundleId: string): Promise<boolean>;
}
```

### Adapters

- **`MobilecliAllocator`** — uses the existing mobilecli driver to `listDevices()`, filters by criteria and `takenDeviceIds`, returns the first match. `release()` is a no-op (local devices need no return).
- **`MobileUseAllocator`** — uses the mobile-use driver's lease/release API. `release()` returns the remote lease.
- **`DevicePoolHttpServer`** — wraps a `DevicePool` with an HTTP server bound to `127.0.0.1` on an OS-picked port (never reachable from outside the machine). Routes:
  - `POST /allocate` (streaming): writes one JSON line `{"allocationId","deviceId","platform"}\n` when granted, then holds the response open. Closing the socket is treated as `release(allocationId)`.
  - `POST /release` `{"allocationId"}` — idempotent.
  - `POST /installed/has` `{"allocationId","bundleId"}` → `{"installed": boolean}`
  - `POST /installed/record` `{"allocationId","bundleId"}` → `{ok: true}`
  - `POST /shutdown` — internal, called only by `teardown.ts`.
- **`HttpDevicePoolClient`** — implements `DevicePoolClient`. Reads `MOBILEWRIGHT_COORDINATOR_URL`. Uses `http.Agent({ keepAlive: true })`, no request timeout. Tracks the open `/allocate` socket and closes it on `release()` (in addition to the explicit `POST /release`).

### Composition root

- **`device-pool/setup.ts`** (used as a Playwright `globalSetup` script): loads config; if `config.driver` is `mobilecli` (or unset), calls `ensureMobilecliReachable`; picks a `DeviceAllocator` based on `config.driver`; instantiates `DevicePool`; starts `DevicePoolHttpServer`; sets `process.env.MOBILEWRIGHT_COORDINATOR_URL`. Returns a teardown function that calls `pool.shutdown()`.
- **`device-pool/teardown.ts`** (Playwright `globalTeardown`): no-op if shutdown already happened in setup's teardown; otherwise POST `/shutdown` as a fallback.
- **`launchers.ts`** (for non-test scripting): composes `findDevice` + `connectDevice` + `installAndLaunchApp`. Does not use `DevicePool`.

## Test fixture changes

`packages/test/src/fixtures.ts`:

- Drop `{ scope: 'worker' }` from `device`, `platform`, `deviceName`. All fixtures become test-scoped.
- The `device` fixture acquires an allocation via `DevicePoolClient`, uses `connectDevice(deviceId)` to bind a driver, then in order:
  1. For each path in `installApps`: if `client.hasInstalled(allocationId, path)` is false, call `device.installApp(path)` and `client.recordInstalled(allocationId, path)`. (At most once per device per run.)
  2. If `bundleId` is set: `device.terminateApp(bundleId).catch(() => {}); device.launchApp(bundleId)`.
  3. `await use(device)`.
  4. On teardown: `device.disconnect()` and release the allocation.

## defineConfig auto-injection

`packages/mobilewright/src/config.ts`:

```ts
export function defineConfig(config: MobilewrightConfig): MobilewrightConfig {
  const ourSetup    = require.resolve('./device-pool/setup.js');
  const ourTeardown = require.resolve('./device-pool/teardown.js');
  return {
    workers: 1,
    ...config,
    globalSetup: config.globalSetup
      ? [ourSetup, ...toArray(config.globalSetup)]
      : ourSetup,
    globalTeardown: config.globalTeardown
      ? [...toArray(config.globalTeardown), ourTeardown]
      : ourTeardown,
  };
}
```

Configs that bypass `defineConfig` will not have the coordinator wired up. The fixture detects a missing `MOBILEWRIGHT_COORDINATOR_URL` and throws a clear error pointing the user to `defineConfig`. Silent fallback is intentionally avoided.

## Lifecycle and failure modes

| # | Scenario | Behavior |
|---|---|---|
| 1 | Happy path | `/allocate` → test runs → `/release` → slot returns to `available`, head waiter (if any) is granted. |
| 2 | Test fails, worker killed by Playwright | Worker holds the `/allocate` socket through the test. Fixture teardown calls `/release`. If teardown is skipped (hard kill), socket-close fires the same path. New worker for retry calls `/allocate`, gets a free slot — usually the same device, no re-allocation. |
| 3 | Worker crashes during long allocation wait | `/allocate` socket closes. `DevicePool` drops the waiter. No slot side-effect. |
| 4 | Allocation itself fails | `DeviceAllocator.allocate()` rejects. The slot is removed (never reaches `available`). Head waiter is rejected; their fixture throws → test fails. |
| 5 | `globalTeardown` | Refuse new requests, close all open `/allocate` sockets, await `allocator.release()` for every slot in `available` or `allocated`, then close the listener. |
| 6 | Coordinator crashes mid-run | Workers' `/allocate` connections drop → tests fail loudly. Remote leases may be orphaned (out-of-scope mitigation). |
| 7 | `/release` with unknown `allocationId` | Idempotent: 200 OK. Handles the race where socket-close fires just before explicit release. |
| 8 | Allocator hangs | `allocationTimeoutMs` (default 10 min) per slot. On timeout: reject head waiter, drop slot, attempt `signal.abort()` if the allocator supports it. |
| 9 | Ctrl-C / SIGINT | Playwright runs `globalTeardown` → scenario 5. |
| 10 | Multiple waiters, one slot frees | FIFO. |

## Extension points

**Multi-project / multi-platform.** The `criteria` payload already carries `platform`; matching at `DevicePool.allocate()` step 1 is criteria-based. Two additions cover multi-project:

1. `criteria.projectId` (sourced from `testInfo.project.name`).
2. Per-project cap: in step 3, refuse to start a new allocation for project P if `slots.filter(s => s.projectId === P && s.state !== 'free').length >= project.workers`.

The state machine and adapter surface are unchanged.

**Alternative IPC transports.** `DevicePoolClient` is a port. A future Unix-domain-socket or in-process implementation can replace `HttpDevicePoolClient` with no changes inward.

**Alternative pool storage.** The `DevicePool.slots` array is in-memory. If we ever needed cross-process pool state (e.g. shards on the same machine), `DevicePool` could be backed by an external store; only the application layer changes.

## Testing strategy

- **`DeviceSlot`** — unit tests for state-transition correctness, refusing illegal transitions.
- **`DevicePool`** — unit tests with a `FakeDeviceAllocator`. Cover: cap enforcement, FIFO queueing, allocation-failure propagation, timeout, shutdown, criteria matching, install-tracking.
- **`HttpDevicePoolClient` ↔ `DevicePoolHttpServer`** — round-trip tests on a real local server with a `FakeDeviceAllocator`. Cover: streaming response, socket-close-as-release, idempotent release.
- **`MobilecliAllocator`** — integration test against the existing mobilecli driver (gated like the existing integration tests).
- **Fixture** — tested through the existing e2e harness; no separate unit tests for the fixture.

The clean-architecture split means almost all logic is covered without spinning up Playwright or a real device.

## Folder structure

```
packages/mobilewright/src/device-pool/
  domain/
    device-slot.ts
    allocation.ts
  application/
    device-pool.ts
    ports.ts
  adapters/
    mobilecli-allocator.ts
    mobile-use-allocator.ts
    http-server.ts
    http-client.ts
  setup.ts
  teardown.ts
```

The fixture imports `DevicePoolClient` from `device-pool/application/ports.js` and the HTTP impl is constructed in the fixture's composition path (or a small factory `device-pool/client.ts` that reads the env var). No HTTP types reach `fixtures.ts`.

## Migration

Mobilewright has no production users yet, so no migration concerns. The plan can change any internal API freely. The public surface (`defineConfig`, fixture imports) is preserved because it is already a clean shape, not because of compatibility constraints.

## Open questions

- Should `installedApps` live on the slot entity or the application layer? Current spec puts it on the slot.
- Should `allocationTimeoutMs` be configurable from `MobilewrightConfig`, or kept as a constant for now? Current spec: configurable, default 10 min.
- ~~For `mobile-use`, does the existing driver's connect API already handle "lease" semantics?~~ **Resolved**: `MobileUseDriver.connect()` performs `fleet.allocate` inline, so per-test connect/disconnect cycles would re-lease the device every test. v1 ships with `mobile-use` not supported through the test runner; covered as a non-goal above.
