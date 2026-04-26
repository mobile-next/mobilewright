# Worker / Device Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the worker-scoped device fixture with a coordinator-owned, lazily-grown device pool so failed tests reuse existing device allocations and worker processes share devices across the pool.

**Architecture:** Clean-architecture split. `DeviceSlot`/`Allocation` entities guard state machines. `DevicePool` is a pure-logic application service driven through the `DeviceAllocator` port. `DevicePoolHttpServer` exposes it on `127.0.0.1:0`; `HttpDevicePoolClient` consumes it from worker processes. Composition root is the auto-injected `globalSetup` from `defineConfig`.

**Tech Stack:** TypeScript (strict), Node 18+, Playwright `1.58.2` test runner used for *all* tests in `packages/*/src/**/*.test.ts` (see `tests/mobilewright.config.ts`). No new runtime dependencies — `node:http`, `node:net`, `node:crypto` are sufficient.

**Reference docs:**
- Spec: `docs/superpowers/specs/2026-04-26-worker-device-pool-design.md`
- Existing fixture: `packages/test/src/fixtures.ts`
- Existing launcher: `packages/mobilewright/src/launchers.ts`
- Existing config / `defineConfig`: `packages/mobilewright/src/config.ts`

**Coding rules to follow in every task** (from `~/.claude/CLAUDE.md` and the project CLAUDE.md):
1. `if` statements always use `{ }` blocks, even one-liners.
2. Never use `await` inline — always assign to a variable first.
3. Prefer sync I/O (`readFileSync`, `execSync`) when possible; never use `exec`/`execSync`/`execFile` without explicit user approval (this plan does not require them).
4. Test code is in TypeScript and reads in plain English — extract intent into named helper functions when expressive.
5. New types in function parameters: declare the type at the top of the file, not inline.

---

## File structure

New files:
```
packages/mobilewright/src/device-pool/
  domain/
    device-slot.ts           # entity + state machine
    device-slot.test.ts
    allocation.ts            # entity
    allocation.test.ts
  application/
    ports.ts                 # DeviceAllocator, DevicePoolClient interfaces, AllocationCriteria
    device-pool.ts           # use case
    device-pool.test.ts
  adapters/
    mobilecli-allocator.ts
    mobilecli-allocator.test.ts
    mobile-use-allocator.ts
    http-server.ts
    http-server.test.ts
    http-client.ts
    http-client.test.ts
    http-roundtrip.test.ts   # client + server end-to-end
  client-factory.ts          # internal helper for the fixture
  setup.ts                   # composition root for globalSetup
  teardown.ts
```

Modified files:
- `packages/mobilewright/src/launchers.ts` — extract `findDevice`, `connectDevice`, `installAndLaunchApp`; keep `ios.launch()` / `android.launch()` public API as a composition over those.
- `packages/mobilewright/src/config.ts` — `defineConfig` injects `globalSetup` and `globalTeardown`.
- `packages/mobilewright/src/index.ts` — export `createDevicePoolClient` for the fixture (internal usage only).
- `packages/test/src/fixtures.ts` — drop `{ scope: 'worker' }` from `device`, `platform`, `deviceName`; rewrite `device` to use `DevicePoolClient`.
- `packages/test/package.json` — add `mobilewright` as a dependency (currently used but not declared).

---

## Task 1: `DeviceSlot` entity

**Files:**
- Create: `packages/mobilewright/src/device-pool/domain/device-slot.ts`
- Create: `packages/mobilewright/src/device-pool/domain/device-slot.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/mobilewright/src/device-pool/domain/device-slot.test.ts
import { test, expect } from '@playwright/test';
import { DeviceSlot, DeviceSlotStateError } from './device-slot.js';

test('a new slot starts in the allocating state', () => {
  const slot = new DeviceSlot();
  expect(slot.state).toBe('allocating');
});

test('an allocating slot becomes available after markAvailable', () => {
  const slot = new DeviceSlot();
  slot.markAvailable('device-1', 'ios');
  expect(slot.state).toBe('available');
  expect(slot.deviceId).toBe('device-1');
  expect(slot.platform).toBe('ios');
});

test('an available slot becomes allocated after claim', () => {
  const slot = new DeviceSlot();
  slot.markAvailable('device-1', 'ios');
  slot.claim('alloc-1');
  expect(slot.state).toBe('allocated');
  expect(slot.allocationId).toBe('alloc-1');
});

test('an allocated slot becomes available after release', () => {
  const slot = new DeviceSlot();
  slot.markAvailable('device-1', 'ios');
  slot.claim('alloc-1');
  slot.release();
  expect(slot.state).toBe('available');
  expect(slot.allocationId).toBeUndefined();
});

test('claiming an already-allocated slot throws DeviceSlotStateError', () => {
  const slot = new DeviceSlot();
  slot.markAvailable('device-1', 'ios');
  slot.claim('alloc-1');
  expect(() => slot.claim('alloc-2')).toThrow(DeviceSlotStateError);
});

test('markAvailable on an allocated slot throws', () => {
  const slot = new DeviceSlot();
  slot.markAvailable('device-1', 'ios');
  slot.claim('alloc-1');
  expect(() => slot.markAvailable('device-2', 'ios')).toThrow(DeviceSlotStateError);
});

test('release on an available slot throws', () => {
  const slot = new DeviceSlot();
  slot.markAvailable('device-1', 'ios');
  expect(() => slot.release()).toThrow(DeviceSlotStateError);
});

test('recordInstalled tracks installed bundleIds', () => {
  const slot = new DeviceSlot();
  slot.markAvailable('device-1', 'ios');
  expect(slot.hasInstalled('com.example')).toBe(false);
  slot.recordInstalled('com.example');
  expect(slot.hasInstalled('com.example')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/domain/device-slot.test.ts`
Expected: FAIL — `DeviceSlot` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/mobilewright/src/device-pool/domain/device-slot.ts
import type { Platform } from '@mobilewright/protocol';

export type DeviceSlotState = 'allocating' | 'available' | 'allocated';

export class DeviceSlotStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceSlotStateError';
  }
}

export class DeviceSlot {
  private _state: DeviceSlotState = 'allocating';
  private _deviceId?: string;
  private _platform?: Platform;
  private _allocationId?: string;
  private readonly _installedApps = new Set<string>();

  get state(): DeviceSlotState {
    return this._state;
  }

  get deviceId(): string | undefined {
    return this._deviceId;
  }

  get platform(): Platform | undefined {
    return this._platform;
  }

  get allocationId(): string | undefined {
    return this._allocationId;
  }

  markAvailable(deviceId: string, platform: Platform): void {
    if (this._state !== 'allocating') {
      throw new DeviceSlotStateError(
        `markAvailable requires state 'allocating', got '${this._state}'`,
      );
    }
    this._state = 'available';
    this._deviceId = deviceId;
    this._platform = platform;
  }

  claim(allocationId: string): void {
    if (this._state !== 'available') {
      throw new DeviceSlotStateError(
        `claim requires state 'available', got '${this._state}'`,
      );
    }
    this._state = 'allocated';
    this._allocationId = allocationId;
  }

  release(): void {
    if (this._state !== 'allocated') {
      throw new DeviceSlotStateError(
        `release requires state 'allocated', got '${this._state}'`,
      );
    }
    this._state = 'available';
    this._allocationId = undefined;
  }

  recordInstalled(bundleId: string): void {
    this._installedApps.add(bundleId);
  }

