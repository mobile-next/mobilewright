---
title: Parallelism
description: Run tests across multiple devices in parallel.
sidebar:
  order: 1
---

Mobilewright runs tests in parallel using **workers** — independent processes that each hold a connection to one physical device or simulator. The number of workers is the number of devices running tests at the same time.

## Workers = devices

Each worker talks to exactly one device. With `--workers 2`, Mobilewright allocates two simulators (or physical devices) and runs two tests concurrently, one per device.

The device pool is managed automatically: if you request more workers than devices are available, excess workers wait until a device is free rather than failing immediately.

## Enabling parallelism

By default, `workers` is `1` and tests within a single file run sequentially on one device. To use multiple devices you need two things:

**1. Increase the worker count** — in config or on the command line:

```ts
// mobilewright.config.ts
export default defineConfig({
  workers: 2,
});
```

```bash
npx mobilewright test --workers 2
```

**2. Set `fullyParallel: true`** — without this, all tests in the same file are sent to the same worker and run sequentially, so only one device is used regardless of worker count:

```ts
export default defineConfig({
  workers: 2,
  fullyParallel: true,
});
```

With both set, each individual test runs in its own worker and each worker uses its own device. Nine tests with two workers and two simulators means two tests run at a time, alternating across simulators as tests complete.

## Per-file parallelism

To parallelize tests within one file without enabling `fullyParallel` globally, add this at the top of the file:

```ts
test.describe.configure({ mode: 'parallel' });
```

## Serial mode

Some test files have tests that depend on each other — for example, a sequence that logs in, navigates, and checks state. Mark them serial so they run on the same device in order:

```ts
test.describe.configure({ mode: 'serial' });
```

With serial mode, if one test fails the rest of the group are skipped. The entire group is retried together when `retries` is set.

Serial mode is discouraged when tests can be made independent. Independent tests are more reliable and run faster across devices.

## Controlling test file order

Tests within a file always run in the order they are declared. Test files, however, run in alphabetical order. Passing files on the command line only filters which files run — it does not change their order:

```bash
# still runs inbox.spec.ts before login.spec.ts
npx mobilewright test login.spec.ts inbox.spec.ts
```

The simplest way to order files is to prefix their names, e.g. `01-login.spec.ts`, `02-inbox.spec.ts`.

For explicit control, use a test list file. Each spec exports a function that declares its tests, and a single entry file calls them in the order you want:

```ts
// tests/login.spec.ts
import { test } from '@mobilewright/test';

export default function () {
  test('user can log in', async ({ screen }) => {
    // ...
  });
}
```

```ts
// tests/test.list.ts
import { test } from '@mobilewright/test';
import loginTests from './login.spec.js';
import inboxTests from './inbox.spec.js';

test.describe(loginTests);
test.describe(inboxTests);
```

Then point `testMatch` at the list file, so the spec files are not also collected on their own:

```ts
export default defineConfig({
  testDir: './tests',
  testMatch: 'test.list.ts',
  fullyParallel: false,
});
```

Add `test.describe.configure({ mode: 'serial' })` at the top of `test.list.ts` if later files should be skipped when an earlier one fails.

## How the device pool works

When a test starts, Mobilewright's device pool assigns it a device:

1. If a device is already allocated and free, the test takes it immediately.
2. If no device is free but the pool has not reached the worker cap, a new device is allocated in the background. The test waits until it is ready.
3. If the pool is full and all devices are in use, the test waits for any device to be released.

Allocation is lazy: devices are acquired on demand, not all up front. If the first device allocates in one second and the second takes five minutes, the first test starts immediately without waiting for the second.

When a test finishes, its device is returned to the pool and reused by the next waiting test. Devices are never re-allocated between tests — only between test runs (i.e., at startup and shutdown).

## Workers on CI

On CI, cap workers to match the number of physical devices or simulators you have provisioned:

```ts
export default defineConfig({
  workers: process.env.CI ? 4 : 1,
  fullyParallel: true,
});
```

For larger test suites, combine parallelism with [sharding](/test/sharding) to split the suite across multiple CI machines.
