---
title: Retries
description: Automatically retry failing tests.
sidebar:
  order: 3
---

Mobile tests can be flaky due to timing, network, or device state. Mobilewright can automatically retry a failing test up to a configured number of times before marking it as failed.

## Configuring retries

In `mobilewright.config.ts`:

```ts
export default defineConfig({
  retries: 2,
});
```

Or on the command line:

```bash
npx mobilewright test --retries=2
```

A test that passes on its first attempt is **passed**. A test that fails on the first attempt but passes on a later retry is **flaky**. A test that fails all attempts is **failed**.

## What happens on retry

When a test fails and has retries remaining, Mobilewright:

1. Tears down the test (disconnects the device).
2. **Returns the device to the pool** — it is not re-allocated. The same physical device is reused for the retry.
3. Reconnects to the device and resets the app (terminate + relaunch the `bundleId`).
4. Runs the test again.

This means retries are fast — device allocation only happens once at the start of the test run, not once per retry attempt.

## Detecting retries in test code

Use `testInfo.retry` to check whether the current execution is a retry. This is useful for clearing cached state before re-running:

```ts
import { test } from '@mobilewright/test';

test('checkout flow', async ({ device, screen }, testInfo) => {
  if (testInfo.retry) {
    // clear session data that might have been left behind
  }
  // ... rest of test
});
```

`testInfo.retry` is `0` on the first attempt, `1` on the first retry, and so on.

## Per-test and per-group retries

Override the global retry count for a specific test or describe block:

```ts
test('flaky upload', { retries: 3 }, async ({ screen }) => {
  // ...
});

test.describe('checkout', () => {
  test.describe.configure({ retries: 2 });
  test('add to cart', async ({ screen }) => { /* ... */ });
  test('pay', async ({ screen }) => { /* ... */ });
});
```

## Retries with serial mode

When a `test.describe.configure({ mode: 'serial' })` block fails, the entire group retries together from the beginning. This guarantees that stateful tests (where later tests depend on the outcome of earlier ones) are always re-run as a unit.

```ts
test.describe.configure({ mode: 'serial' });

test('sign in', async ({ screen }) => { /* ... */ });
test('add to cart', async ({ screen }) => { /* ... */ });
test('complete purchase', async ({ screen }) => { /* ... */ });
```

If "add to cart" fails, both "sign in" and "add to cart" (and "complete purchase") retry together from the start.

## Retries in CI

A common pattern is to allow retries in CI but not locally, to keep local feedback fast:

```ts
export default defineConfig({
  retries: process.env.CI ? 2 : 0,
});
```