  hasInstalled(bundleId: string): boolean {
    return this._installedApps.has(bundleId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/domain/device-slot.test.ts`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/mobilewright/src/device-pool/domain/device-slot.ts packages/mobilewright/src/device-pool/domain/device-slot.test.ts
git commit -m "feat(device-pool): add DeviceSlot entity with state machine"
```

---

## Task 2: `Allocation` entity

**Files:**
- Create: `packages/mobilewright/src/device-pool/domain/allocation.ts`
- Create: `packages/mobilewright/src/device-pool/domain/allocation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/mobilewright/src/device-pool/domain/allocation.test.ts
import { test, expect } from '@playwright/test';
import { Allocation } from './allocation.js';

test('Allocation carries id, deviceId, platform, and slotIndex', () => {
  const allocation = new Allocation({
    allocationId: 'alloc-1',
    deviceId: 'device-1',
    platform: 'ios',
    slotIndex: 3,
  });

  expect(allocation.allocationId).toBe('alloc-1');
  expect(allocation.deviceId).toBe('device-1');
  expect(allocation.platform).toBe('ios');
  expect(allocation.slotIndex).toBe(3);
});

test('Allocation generates a fresh id when one is not provided', () => {
  const a = Allocation.create({ deviceId: 'd', platform: 'ios', slotIndex: 0 });
  const b = Allocation.create({ deviceId: 'd', platform: 'ios', slotIndex: 0 });
  expect(a.allocationId).toMatch(/^alloc-/);
  expect(a.allocationId).not.toBe(b.allocationId);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/domain/allocation.test.ts`
Expected: FAIL — `Allocation` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/mobilewright/src/device-pool/domain/allocation.ts
import { randomBytes } from 'node:crypto';
import type { Platform } from '@mobilewright/protocol';

export interface AllocationParams {
  allocationId: string;
  deviceId: string;
  platform: Platform;
  slotIndex: number;
}

export interface AllocationCreateParams {
  deviceId: string;
  platform: Platform;
  slotIndex: number;
}

export class Allocation {
  readonly allocationId: string;
  readonly deviceId: string;
  readonly platform: Platform;
  readonly slotIndex: number;

  constructor(params: AllocationParams) {
    this.allocationId = params.allocationId;
    this.deviceId = params.deviceId;
    this.platform = params.platform;
    this.slotIndex = params.slotIndex;
  }

  static create(params: AllocationCreateParams): Allocation {
    const id = `alloc-${randomBytes(8).toString('hex')}`;
    return new Allocation({ allocationId: id, ...params });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/domain/allocation.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/mobilewright/src/device-pool/domain/allocation.ts packages/mobilewright/src/device-pool/domain/allocation.test.ts
git commit -m "feat(device-pool): add Allocation entity"
```

---

## Task 3: Application-layer ports

**Files:**
- Create: `packages/mobilewright/src/device-pool/application/ports.ts`

This task has no test of its own — interfaces are exercised by the next tasks. Skip TDD here.

- [ ] **Step 1: Define ports**

```ts
// packages/mobilewright/src/device-pool/application/ports.ts
import type { Platform } from '@mobilewright/protocol';

export interface AllocationCriteria {
  platform?: Platform;
  /** Serialized regex source — `RegExp.prototype.source`. The allocator reconstructs `new RegExp(...)`. */
  deviceNamePattern?: string;
  deviceId?: string;
}

export interface AllocateResult {
  deviceId: string;
  platform: Platform;
}

/**
 * Driver-specific allocator. Implementations are at the outer adapter layer.
 * `takenDeviceIds` lets the allocator avoid handing out devices the pool already has.
 */
export interface DeviceAllocator {
  allocate(
    criteria: AllocationCriteria,
    takenDeviceIds: ReadonlySet<string>,
    signal?: AbortSignal,
  ): Promise<AllocateResult>;

  /** Called at pool shutdown for every slot in `available` or `allocated` state. */
  release(deviceId: string): Promise<void>;
}

export interface AllocationHandle {
  allocationId: string;
  deviceId: string;
  platform: Platform;
}

/**
 * Port consumed by the test fixture. The HTTP adapter is one implementation.
 */
export interface DevicePoolClient {
  allocate(criteria: AllocationCriteria): Promise<AllocationHandle>;
  release(allocationId: string): Promise<void>;
  hasInstalled(allocationId: string, bundleId: string): Promise<boolean>;
  recordInstalled(allocationId: string, bundleId: string): Promise<void>;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: PASS — no type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/mobilewright/src/device-pool/application/ports.ts
git commit -m "feat(device-pool): define DeviceAllocator and DevicePoolClient ports"
```

---

## Task 4: `DevicePool` — happy-path allocate and release

**Files:**
- Create: `packages/mobilewright/src/device-pool/application/device-pool.ts`
- Create: `packages/mobilewright/src/device-pool/application/device-pool.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/mobilewright/src/device-pool/application/device-pool.test.ts
import { test, expect } from '@playwright/test';
import { DevicePool } from './device-pool.js';
import type { DeviceAllocator, AllocationCriteria, AllocateResult } from './ports.js';

function makeAllocator(devices: AllocateResult[]): DeviceAllocator {
  let i = 0;
  return {
    async allocate() {
      if (i >= devices.length) {
        throw new Error('no more fake devices');
      }
      return devices[i++];
    },
    async release() { /* no-op */ },
  };
}

test('first allocate spins up a slot and returns a handle', async () => {
  const allocator = makeAllocator([{ deviceId: 'd1', platform: 'ios' }]);
  const pool = new DevicePool({ allocator, maxSlots: 2 });

  const handle = await pool.allocate({ platform: 'ios' });

  expect(handle.deviceId).toBe('d1');
  expect(handle.platform).toBe('ios');
  expect(handle.allocationId).toMatch(/^alloc-/);
});

test('a released slot is reused by a subsequent allocate', async () => {
  const allocator = makeAllocator([{ deviceId: 'd1', platform: 'ios' }]);
  const pool = new DevicePool({ allocator, maxSlots: 2 });

  const first = await pool.allocate({ platform: 'ios' });
  await pool.release(first.allocationId);
  const second = await pool.allocate({ platform: 'ios' });

  expect(second.deviceId).toBe('d1');           // reused
  expect(second.allocationId).not.toBe(first.allocationId);  // new lease
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/application/device-pool.test.ts`
Expected: FAIL — `DevicePool` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/mobilewright/src/device-pool/application/device-pool.ts
import { DeviceSlot } from '../domain/device-slot.js';
import { Allocation } from '../domain/allocation.js';
import type {
  AllocationCriteria,
  AllocationHandle,
  DeviceAllocator,
} from './ports.js';

export interface DevicePoolOptions {
  allocator: DeviceAllocator;
  maxSlots: number;
}

export class DevicePool {
  private readonly allocator: DeviceAllocator;
  private readonly maxSlots: number;
  private readonly slots: DeviceSlot[] = [];
  private readonly allocations = new Map<string, Allocation>();

  constructor(options: DevicePoolOptions) {
    this.allocator = options.allocator;
    this.maxSlots = options.maxSlots;
  }

  async allocate(criteria: AllocationCriteria): Promise<AllocationHandle> {
    const slotIndex = await this.acquireSlot(criteria);
    const slot = this.slots[slotIndex];
    const deviceId = slot.deviceId;
    const platform = slot.platform;
    if (deviceId === undefined || platform === undefined) {
      throw new Error('internal: slot missing deviceId/platform');
    }

    const allocation = Allocation.create({ deviceId, platform, slotIndex });
    slot.claim(allocation.allocationId);
    this.allocations.set(allocation.allocationId, allocation);

    return {
      allocationId: allocation.allocationId,
      deviceId: allocation.deviceId,
      platform: allocation.platform,
    };
  }

  async release(allocationId: string): Promise<void> {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) {
      return;   // idempotent
    }
    this.allocations.delete(allocationId);
    this.slots[allocation.slotIndex].release();
  }

  private async acquireSlot(criteria: AllocationCriteria): Promise<number> {
    // Step 1: any free slot matching criteria?
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.state === 'available' && slotMatches(slot, criteria)) {
        return i;
      }
    }
    // Lazy creation: if cap allows, allocate a new slot now.
    if (this.slots.length < this.maxSlots) {
      const newSlot = new DeviceSlot();
      this.slots.push(newSlot);
      const slotIndex = this.slots.length - 1;
      const result = await this.allocator.allocate(criteria, this.takenDeviceIds());
      newSlot.markAvailable(result.deviceId, result.platform);
      return slotIndex;
    }
    throw new Error('no free slot and pool at max capacity (queueing not yet implemented)');
  }

  private takenDeviceIds(): Set<string> {
    const ids = new Set<string>();
    for (const slot of this.slots) {
      if (slot.deviceId !== undefined) {
        ids.add(slot.deviceId);
      }
    }
    return ids;
  }
}

function slotMatches(slot: DeviceSlot, criteria: AllocationCriteria): boolean {
  if (criteria.platform && slot.platform !== criteria.platform) {
    return false;
  }
  if (criteria.deviceId && slot.deviceId !== criteria.deviceId) {
    return false;
  }
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/application/device-pool.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/mobilewright/src/device-pool/application/device-pool.ts packages/mobilewright/src/device-pool/application/device-pool.test.ts
git commit -m "feat(device-pool): DevicePool happy-path allocate/release"
```

---

## Task 5: `DevicePool` — FIFO waiter queue

**Files:**
- Modify: `packages/mobilewright/src/device-pool/application/device-pool.ts`
- Modify: `packages/mobilewright/src/device-pool/application/device-pool.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `device-pool.test.ts`:

```ts
test('a second concurrent allocate when no free slot triggers parallel allocation', async () => {
  let calls = 0;
  const allocator: DeviceAllocator = {
    async allocate(): Promise<AllocateResult> {
      calls++;
      return { deviceId: `d${calls}`, platform: 'ios' };
    },
    async release() {},
  };
  const pool = new DevicePool({ allocator, maxSlots: 2 });

  const [a, b] = await Promise.all([
    pool.allocate({ platform: 'ios' }),
    pool.allocate({ platform: 'ios' }),
  ]);

  const ids = [a.deviceId, b.deviceId].sort();
  expect(ids).toEqual(['d1', 'd2']);
  expect(calls).toBe(2);
});

test('waiter resolves when an existing allocated slot is released', async () => {
  const allocator = makeAllocator([{ deviceId: 'd1', platform: 'ios' }]);
  const pool = new DevicePool({ allocator, maxSlots: 1 });

  const first = await pool.allocate({ platform: 'ios' });

  let secondHandle: { deviceId: string } | undefined;
  const secondPromise = pool.allocate({ platform: 'ios' }).then((h) => { secondHandle = h; });

  await Promise.resolve();   // let microtasks flush
  expect(secondHandle).toBeUndefined();   // still queued

  await pool.release(first.allocationId);
  await secondPromise;

  expect(secondHandle?.deviceId).toBe('d1');
});

test('FIFO order across multiple waiters', async () => {
  const allocator = makeAllocator([{ deviceId: 'd1', platform: 'ios' }]);
  const pool = new DevicePool({ allocator, maxSlots: 1 });

  const first = await pool.allocate({ platform: 'ios' });

  const order: string[] = [];
  const w1 = pool.allocate({ platform: 'ios' }).then((h) => order.push(`w1:${h.allocationId}`));
  const w2 = pool.allocate({ platform: 'ios' }).then((h) => order.push(`w2:${h.allocationId}`));

  await pool.release(first.allocationId);
  await w1;
  await pool.release(order[0].split(':')[1]);
  await w2;

  expect(order.length).toBe(2);
  expect(order[0]).toMatch(/^w1:/);
  expect(order[1]).toMatch(/^w2:/);
});
```

- [ ] **Step 2: Run test to verify they fail**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/application/device-pool.test.ts`
Expected: FAIL — last 3 tests fail with "no free slot and pool at max capacity".

- [ ] **Step 3: Update implementation to support waiters**

Replace `device-pool.ts` with:

```ts
// packages/mobilewright/src/device-pool/application/device-pool.ts
import { DeviceSlot } from '../domain/device-slot.js';
import { Allocation } from '../domain/allocation.js';
import type {
  AllocationCriteria,
  AllocationHandle,
  DeviceAllocator,
} from './ports.js';

export interface DevicePoolOptions {
  allocator: DeviceAllocator;
  maxSlots: number;
}

interface Waiter {
  criteria: AllocationCriteria;
  resolve: (handle: AllocationHandle) => void;
  reject: (err: Error) => void;
}

export class DevicePool {
  private readonly allocator: DeviceAllocator;
  private readonly maxSlots: number;
  private readonly slots: DeviceSlot[] = [];
  private readonly allocations = new Map<string, Allocation>();
  private readonly waiters: Waiter[] = [];

  constructor(options: DevicePoolOptions) {
    this.allocator = options.allocator;
    this.maxSlots = options.maxSlots;
  }

  allocate(criteria: AllocationCriteria): Promise<AllocationHandle> {
    return new Promise<AllocationHandle>((resolve, reject) => {
      this.waiters.push({ criteria, resolve, reject });
      this.pump();
    });
  }

  async release(allocationId: string): Promise<void> {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) {
      return;   // idempotent
    }
    this.allocations.delete(allocationId);
    this.slots[allocation.slotIndex].release();
    this.pump();
  }

  private pump(): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters[0];
      const slotIndex = this.findFreeSlot(waiter.criteria);
      if (slotIndex !== -1) {
        this.waiters.shift();
        this.grantSlot(slotIndex, waiter);
        continue;
      }
      if (this.slots.length < this.maxSlots) {
        this.waiters.shift();
        this.startAllocationForWaiter(waiter);
        continue;
      }
      // Cap reached and no free slot. Wait for a release.
      return;
    }
  }

  private findFreeSlot(criteria: AllocationCriteria): number {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.state === 'available' && slotMatches(slot, criteria)) {
        return i;
      }
    }
    return -1;
  }

  private grantSlot(slotIndex: number, waiter: Waiter): void {
    const slot = this.slots[slotIndex];
    const deviceId = slot.deviceId;
    const platform = slot.platform;
    if (deviceId === undefined || platform === undefined) {
      waiter.reject(new Error('internal: slot missing deviceId/platform'));
      return;
    }
    const allocation = Allocation.create({ deviceId, platform, slotIndex });
    slot.claim(allocation.allocationId);
    this.allocations.set(allocation.allocationId, allocation);
    waiter.resolve({
      allocationId: allocation.allocationId,
      deviceId: allocation.deviceId,
      platform: allocation.platform,
    });
  }

  private startAllocationForWaiter(waiter: Waiter): void {
    const slot = new DeviceSlot();
    this.slots.push(slot);
    const slotIndex = this.slots.length - 1;
    const allocatePromise = this.allocator.allocate(waiter.criteria, this.takenDeviceIds());
    allocatePromise.then(
      (result) => {
        slot.markAvailable(result.deviceId, result.platform);
        // Re-enqueue this waiter at the head so it gets the slot it triggered.
        this.waiters.unshift(waiter);
        this.pump();
      },
      (err: Error) => {
        // Drop the slot — it never reached `available`.
        this.slots.splice(slotIndex, 1);
        waiter.reject(err);
        // Other waiters may still proceed (e.g. via an existing release).
        this.pump();
      },
    );
  }

  private takenDeviceIds(): Set<string> {
    const ids = new Set<string>();
    for (const slot of this.slots) {
      if (slot.deviceId !== undefined) {
        ids.add(slot.deviceId);
      }
    }
    return ids;
  }
}

function slotMatches(slot: DeviceSlot, criteria: AllocationCriteria): boolean {
  if (criteria.platform && slot.platform !== criteria.platform) {
    return false;
  }
  if (criteria.deviceId && slot.deviceId !== criteria.deviceId) {
    return false;
  }
  return true;
}
```

Note: dropping the failed slot mid-array shifts subsequent slot indices. For the v1 single-criteria flow this only matters when an allocation fails, and since `Allocation.slotIndex` is assigned only after `markAvailable` succeeds, no allocation references a doomed slot. If multi-platform support is added later, slot identity should switch from "array index" to a stable id.

- [ ] **Step 4: Run all DevicePool tests**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/application/device-pool.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/mobilewright/src/device-pool/application/device-pool.ts packages/mobilewright/src/device-pool/application/device-pool.test.ts
git commit -m "feat(device-pool): FIFO waiter queue and lazy slot creation"
```

---

## Task 6: `DevicePool` — allocation-failure propagation

**Files:**
- Modify: `packages/mobilewright/src/device-pool/application/device-pool.test.ts`

The implementation already handles failure (see `startAllocationForWaiter`'s reject branch). This task locks in test coverage.

- [ ] **Step 1: Add failing test**

Append to `device-pool.test.ts`:

```ts
test('allocation failure rejects the requesting waiter and drops the slot', async () => {
  let attempts = 0;
  const allocator: DeviceAllocator = {
    async allocate() {
      attempts++;
      if (attempts === 1) {
        throw new Error('boom');
      }
      return { deviceId: `d${attempts}`, platform: 'ios' };
    },
    async release() {},
  };
  const pool = new DevicePool({ allocator, maxSlots: 2 });

  await expect(pool.allocate({ platform: 'ios' })).rejects.toThrow('boom');

  // Subsequent allocate succeeds (the failed slot was dropped, fresh attempt allowed).
  const handle = await pool.allocate({ platform: 'ios' });
  expect(handle.deviceId).toBe('d2');
});
```

- [ ] **Step 2: Run tests**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/application/device-pool.test.ts`
Expected: PASS — test green (the implementation already supports this from Task 5).

- [ ] **Step 3: Commit**

```bash
git add packages/mobilewright/src/device-pool/application/device-pool.test.ts
git commit -m "test(device-pool): cover allocation-failure path"
```

---

## Task 7: `DevicePool` — install tracking methods

**Files:**
- Modify: `packages/mobilewright/src/device-pool/application/device-pool.ts`
- Modify: `packages/mobilewright/src/device-pool/application/device-pool.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `device-pool.test.ts`:

```ts
test('hasInstalled is false until recordInstalled is called', async () => {
  const allocator = makeAllocator([{ deviceId: 'd1', platform: 'ios' }]);
  const pool = new DevicePool({ allocator, maxSlots: 1 });
  const handle = await pool.allocate({ platform: 'ios' });

  expect(pool.hasInstalled(handle.allocationId, 'app.ipa')).toBe(false);
  pool.recordInstalled(handle.allocationId, 'app.ipa');
  expect(pool.hasInstalled(handle.allocationId, 'app.ipa')).toBe(true);
});

test('install tracking persists across releases of the same slot', async () => {
  const allocator = makeAllocator([{ deviceId: 'd1', platform: 'ios' }]);
  const pool = new DevicePool({ allocator, maxSlots: 1 });
  const first = await pool.allocate({ platform: 'ios' });
  pool.recordInstalled(first.allocationId, 'app.ipa');

  await pool.release(first.allocationId);
  const second = await pool.allocate({ platform: 'ios' });

  expect(pool.hasInstalled(second.allocationId, 'app.ipa')).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/application/device-pool.test.ts`
Expected: FAIL — `hasInstalled`/`recordInstalled` not defined.

- [ ] **Step 3: Add implementation methods**

Add to `DevicePool` class (after `release`):

```ts
recordInstalled(allocationId: string, bundleId: string): void {
  const allocation = this.allocations.get(allocationId);
  if (!allocation) {
    throw new Error(`unknown allocationId: ${allocationId}`);
  }
  this.slots[allocation.slotIndex].recordInstalled(bundleId);
}

hasInstalled(allocationId: string, bundleId: string): boolean {
  const allocation = this.allocations.get(allocationId);
  if (!allocation) {
    throw new Error(`unknown allocationId: ${allocationId}`);
  }
  return this.slots[allocation.slotIndex].hasInstalled(bundleId);
}
```

- [ ] **Step 4: Run tests**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/application/device-pool.test.ts`
Expected: PASS — all DevicePool tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/mobilewright/src/device-pool/application/device-pool.ts packages/mobilewright/src/device-pool/application/device-pool.test.ts
git commit -m "feat(device-pool): track installed apps per slot"
```

---

## Task 8: `DevicePool` — allocation timeout

**Files:**
- Modify: `packages/mobilewright/src/device-pool/application/device-pool.ts`
- Modify: `packages/mobilewright/src/device-pool/application/device-pool.test.ts`

- [ ] **Step 1: Add failing test**

Append to `device-pool.test.ts`:

```ts
test('allocation that exceeds allocationTimeoutMs rejects with timeout error', async () => {
  const allocator: DeviceAllocator = {
    async allocate(_c, _t, signal) {
      return new Promise<AllocateResult>((_, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    },
    async release() {},
  };
  const pool = new DevicePool({ allocator, maxSlots: 1, allocationTimeoutMs: 50 });

  await expect(pool.allocate({ platform: 'ios' })).rejects.toThrow(/timeout|aborted/i);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/application/device-pool.test.ts`
Expected: FAIL — `allocationTimeoutMs` ignored.

- [ ] **Step 3: Add timeout to `DevicePoolOptions` and `startAllocationForWaiter`**

Update `DevicePoolOptions`:

```ts
export interface DevicePoolOptions {
  allocator: DeviceAllocator;
  maxSlots: number;
  /** Per-allocation timeout in ms. Default 600_000 (10 min). */
  allocationTimeoutMs?: number;
}
```

Add field and constructor handling:

```ts
private readonly allocationTimeoutMs: number;

constructor(options: DevicePoolOptions) {
  this.allocator = options.allocator;
  this.maxSlots = options.maxSlots;
  this.allocationTimeoutMs = options.allocationTimeoutMs ?? 600_000;
}
```

Update `startAllocationForWaiter`:

```ts
private startAllocationForWaiter(waiter: Waiter): void {
  const slot = new DeviceSlot();
  this.slots.push(slot);
  const slotIndex = this.slots.length - 1;

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), this.allocationTimeoutMs);

  const allocatePromise = this.allocator.allocate(
    waiter.criteria,
    this.takenDeviceIds(),
    abortController.signal,
  );
  allocatePromise.then(
    (result) => {
      clearTimeout(timer);
      slot.markAvailable(result.deviceId, result.platform);
      this.waiters.unshift(waiter);
      this.pump();
    },
    (err: Error) => {
      clearTimeout(timer);
      this.slots.splice(slotIndex, 1);
      const finalErr = abortController.signal.aborted
        ? new Error(`device allocation timed out after ${this.allocationTimeoutMs}ms`)
        : err;
      waiter.reject(finalErr);
      this.pump();
    },
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/application/device-pool.test.ts`
Expected: PASS — all green.

- [ ] **Step 5: Commit**

```bash
git add packages/mobilewright/src/device-pool/application/device-pool.ts packages/mobilewright/src/device-pool/application/device-pool.test.ts
git commit -m "feat(device-pool): per-allocation timeout via AbortSignal"
```

---

## Task 9: `DevicePool` — shutdown

**Files:**
- Modify: `packages/mobilewright/src/device-pool/application/device-pool.ts`
- Modify: `packages/mobilewright/src/device-pool/application/device-pool.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `device-pool.test.ts`:

```ts
test('shutdown calls allocator.release for every available slot', async () => {
  const released: string[] = [];
  const allocator: DeviceAllocator = {
    async allocate(): Promise<AllocateResult> {
      return { deviceId: `d${released.length + 1}`, platform: 'ios' };
    },
    async release(deviceId: string) { released.push(deviceId); },
  };
  const pool = new DevicePool({ allocator, maxSlots: 2 });

  const a = await pool.allocate({ platform: 'ios' });
  const b = await pool.allocate({ platform: 'ios' });
  await pool.release(a.allocationId);   // a is now available; b is still allocated

  await pool.shutdown();

  expect(released.sort()).toEqual([a.deviceId, b.deviceId].sort());
});

test('shutdown rejects in-flight waiters', async () => {
  const allocator: DeviceAllocator = {
    async allocate() {
      return new Promise<AllocateResult>(() => {});   // never resolves
    },
    async release() {},
  };
  const pool = new DevicePool({ allocator, maxSlots: 1 });

  const promise = pool.allocate({ platform: 'ios' });
  await Promise.resolve();
  await pool.shutdown();

  await expect(promise).rejects.toThrow(/shutdown/i);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/application/device-pool.test.ts`
Expected: FAIL — `shutdown` not defined.

- [ ] **Step 3: Add shutdown**

Add field and method to `DevicePool`:

```ts
private isShutdown = false;

async shutdown(): Promise<void> {
  this.isShutdown = true;

  for (const waiter of this.waiters.splice(0)) {
    waiter.reject(new Error('device pool shutdown'));
  }

  const releases: Promise<void>[] = [];
  for (const slot of this.slots) {
    if (slot.state !== 'allocating' && slot.deviceId !== undefined) {
      releases.push(this.allocator.release(slot.deviceId).catch(() => {}));
    }
  }
  await Promise.all(releases);
  this.slots.length = 0;
  this.allocations.clear();
}
```

Update `allocate` and `pump` to refuse new requests after shutdown:

```ts
allocate(criteria: AllocationCriteria): Promise<AllocationHandle> {
  if (this.isShutdown) {
    return Promise.reject(new Error('device pool is shut down'));
  }
  return new Promise<AllocationHandle>((resolve, reject) => {
    this.waiters.push({ criteria, resolve, reject });
    this.pump();
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/application/device-pool.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mobilewright/src/device-pool/application/device-pool.ts packages/mobilewright/src/device-pool/application/device-pool.test.ts
git commit -m "feat(device-pool): shutdown drains waiters and releases all slots"
```

---

## Task 10: `MobilecliAllocator`

**Files:**
- Create: `packages/mobilewright/src/device-pool/adapters/mobilecli-allocator.ts`
- Create: `packages/mobilewright/src/device-pool/adapters/mobilecli-allocator.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/mobilewright/src/device-pool/adapters/mobilecli-allocator.test.ts
import { test, expect } from '@playwright/test';
import type { DeviceInfo } from '@mobilewright/protocol';
import { MobilecliAllocator } from './mobilecli-allocator.js';

interface FakeDriver {
  listDevices(opts?: { platform?: string }): Promise<DeviceInfo[]>;
}

function makeFakeDriver(devices: DeviceInfo[]): FakeDriver {
  return {
    async listDevices(): Promise<DeviceInfo[]> {
      return devices;
    },
  };
}

test('allocates the first online device matching platform', async () => {
  const driver = makeFakeDriver([
    { id: 'a', name: 'iPhone 14', platform: 'ios', type: 'simulator', state: 'online' },
    { id: 'b', name: 'iPhone 16', platform: 'ios', type: 'simulator', state: 'online' },
  ]);
  const allocator = new MobilecliAllocator({ driver });

  const result = await allocator.allocate({ platform: 'ios' }, new Set());

  expect(result.deviceId).toBe('a');
  expect(result.platform).toBe('ios');
});

test('skips devices that are already taken', async () => {
  const driver = makeFakeDriver([
    { id: 'a', name: 'iPhone 14', platform: 'ios', type: 'simulator', state: 'online' },
    { id: 'b', name: 'iPhone 16', platform: 'ios', type: 'simulator', state: 'online' },
  ]);
  const allocator = new MobilecliAllocator({ driver });

  const result = await allocator.allocate({ platform: 'ios' }, new Set(['a']));

  expect(result.deviceId).toBe('b');
});

test('filters by deviceNamePattern', async () => {
  const driver = makeFakeDriver([
    { id: 'a', name: 'iPhone 14', platform: 'ios', type: 'simulator', state: 'online' },
    { id: 'b', name: 'iPhone 16', platform: 'ios', type: 'simulator', state: 'online' },
  ]);
  const allocator = new MobilecliAllocator({ driver });

  const result = await allocator.allocate(
    { platform: 'ios', deviceNamePattern: 'iPhone 16' },
    new Set(),
  );

  expect(result.deviceId).toBe('b');
});

test('filters by exact deviceId', async () => {
  const driver = makeFakeDriver([
    { id: 'a', name: 'iPhone 14', platform: 'ios', type: 'simulator', state: 'online' },
    { id: 'b', name: 'iPhone 16', platform: 'ios', type: 'simulator', state: 'online' },
  ]);
  const allocator = new MobilecliAllocator({ driver });

  const result = await allocator.allocate(
    { platform: 'ios', deviceId: 'b' },
    new Set(),
  );

  expect(result.deviceId).toBe('b');
});

test('throws when no device matches', async () => {
  const driver = makeFakeDriver([
    { id: 'a', name: 'iPhone 14', platform: 'ios', type: 'simulator', state: 'offline' },
  ]);
  const allocator = new MobilecliAllocator({ driver });

  await expect(allocator.allocate({ platform: 'ios' }, new Set())).rejects.toThrow(/no.*device.*available/i);
});

test('release is a no-op for local devices', async () => {
  const driver = makeFakeDriver([]);
  const allocator = new MobilecliAllocator({ driver });
  await expect(allocator.release('whatever')).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/adapters/mobilecli-allocator.test.ts`
Expected: FAIL — `MobilecliAllocator` not defined.

- [ ] **Step 3: Implement**

```ts
// packages/mobilewright/src/device-pool/adapters/mobilecli-allocator.ts
import type { DeviceInfo, Platform } from '@mobilewright/protocol';
import type { AllocationCriteria, AllocateResult, DeviceAllocator } from '../application/ports.js';

interface ListDevicesOpts {
  platform?: Platform;
}

interface ListDevicesDriver {
  listDevices(opts?: ListDevicesOpts): Promise<DeviceInfo[]>;
}

export interface MobilecliAllocatorOptions {
  driver: ListDevicesDriver;
}

export class MobilecliAllocator implements DeviceAllocator {
  private readonly driver: ListDevicesDriver;

  constructor(options: MobilecliAllocatorOptions) {
    this.driver = options.driver;
  }

  async allocate(
    criteria: AllocationCriteria,
    takenDeviceIds: ReadonlySet<string>,
  ): Promise<AllocateResult> {
    const devices = await this.driver.listDevices(
      criteria.platform ? { platform: criteria.platform } : undefined,
    );

    const namePattern = criteria.deviceNamePattern
      ? new RegExp(criteria.deviceNamePattern)
      : undefined;

    for (const device of devices) {
      if (device.state !== 'online') {
        continue;
      }
      if (takenDeviceIds.has(device.id)) {
        continue;
      }
      if (criteria.platform && device.platform !== criteria.platform) {
        continue;
      }
      if (criteria.deviceId && device.id !== criteria.deviceId) {
        continue;
      }
      if (namePattern && !namePattern.test(device.name)) {
        continue;
      }
      return { deviceId: device.id, platform: device.platform };
    }

    throw new Error(
      `no online device available matching criteria ${JSON.stringify(criteria)}`,
    );
  }

  async release(_deviceId: string): Promise<void> {
    // mobilecli devices are local; nothing to release.
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/adapters/mobilecli-allocator.test.ts`
Expected: PASS — 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/mobilewright/src/device-pool/adapters/mobilecli-allocator.ts packages/mobilewright/src/device-pool/adapters/mobilecli-allocator.test.ts
git commit -m "feat(device-pool): MobilecliAllocator adapter"
```

---

## Task 11: `MobileUseAllocator` (stub for v1)

**Files:**
- Create: `packages/mobilewright/src/device-pool/adapters/mobile-use-allocator.ts`

Per spec non-goals: v1 does not support mobile-use through the test runner because `MobileUseDriver.connect()` couples WS connection with `fleet.allocate`, so per-test connect/disconnect would re-lease every test. This stub fails fast with a clear message.

- [ ] **Step 1: Implement**

```ts
// packages/mobilewright/src/device-pool/adapters/mobile-use-allocator.ts
import type { AllocationCriteria, AllocateResult, DeviceAllocator } from '../application/ports.js';

export class MobileUseAllocator implements DeviceAllocator {
  async allocate(_criteria: AllocationCriteria): Promise<AllocateResult> {
    throw new Error(
      'mobile-use driver is not yet supported through the test runner. ' +
      'Use the public ios.launch() / android.launch() API for scripting, ' +
      'or switch to the mobilecli driver for tests.',
    );
  }

  async release(_deviceId: string): Promise<void> {
    // no-op; allocate never succeeds.
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/mobilewright/src/device-pool/adapters/mobile-use-allocator.ts
git commit -m "feat(device-pool): MobileUseAllocator stub (v1 not yet supported)"
```

---

## Task 12: `DevicePoolHttpServer` — `/allocate` streaming

**Files:**
- Create: `packages/mobilewright/src/device-pool/adapters/http-server.ts`
- Create: `packages/mobilewright/src/device-pool/adapters/http-server.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/mobilewright/src/device-pool/adapters/http-server.test.ts
import { test, expect } from '@playwright/test';
import { request } from 'node:http';
import { DevicePool } from '../application/device-pool.js';
import type { DeviceAllocator, AllocateResult } from '../application/ports.js';
import { DevicePoolHttpServer } from './http-server.js';

function makeAllocator(devices: AllocateResult[]): DeviceAllocator {
  let i = 0;
  return {
    async allocate() {
      return devices[i++ % devices.length];
    },
    async release() {},
  };
}

interface ServerHandle {
  url: string;
  stop: () => Promise<void>;
}

async function startServer(pool: DevicePool): Promise<ServerHandle> {
  const server = new DevicePoolHttpServer({ pool });
  const port = await server.listen();
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => server.close(),
  };
}

function postAllocateAndReadFirstLine(url: string, body: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const req = request(`${url}/allocate`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx !== -1) {
          resolve(buffer.slice(0, newlineIdx));
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

test('POST /allocate returns a JSON line with allocationId, deviceId, platform', async () => {
  const pool = new DevicePool({
    allocator: makeAllocator([{ deviceId: 'd1', platform: 'ios' }]),
    maxSlots: 1,
  });
  const server = await startServer(pool);
  try {
    const line = await postAllocateAndReadFirstLine(server.url, JSON.stringify({ criteria: { platform: 'ios' } }));
    const parsed = JSON.parse(line);
    expect(parsed.deviceId).toBe('d1');
    expect(parsed.platform).toBe('ios');
    expect(parsed.allocationId).toMatch(/^alloc-/);
  } finally {
    await server.stop();
  }
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/adapters/http-server.test.ts`
Expected: FAIL — `DevicePoolHttpServer` not defined.

- [ ] **Step 3: Implement**

```ts
// packages/mobilewright/src/device-pool/adapters/http-server.ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { DevicePool } from '../application/device-pool.js';
import type { AllocationCriteria, AllocationHandle } from '../application/ports.js';

export interface DevicePoolHttpServerOptions {
  pool: DevicePool;
}

export class DevicePoolHttpServer {
  private readonly pool: DevicePool;
  private readonly server: Server;
  private readonly socketsByAllocationId = new Map<string, Socket>();

  constructor(options: DevicePoolHttpServerOptions) {
    this.pool = options.pool;
    this.server = createServer((req, res) => this.handle(req, res));
  }

  async listen(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server.address();
        if (typeof address === 'string' || address === null) {
          reject(new Error('expected AddressInfo'));
          return;
        }
        resolve(address.port);
      });
    });
  }

  async close(): Promise<void> {
    return new Promise<void>((resolve) => {
      for (const socket of this.socketsByAllocationId.values()) {
        socket.destroy();
      }
      this.socketsByAllocationId.clear();
      this.server.close(() => resolve());
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end();
      return;
    }
    if (req.url === '/allocate') {
      await this.handleAllocate(req, res);
      return;
    }
    res.statusCode = 404;
    res.end();
  }

  private async handleAllocate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson<{ criteria: AllocationCriteria }>(req);
    let handle: AllocationHandle;
    try {
      handle = await this.pool.allocate(body.criteria ?? {});
    } catch (err) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: (err as Error).message }));
      return;
    }
    this.socketsByAllocationId.set(handle.allocationId, req.socket);
    res.statusCode = 200;
    res.setHeader('content-type', 'application/x-ndjson');
    res.write(JSON.stringify(handle) + '\n');
    // Stream stays open until the client closes it; that triggers release.
  }
}

function readJson<T>(req: IncomingMessage): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text.length === 0 ? ({} as T) : JSON.parse(text) as T);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}
```

- [ ] **Step 4: Run test**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/adapters/http-server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mobilewright/src/device-pool/adapters/http-server.ts packages/mobilewright/src/device-pool/adapters/http-server.test.ts
git commit -m "feat(device-pool): HTTP server with streaming /allocate"
```

---

## Task 13: HTTP server — `/release` endpoint

**Files:**
- Modify: `packages/mobilewright/src/device-pool/adapters/http-server.ts`
- Modify: `packages/mobilewright/src/device-pool/adapters/http-server.test.ts`

- [ ] **Step 1: Add failing test**

Append to `http-server.test.ts`:

```ts
import { request as httpRequest } from 'node:http';

function postReleaseRequest(url: string, allocationId: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const req = httpRequest(`${url}/release`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.write(JSON.stringify({ allocationId }));
    req.end();
  });
}

test('POST /release frees the slot for the next allocate', async () => {
  const pool = new DevicePool({
    allocator: makeAllocator([{ deviceId: 'd1', platform: 'ios' }]),
    maxSlots: 1,
  });
  const server = await startServer(pool);
  try {
    const firstLine = await postAllocateAndReadFirstLine(server.url, JSON.stringify({ criteria: { platform: 'ios' } }));
    const first = JSON.parse(firstLine);

    const status = await postReleaseRequest(server.url, first.allocationId);
    expect(status).toBe(200);

    const secondLine = await postAllocateAndReadFirstLine(server.url, JSON.stringify({ criteria: { platform: 'ios' } }));
    const second = JSON.parse(secondLine);
    expect(second.deviceId).toBe('d1');
  } finally {
    await server.stop();
  }
});

test('POST /release with unknown allocationId returns 200 (idempotent)', async () => {
  const pool = new DevicePool({
    allocator: makeAllocator([]),
    maxSlots: 1,
  });
  const server = await startServer(pool);
  try {
    const status = await postReleaseRequest(server.url, 'alloc-unknown');
    expect(status).toBe(200);
  } finally {
    await server.stop();
  }
});
```

- [ ] **Step 2: Verify failures**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/adapters/http-server.test.ts`
Expected: FAIL — `/release` returns 404.

- [ ] **Step 3: Add the route**

In `http-server.ts`, extend `handle` to dispatch `/release`:

```ts
private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end();
    return;
  }
  if (req.url === '/allocate') {
    await this.handleAllocate(req, res);
    return;
  }
  if (req.url === '/release') {
    await this.handleRelease(req, res);
    return;
  }
  res.statusCode = 404;
  res.end();
}

private async handleRelease(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson<{ allocationId: string }>(req);
  await this.pool.release(body.allocationId);
  this.socketsByAllocationId.delete(body.allocationId);
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true }));
}
```

- [ ] **Step 4: Run tests**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/adapters/http-server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mobilewright/src/device-pool/adapters/http-server.ts packages/mobilewright/src/device-pool/adapters/http-server.test.ts
git commit -m "feat(device-pool): HTTP server /release endpoint (idempotent)"
```

---

## Task 14: HTTP server — socket-close-as-release

**Files:**
- Modify: `packages/mobilewright/src/device-pool/adapters/http-server.ts`
- Modify: `packages/mobilewright/src/device-pool/adapters/http-server.test.ts`

- [ ] **Step 1: Add failing test**

Append to `http-server.test.ts`:

```ts
function startAllocateRequest(url: string, body: string): Promise<{
  allocationId: string;
  deviceId: string;
  abort: () => void;
}> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${url}/allocate`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx !== -1) {
          const parsed = JSON.parse(buffer.slice(0, newlineIdx));
          resolve({
            allocationId: parsed.allocationId,
            deviceId: parsed.deviceId,
            abort: () => req.destroy(),
          });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

test('closing the /allocate socket releases the allocation', async () => {
  const pool = new DevicePool({
    allocator: makeAllocator([{ deviceId: 'd1', platform: 'ios' }]),
    maxSlots: 1,
  });
  const server = await startServer(pool);
  try {
    const first = await startAllocateRequest(server.url, JSON.stringify({ criteria: { platform: 'ios' } }));
    first.abort();

    // Give the server a microtask to handle the close event.
    await new Promise((r) => setTimeout(r, 50));

    const secondLine = await postAllocateAndReadFirstLine(server.url, JSON.stringify({ criteria: { platform: 'ios' } }));
    const second = JSON.parse(secondLine);
    expect(second.deviceId).toBe('d1');
  } finally {
    await server.stop();
  }
});
```

- [ ] **Step 2: Verify failure**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/adapters/http-server.test.ts`
Expected: FAIL — second allocate hangs because the first wasn't released.

- [ ] **Step 3: Wire socket-close to pool.release**

Update `handleAllocate` in `http-server.ts`:

```ts
private async handleAllocate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson<{ criteria: AllocationCriteria }>(req);
  let handle: AllocationHandle;
  try {
    handle = await this.pool.allocate(body.criteria ?? {});
  } catch (err) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: (err as Error).message }));
    return;
  }
  this.socketsByAllocationId.set(handle.allocationId, req.socket);

  const onClose = () => {
    if (this.socketsByAllocationId.get(handle.allocationId) === req.socket) {
      this.socketsByAllocationId.delete(handle.allocationId);
      void this.pool.release(handle.allocationId);
    }
  };
  req.socket.once('close', onClose);

  res.statusCode = 200;
  res.setHeader('content-type', 'application/x-ndjson');
  res.write(JSON.stringify(handle) + '\n');
}
```

`/release` already deletes from the map first, so explicit release short-circuits the close-handler's release.

- [ ] **Step 4: Run tests**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/adapters/http-server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mobilewright/src/device-pool/adapters/http-server.ts packages/mobilewright/src/device-pool/adapters/http-server.test.ts
git commit -m "feat(device-pool): treat /allocate socket close as release"
```

---

## Task 15: HTTP server — install-tracking and shutdown routes

**Files:**
- Modify: `packages/mobilewright/src/device-pool/adapters/http-server.ts`
- Modify: `packages/mobilewright/src/device-pool/adapters/http-server.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `http-server.test.ts`:

```ts
function postJson(url: string, path: string, body: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

test('/installed/has and /installed/record round-trip', async () => {
  const pool = new DevicePool({
    allocator: makeAllocator([{ deviceId: 'd1', platform: 'ios' }]),
    maxSlots: 1,
  });
  const server = await startServer(pool);
  try {
    const handleLine = await postAllocateAndReadFirstLine(server.url, JSON.stringify({ criteria: { platform: 'ios' } }));
    const handle = JSON.parse(handleLine);

    const before = await postJson(server.url, '/installed/has', {
      allocationId: handle.allocationId,
      bundleId: 'app.ipa',
    });
    expect(JSON.parse(before.body).installed).toBe(false);

    await postJson(server.url, '/installed/record', {
      allocationId: handle.allocationId,
      bundleId: 'app.ipa',
    });

    const after = await postJson(server.url, '/installed/has', {
      allocationId: handle.allocationId,
      bundleId: 'app.ipa',
    });
    expect(JSON.parse(after.body).installed).toBe(true);
  } finally {
    await server.stop();
  }
});

test('/shutdown drains the pool and rejects subsequent allocates', async () => {
  const pool = new DevicePool({
    allocator: makeAllocator([{ deviceId: 'd1', platform: 'ios' }]),
    maxSlots: 1,
  });
  const server = await startServer(pool);
  try {
    const status = await postJson(server.url, '/shutdown', {});
    expect(status.status).toBe(200);

    const after = await postJson(server.url, '/allocate', { criteria: { platform: 'ios' } });
    expect(after.status).toBe(503);
  } finally {
    await server.stop();
  }
});
```

- [ ] **Step 2: Verify failure**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/adapters/http-server.test.ts`
Expected: FAIL — routes return 404.

- [ ] **Step 3: Add the routes**

Extend `handle` and add three handlers:

```ts
private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end();
    return;
  }
  switch (req.url) {
    case '/allocate': await this.handleAllocate(req, res); return;
    case '/release': await this.handleRelease(req, res); return;
    case '/installed/has': await this.handleHasInstalled(req, res); return;
    case '/installed/record': await this.handleRecordInstalled(req, res); return;
    case '/shutdown': await this.handleShutdown(req, res); return;
    default:
      res.statusCode = 404;
      res.end();
  }
}

private async handleHasInstalled(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson<{ allocationId: string; bundleId: string }>(req);
  const installed = this.pool.hasInstalled(body.allocationId, body.bundleId);
  res.statusCode = 200;
  res.end(JSON.stringify({ installed }));
}

private async handleRecordInstalled(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson<{ allocationId: string; bundleId: string }>(req);
  this.pool.recordInstalled(body.allocationId, body.bundleId);
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true }));
}

private async handleShutdown(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  await this.pool.shutdown();
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true }));
}
```

- [ ] **Step 4: Run tests**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/adapters/http-server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mobilewright/src/device-pool/adapters/http-server.ts packages/mobilewright/src/device-pool/adapters/http-server.test.ts
git commit -m "feat(device-pool): HTTP server install-tracking and shutdown routes"
```

---

## Task 16: `HttpDevicePoolClient`

**Files:**
- Create: `packages/mobilewright/src/device-pool/adapters/http-client.ts`
- Create: `packages/mobilewright/src/device-pool/adapters/http-client.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/mobilewright/src/device-pool/adapters/http-client.test.ts
import { test, expect } from '@playwright/test';
import { DevicePool } from '../application/device-pool.js';
import { DevicePoolHttpServer } from './http-server.js';
import { HttpDevicePoolClient } from './http-client.js';
import type { AllocateResult, DeviceAllocator } from '../application/ports.js';

function makeAllocator(devices: AllocateResult[]): DeviceAllocator {
  let i = 0;
  return {
    async allocate() { return devices[i++ % devices.length]; },
    async release() {},
  };
}

interface ServerHandle {
  url: string;
  client: HttpDevicePoolClient;
  stop: () => Promise<void>;
}

async function startServerAndClient(pool: DevicePool): Promise<ServerHandle> {
  const server = new DevicePoolHttpServer({ pool });
  const port = await server.listen();
  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    client: new HttpDevicePoolClient({ baseUrl: url }),
    stop: () => server.close(),
  };
}

test('client.allocate returns a handle from the server', async () => {
  const pool = new DevicePool({
    allocator: makeAllocator([{ deviceId: 'd1', platform: 'ios' }]),
    maxSlots: 1,
  });
  const { client, stop } = await startServerAndClient(pool);
  try {
    const handle = await client.allocate({ platform: 'ios' });
    expect(handle.deviceId).toBe('d1');
    expect(handle.allocationId).toMatch(/^alloc-/);
    await client.release(handle.allocationId);
  } finally {
    await stop();
  }
});

test('client.release frees the device for a subsequent allocate', async () => {
  const pool = new DevicePool({
    allocator: makeAllocator([{ deviceId: 'd1', platform: 'ios' }]),
    maxSlots: 1,
  });
  const { client, stop } = await startServerAndClient(pool);
  try {
    const first = await client.allocate({ platform: 'ios' });
    await client.release(first.allocationId);

    const second = await client.allocate({ platform: 'ios' });
    expect(second.deviceId).toBe('d1');
    await client.release(second.allocationId);
  } finally {
    await stop();
  }
});

test('install-tracking round-trip via client', async () => {
  const pool = new DevicePool({
    allocator: makeAllocator([{ deviceId: 'd1', platform: 'ios' }]),
    maxSlots: 1,
  });
  const { client, stop } = await startServerAndClient(pool);
  try {
    const handle = await client.allocate({ platform: 'ios' });
    expect(await client.hasInstalled(handle.allocationId, 'a.ipa')).toBe(false);
    await client.recordInstalled(handle.allocationId, 'a.ipa');
    expect(await client.hasInstalled(handle.allocationId, 'a.ipa')).toBe(true);
    await client.release(handle.allocationId);
  } finally {
    await stop();
  }
});
```

- [ ] **Step 2: Verify failure**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/adapters/http-client.test.ts`
Expected: FAIL — `HttpDevicePoolClient` not defined.

- [ ] **Step 3: Implement**

```ts
// packages/mobilewright/src/device-pool/adapters/http-client.ts
import { Agent, request, type ClientRequest } from 'node:http';
import type {
  AllocationCriteria,
  AllocationHandle,
  DevicePoolClient,
} from '../application/ports.js';

export interface HttpDevicePoolClientOptions {
  baseUrl: string;
}

export class HttpDevicePoolClient implements DevicePoolClient {
  private readonly baseUrl: string;
  private readonly agent: Agent;
  private readonly openAllocateRequests = new Map<string, ClientRequest>();

  constructor(options: HttpDevicePoolClientOptions) {
    this.baseUrl = options.baseUrl;
    this.agent = new Agent({ keepAlive: true });
  }

  allocate(criteria: AllocationCriteria): Promise<AllocationHandle> {
    return new Promise<AllocationHandle>((resolve, reject) => {
      const url = new URL('/allocate', this.baseUrl);
      const req = request({
        method: 'POST',
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        agent: this.agent,
        headers: { 'content-type': 'application/json' },
      }, (res) => {
        if (res.statusCode !== 200) {
          let buffer = '';
          res.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
          res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${buffer}`)));
          return;
        }
        let buffer = '';
        const onData = (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          const newlineIdx = buffer.indexOf('\n');
          if (newlineIdx === -1) {
            return;
          }
          const handle = JSON.parse(buffer.slice(0, newlineIdx)) as AllocationHandle;
          res.off('data', onData);
          this.openAllocateRequests.set(handle.allocationId, req);
          resolve(handle);
        };
        res.on('data', onData);
        res.on('error', reject);
      });
      req.on('error', reject);
      req.write(JSON.stringify({ criteria }));
      req.end();
    });
  }

  async release(allocationId: string): Promise<void> {
    const openReq = this.openAllocateRequests.get(allocationId);
    if (openReq) {
      this.openAllocateRequests.delete(allocationId);
      openReq.destroy();
    }
    await this.postJson('/release', { allocationId });
  }

  async hasInstalled(allocationId: string, bundleId: string): Promise<boolean> {
    const body = await this.postJson<{ installed: boolean }>('/installed/has', { allocationId, bundleId });
    return body.installed;
  }

  async recordInstalled(allocationId: string, bundleId: string): Promise<void> {
    await this.postJson('/installed/record', { allocationId, bundleId });
  }

  private postJson<T = unknown>(path: string, body: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const req = request({
        method: 'POST',
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        agent: this.agent,
        headers: { 'content-type': 'application/json' },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${text}`));
            return;
          }
          resolve(text.length === 0 ? ({} as T) : JSON.parse(text) as T);
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.write(JSON.stringify(body));
      req.end();
    });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/device-pool/adapters/http-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mobilewright/src/device-pool/adapters/http-client.ts packages/mobilewright/src/device-pool/adapters/http-client.test.ts
git commit -m "feat(device-pool): HttpDevicePoolClient implementing DevicePoolClient"
```

---

## Task 17: Refactor `launchers.ts` — extract composable pieces

**Files:**
- Modify: `packages/mobilewright/src/launchers.ts`

The goal: split `launch()` into three named pieces that the new test path can also use, without changing public behavior of `ios.launch()` / `android.launch()`.

- [ ] **Step 1: Read the current file**

Read `packages/mobilewright/src/launchers.ts` end-to-end.

- [ ] **Step 2: Replace the file**

```ts
// packages/mobilewright/src/launchers.ts
import type { Platform, DeviceInfo, MobilewrightDriver } from '@mobilewright/protocol';
import { Device } from '@mobilewright/core';
import { MobilecliDriver, DEFAULT_URL } from '@mobilewright/driver-mobilecli';
import { MobileUseDriver } from '@mobilewright/driver-mobile-use';
import { ensureMobilecliReachable } from './server.js';
import type { DriverConfig } from './config.js';

export interface LaunchOptions {
  bundleId?: string;
  installApps?: string | string[];
  autoAppLaunch?: boolean;
  deviceId?: string;
  deviceName?: RegExp;
  url?: string;
  timeout?: number;
  autoStart?: boolean;
  driver?: DriverConfig;
}

interface PlatformLauncher {
  launch(opts?: LaunchOptions): Promise<Device>;
  devices(): Promise<DeviceInfo[]>;
}

export interface ConnectDeviceParams {
  platform: Platform;
  deviceId: string;
  driverConfig?: DriverConfig;
  url?: string;
  timeout?: number;
}

/** Resolve the driver instance given a config (mobilecli is the default). */
export function createDriver(driverConfig?: DriverConfig, url?: string): MobilewrightDriver {
  if (driverConfig?.type === 'mobile-use') {
    return new MobileUseDriver({
      region: driverConfig.region,
      apiKey: driverConfig.apiKey,
    });
  }
  return new MobilecliDriver({ url });
}

/** Connect a fresh Device to a known deviceId. Used by both the test fixture and ios.launch(). */
export async function connectDevice(params: ConnectDeviceParams): Promise<Device> {
  const url = params.url ?? DEFAULT_URL;
  const driver = createDriver(params.driverConfig, url);
  const device = new Device(driver);
  await device.connect({
    url,
    platform: params.platform,
    deviceId: params.deviceId,
    timeout: params.timeout,
  });
  return device;
}

/** Install (if needed) any apps in `installApps`, then optionally launch the bundleId app. */
export async function installAndLaunchApps(device: Device, opts: LaunchOptions): Promise<void> {
  const appsToInstall = opts.installApps
    ? (Array.isArray(opts.installApps) ? opts.installApps : [opts.installApps])
    : [];
  for (const appPath of appsToInstall) {
    await device.installApp(appPath);
  }
  if (opts.bundleId && opts.autoAppLaunch !== false) {
    await device.launchApp(opts.bundleId);
  }
}

/** Find a device matching criteria. Used by both the public launch() and the MobilecliAllocator. */
export async function findDevice(opts: {
  platform: Platform;
  deviceId?: string;
  deviceName?: RegExp;
  driverConfig?: DriverConfig;
  url?: string;
}): Promise<DeviceInfo> {
  const url = opts.url ?? DEFAULT_URL;
  const driver = createDriver(opts.driverConfig, url);
  const devices = await driver.listDevices({ platform: opts.platform });

  for (const device of devices) {
    if (device.state !== 'online') {
      continue;
    }
    if (opts.deviceId && device.id !== opts.deviceId) {
      continue;
    }
    if (opts.deviceName && !opts.deviceName.test(device.name)) {
      continue;
    }
    return device;
  }
  throw new Error(`no online ${opts.platform} device found`);
}

function createLauncher(platform: Platform): PlatformLauncher {
  return {
    async launch(opts: LaunchOptions = {}): Promise<Device> {
      const driverConfig = opts.driver;
      const url = opts.url ?? DEFAULT_URL;

      let serverProcess: { kill: () => void } | undefined;
      if (!driverConfig || driverConfig.type === 'mobilecli') {
        const ensured = await ensureMobilecliReachable(url, { autoStart: opts.autoStart ?? true });
        serverProcess = ensured.serverProcess ?? undefined;
      }

      const found = await findDevice({
        platform,
        deviceId: opts.deviceId,
        deviceName: opts.deviceName,
        driverConfig,
        url,
      });

      const device = await connectDevice({
        platform,
        deviceId: found.id,
        driverConfig,
        url,
        timeout: opts.timeout,
      });

      if (serverProcess) {
        const proc = serverProcess;
        device.onClose(() => Promise.resolve(proc.kill()).then(() => undefined));
      }

      await installAndLaunchApps(device, opts);
      return device;
    },

    async devices(): Promise<DeviceInfo[]> {
      const driver = new MobilecliDriver();
      return driver.listDevices({ platform });
    },
  };
}

/** iOS platform launcher */
export const ios = createLauncher('ios');

/** Android platform launcher */
export const android = createLauncher('android');
```

Note: the previous launcher had a separate code path for mobile-use that didn't list devices first. The new version unifies through `findDevice` and `connectDevice`. For mobile-use, `listDevices()` works too (the driver implements it), so the unified path is fine for scripting.

- [ ] **Step 3: Verify type check**

Run: `npm run lint`
Expected: PASS — no type errors.

- [ ] **Step 4: Smoke run any existing launcher-using example or test**

Run: `npx playwright test --config=tests/mobilewright.config.ts`
Expected: All existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/mobilewright/src/launchers.ts
git commit -m "refactor(launchers): extract findDevice / connectDevice / installAndLaunchApps"
```

---

## Task 18: `device-pool/setup.ts` and `teardown.ts` (composition root)

**Files:**
- Create: `packages/mobilewright/src/device-pool/setup.ts`
- Create: `packages/mobilewright/src/device-pool/teardown.ts`
- Create: `packages/mobilewright/src/device-pool/client-factory.ts`
- Modify: `packages/mobilewright/src/index.ts` (export `createDevicePoolClient`)

This task wires the application + adapters together. It's a composition step, not a TDD-amenable unit; the round-trip behavior is already covered by the http-client tests.

- [ ] **Step 1: Write `client-factory.ts`**

```ts
// packages/mobilewright/src/device-pool/client-factory.ts
import { HttpDevicePoolClient } from './adapters/http-client.js';
import type { DevicePoolClient } from './application/ports.js';

export const COORDINATOR_URL_ENV = 'MOBILEWRIGHT_COORDINATOR_URL';

/**
 * Internal factory used by the test fixture. Throws if the coordinator was
 * not started (i.e. the user bypassed `defineConfig`).
 */
export function createDevicePoolClient(): DevicePoolClient {
  const baseUrl = process.env[COORDINATOR_URL_ENV];
  if (!baseUrl) {
    throw new Error(
      `${COORDINATOR_URL_ENV} is not set. ` +
      'Did you use defineConfig() in your mobilewright.config.ts? ' +
      'It auto-injects the device-pool coordinator.',
    );
  }
  return new HttpDevicePoolClient({ baseUrl });
}
```

- [ ] **Step 2: Write `setup.ts`**

```ts
// packages/mobilewright/src/device-pool/setup.ts
import { ensureMobilecliReachable } from '../server.js';
import { DEFAULT_URL } from '@mobilewright/driver-mobilecli';
import { MobilecliDriver } from '@mobilewright/driver-mobilecli';
import { DevicePool } from './application/device-pool.js';
import { DevicePoolHttpServer } from './adapters/http-server.js';
import { MobilecliAllocator } from './adapters/mobilecli-allocator.js';
import { MobileUseAllocator } from './adapters/mobile-use-allocator.js';
import { COORDINATOR_URL_ENV } from './client-factory.js';
import { loadConfig } from '../config.js';
import type { DeviceAllocator } from './application/ports.js';

interface ActiveCoordinator {
  pool: DevicePool;
  server: DevicePoolHttpServer;
  serverProcess?: { kill: () => void };
}

let active: ActiveCoordinator | undefined;

/** Playwright globalSetup entry point. Returns a teardown function. */
export default async function setup(): Promise<() => Promise<void>> {
  const config = await loadConfig();
  const driverType = config.driver?.type ?? 'mobilecli';

  let allocator: DeviceAllocator;
  let serverProcess: { kill: () => void } | undefined;

  if (driverType === 'mobilecli') {
    const url = config.url ?? DEFAULT_URL;
    const ensured = await ensureMobilecliReachable(url, { autoStart: config.autoStart ?? true });
    serverProcess = ensured.serverProcess ?? undefined;
    allocator = new MobilecliAllocator({ driver: new MobilecliDriver({ url }) });
  } else {
    allocator = new MobileUseAllocator();
  }

  const maxSlots = typeof config.workers === 'number' ? config.workers : 1;
  const pool = new DevicePool({ allocator, maxSlots });
  const server = new DevicePoolHttpServer({ pool });
  const port = await server.listen();

  process.env[COORDINATOR_URL_ENV] = `http://127.0.0.1:${port}`;
  active = { pool, server, serverProcess };

  return async () => {
    if (!active) {
      return;
    }
    await active.pool.shutdown();
    await active.server.close();
    if (active.serverProcess) {
      active.serverProcess.kill();
    }
    delete process.env[COORDINATOR_URL_ENV];
    active = undefined;
  };
}
```

- [ ] **Step 3: Write `teardown.ts`**

```ts
// packages/mobilewright/src/device-pool/teardown.ts
/**
 * Playwright globalTeardown entry point. The setup function returns its own
 * teardown, which Playwright runs automatically — so this file exists only as
 * a safety net for unusual config wiring. It is a no-op.
 */
export default async function teardown(): Promise<void> {
  // intentionally empty — setup() returns its own teardown.
}
```

- [ ] **Step 4: Export client factory from `mobilewright`**

Modify `packages/mobilewright/src/index.ts`:

```ts
// Platform launchers — the primary entry point
export { ios, android, type LaunchOptions } from './launchers.js';

// Assertions
export { expect } from '@mobilewright/core';

// Core classes (for advanced use)
export { Device, Screen, Locator } from '@mobilewright/core';

// Configuration
export { defineConfig, loadConfig, type MobilewrightConfig, type MobilewrightProjectConfig, type MobilewrightUseOptions, type DriverConfig, type DriverConfigMobilecli, type DriverConfigMobileUse } from './config.js';

// Errors
export { MobilewrightError } from './errors.js';

// Internal — used by @mobilewright/test fixtures. Not part of the public API.
export { createDevicePoolClient } from './device-pool/client-factory.js';
export { connectDevice, installAndLaunchApps } from './launchers.js';
export type { DevicePoolClient, AllocationHandle, AllocationCriteria } from './device-pool/application/ports.js';
```

- [ ] **Step 5: Type check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/mobilewright/src/device-pool/setup.ts packages/mobilewright/src/device-pool/teardown.ts packages/mobilewright/src/device-pool/client-factory.ts packages/mobilewright/src/index.ts
git commit -m "feat(device-pool): composition root (setup/teardown) and client factory"
```

---

## Task 19: `defineConfig` auto-injection

**Files:**
- Modify: `packages/mobilewright/src/config.ts`

- [ ] **Step 1: Write failing test**

Create `packages/mobilewright/src/config.test.ts`:

```ts
import { test, expect } from '@playwright/test';
import { defineConfig } from './config.js';

test('defineConfig injects globalSetup pointing at device-pool/setup.js', () => {
  const config = defineConfig({});
  expect(typeof config.globalSetup).toBe('string');
  expect(config.globalSetup as string).toMatch(/device-pool[\/\\]setup\.js$/);
});

test('defineConfig composes user globalSetup before the user expects', () => {
  const config = defineConfig({ globalSetup: '/custom/setup.js' });
  const setups = Array.isArray(config.globalSetup) ? config.globalSetup : [config.globalSetup];
  expect(setups[0]).toMatch(/device-pool[\/\\]setup\.js$/);
  expect(setups).toContain('/custom/setup.js');
});

test('defineConfig defaults workers to 1', () => {
  const config = defineConfig({});
  expect(config.workers).toBe(1);
});

test('defineConfig respects user-provided workers', () => {
  const config = defineConfig({ workers: 4 });
  expect(config.workers).toBe(4);
});
```

- [ ] **Step 2: Verify failure**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/config.test.ts`
Expected: FAIL — current `defineConfig` doesn't inject globalSetup.

- [ ] **Step 3: Update `defineConfig`**

In `packages/mobilewright/src/config.ts`, replace the function:

```ts
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function defineConfig(config: MobilewrightConfig): MobilewrightConfig {
  const ourSetup = _require.resolve('./device-pool/setup.js');
  const ourTeardown = _require.resolve('./device-pool/teardown.js');
  const userSetups = toArray(config.globalSetup);
  const userTeardowns = toArray(config.globalTeardown);

  return {
    workers: 1,
    ...config,
    globalSetup: userSetups.length > 0 ? [ourSetup, ...userSetups] : ourSetup,
    globalTeardown: userTeardowns.length > 0 ? [...userTeardowns, ourTeardown] : ourTeardown,
  };
}
```

The existing `MobilewrightConfig.globalSetup` type is `string`; widen it to `string | string[]` to accept arrays:

```ts
globalSetup?: string | string[];
globalTeardown?: string | string[];
```

- [ ] **Step 4: Run tests**

Run: `npx playwright test --config=tests/mobilewright.config.ts packages/mobilewright/src/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mobilewright/src/config.ts packages/mobilewright/src/config.test.ts
git commit -m "feat(config): defineConfig auto-injects device-pool setup/teardown"
```

---

## Task 20: Update test fixture to use `DevicePoolClient`

**Files:**
- Modify: `packages/test/src/fixtures.ts`
- Modify: `packages/test/package.json` (add `mobilewright` dep)
- Modify: `packages/test/tsconfig.json` (already references mobilewright; verify)

- [ ] **Step 1: Add the missing dep declaration**

Edit `packages/test/package.json`, change:

```json
"dependencies": {
  "@mobilewright/core": "^0.0.1",
  "@mobilewright/protocol": "^0.0.1",
  "@playwright/test": "1.58.2"
},
```

to:

```json
"dependencies": {
  "@mobilewright/core": "^0.0.1",
  "@mobilewright/protocol": "^0.0.1",
  "@playwright/test": "1.58.2",
  "mobilewright": "^0.0.1"
},
```

- [ ] **Step 2: Replace `fixtures.ts`**

```ts
// packages/test/src/fixtures.ts
import { test as base } from '@playwright/test';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createDevicePoolClient,
  connectDevice,
  loadConfig,
} from 'mobilewright';
import { expect } from '@mobilewright/core';
import type { Device, Screen } from '@mobilewright/core';

type MobilewrightTestFixtures = {
  screen: Screen;
  bundleId: string | undefined;
  platform: 'ios' | 'android' | undefined;
  deviceName: RegExp | undefined;
  device: Device;
};

const client = createDevicePoolClient();

export const test = base.extend<MobilewrightTestFixtures>({
  bundleId: [async ({}, use) => {
    const config = await loadConfig();
    await use(config.bundleId);
  }, { option: true }],

  platform: [undefined, { option: true }],
  deviceName: [undefined, { option: true }],

  device: async ({ platform, deviceName, bundleId }, use) => {
    const config = await loadConfig();
    const merged = {
      ...config,
      ...(platform && { platform }),
      ...(deviceName && { deviceName }),
    };
    if (merged.platform !== 'ios' && merged.platform !== 'android') {
      throw new Error(`Unsupported platform: "${merged.platform}". Must be "ios" or "android".`);
    }

    const handle = await client.allocate({
      platform: merged.platform,
      deviceNamePattern: merged.deviceName?.source,
      deviceId: merged.deviceId,
    });

    const device = await connectDevice({
      platform: handle.platform,
      deviceId: handle.deviceId,
      driverConfig: merged.driver,
      url: merged.url,
      timeout: merged.timeout,
    });

    try {
      const appsToInstall = merged.installApps
        ? (Array.isArray(merged.installApps) ? merged.installApps : [merged.installApps])
        : [];
      for (const appPath of appsToInstall) {
        const installed = await client.hasInstalled(handle.allocationId, appPath);
        if (!installed) {
          await device.installApp(appPath);
          await client.recordInstalled(handle.allocationId, appPath);
        }
      }

      if (bundleId) {
        try {
          await device.terminateApp(bundleId);
        } catch {
          // app may not be running
        }
        await device.launchApp(bundleId);
      }

      await use(device);
    } finally {
      await device.disconnect();
      await client.release(handle.allocationId);
    }
  },

  screen: async ({ device, video }, use, testInfo) => {
    const videoMode = typeof video === 'object' ? video.mode : video;
    const shouldRecord = videoMode === 'on' || videoMode === 'retain-on-failure';
    const videoPath = shouldRecord
      ? join(testInfo.outputDir, `video-${testInfo.testId}.mp4`)
      : '';

    if (shouldRecord) {
      try {
        await mkdir(testInfo.outputDir, { recursive: true });
        await device.startRecording({ output: videoPath });
      } catch {
        // recording may not be supported — continue without it
      }
    }

    await use(device.screen);

    if (shouldRecord) {
      try {
        await device.stopRecording();
        const failed = testInfo.status !== testInfo.expectedStatus;
        const shouldAttach = videoMode === 'on' || (videoMode === 'retain-on-failure' && failed);

        if (shouldAttach) {
          const videoBuffer = await readFile(videoPath);
          await testInfo.attach('video', { body: videoBuffer, contentType: 'video/mp4' });
        }

        await unlink(videoPath).catch(() => {});
      } catch {
        // best effort — recording may have failed to start
      }
    }

    if (testInfo.status !== testInfo.expectedStatus) {
      try {
        const screenshot = await device.screen.screenshot();
        await testInfo.attach('screenshot-on-failure', { body: screenshot, contentType: 'image/png' });
      } catch {
        // device may be disconnected
      }
    }
  },
});

export { expect };
```

Notes:
- The fixture now hard-codes `MobilecliDriver` for the worker-side connection. mobile-use is gated to never reach this path because its allocator stub throws.
- `client` is created at module load. Each worker process imports the fixture once; one client instance per process is fine.

- [ ] **Step 3: Type check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/test/src/fixtures.ts packages/test/package.json
git commit -m "feat(test): rewire device fixture to use DevicePoolClient (test scope)"
```

---

## Task 21: End-to-end smoke verification

**Files:**
- No new files. Run existing tests against a real environment.

This is a manual verification step. The unit tests so far are all green; this confirms the wiring works end-to-end on an actual device.

- [ ] **Step 1: Build the workspace**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 2: Run the unit-test suite**

Run: `npm test`
Expected: PASS — all `*.test.ts` under `packages/*/src/` green.

- [ ] **Step 3: Run the e2e suite (requires a connected device or simulator)**

Run: `cd e2e && npx mobilewright test`
Expected: tests pass. The first device allocation may take time; subsequent retries (if any test fails and retries are configured) reuse the same device.

- [ ] **Step 4: Verify retry behavior**

Edit `e2e/src/driver-ios.test.ts` to introduce a transient failure on the first run (e.g. a deliberately wrong assertion gated by an env var that you flip after the first attempt). Set `retries: 1` in `e2e/mobilewright.config.ts`. Re-run:

Run: `cd e2e && npx mobilewright test`
Expected: first attempt fails, retry passes. Examine the run log: confirm only one device allocation happened (no second `MobilecliAllocator.allocate` call). Revert the synthetic failure.

- [ ] **Step 5: Verify multi-worker scaling**

Set `workers: 2` in the e2e config and add a second test file that runs in parallel.

Run: `cd e2e && npx mobilewright test --workers=2`
Expected: two devices allocated, two tests run in parallel, one device per worker.

- [ ] **Step 6: Commit any documentation updates**

If anything in `README.md` or `CLAUDE.md` referenced the old worker-scoped device fixture, update it.

```bash
git add -p
git commit -m "docs: note that device fixture is per-test (pool-managed)"
```

---

## Self-review checklist

After implementing all tasks, verify the following before declaring done:

- [ ] All `*.test.ts` files green: `npm test`.
- [ ] Type check clean: `npm run lint`.
- [ ] Spec requirements covered:
  - Slow allocation runs at most once per pool slot (Task 5 — slot reuse).
  - N workers → N devices (Task 5 — concurrent allocation).
  - Retry doesn't reallocate (Task 14 — socket-close-as-release; Task 21 step 4 — manual verification).
  - Fast device picks up tests (emergent from Task 20 — fixture leases per test).
  - Public API surface unchanged (Task 20 — fixture imports same types).
- [ ] No `TODO`, `TBD`, or placeholder text in any committed file.
- [ ] No `if` statement without `{ }` braces.
- [ ] No `await` used inline (always assigned to a variable first).
- [ ] No new use of `exec`/`execSync`/`execFile` (none added in this plan).
