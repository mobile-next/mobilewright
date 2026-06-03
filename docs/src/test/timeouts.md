---
title: Timeouts
description: Configure timeouts for tests, assertions, actions, and device operations.
sidebar:
  order: 5
---

Mobilewright follows Playwright's timeout model. There are several independent timeout layers, each controlling a different part of the test lifecycle. All timeouts are in milliseconds.

## Timeout overview

| Timeout | Default | Config location | Description |
|---|---|---|---|
| Test timeout | 30 000 | `timeout` | Limits a single test (setup + body + teardown) |
| Global timeout | none | `globalTimeout` | Caps the entire test run |
| Action timeout | 5 000 | `use.actionTimeout` | Limits a single locator action (`tap`, `fill`, etc.) |
| Expect timeout | 5 000 | `expect.timeout` | Limits a single assertion (`toBeVisible`, `toHaveText`, etc.) |
| App launch timeout | 20 000 | `use.appLaunchTimeout` | Limits waiting for the app to reach the foreground |
| Install timeout | none | `use.installTimeout` | Limits app installation (`installApps`) |
| Allocation timeout | 5 min | `driver.allocationTimeout` | Limits waiting for a cloud device (mobilenext only) |
| Upload timeout | none | `driver.uploadTimeout` | Limits test result upload (mobilenext only) |

---

## Test timeout

A test fails if it does not complete within the test timeout. This includes fixture setup, the test body, and `beforeEach` / `afterEach` hooks.

```ts
// mobilewright.config.ts
export default defineConfig({
  timeout: 60_000, // 60 seconds
});
```

Override for a single test:

```ts
test('slow workflow', async ({ screen }) => {
  test.setTimeout(120_000);
  // ...
});
```

Extend the current timeout instead of replacing it (useful in `beforeEach`):

```ts
test.beforeEach(async ({}, testInfo) => {
  testInfo.setTimeout(testInfo.timeout + 30_000);
});
```

---

## Expect timeout

Auto-retrying assertions poll until they pass or the expect timeout expires. Applies to `toBeVisible`, `toHaveText`, `toBeEnabled`, and all other `expect()` assertions.

```ts
export default defineConfig({
  expect: {
    timeout: 10_000,
  },
});
```

Override for a single assertion:

```ts
await expect(screen.getByText('Order confirmed')).toBeVisible({ timeout: 15_000 });
```

---

## Action timeout

Limits individual locator actions: `tap`, `fill`, `longPress`, `getText`, `isVisible`, and so on. The action fails if the element is not found and actionable within this time.

```ts
export default defineConfig({
  use: {
    actionTimeout: 10_000,
  },
});
```

Override for a single action:

```ts
await screen.getByRole('button', { name: 'Submit' }).tap({ timeout: 5_000 });
```

---

## Global timeout

Stops the entire test run after the given duration. Useful in CI to prevent a runaway test suite from consuming hours of build time. There is no default — omitting it means the run can take as long as it needs.

```ts
export default defineConfig({
  globalTimeout: 30 * 60_000, // 30 minutes
});
```

---

## App launch timeout

Real devices can be significantly slower to launch apps than simulators. This timeout limits how long Mobilewright waits for the app to reach the foreground after `launchApp()` is called.

```ts
export default defineConfig({
  use: {
    appLaunchTimeout: 60_000, // 60 seconds for slow real devices
  },
});
```

---

## Install timeout

When `installApps` is set, Mobilewright installs the app before each test run. Installation can be slow over USB or on cloud devices. By default there is no limit.

```ts
export default defineConfig({
  use: {
    installTimeout: 3 * 60_000, // 3 minutes
  },
});
```

---

## Cloud device timeouts (mobilenext)

These timeouts apply only when using the `mobilenext` driver.

### Allocation timeout

Cloud devices are allocated from a shared pool. Under load, a device may not be immediately available. This timeout limits how long Mobilewright waits before giving up.

```ts
export default defineConfig({
  driver: {
    type: 'mobilenext',
    apiKey: process.env.MOBILENEXT_API_KEY,
    allocationTimeout: 15 * 60_000, // 15 minutes
  },
});
```

### Upload timeout

When `testResult` is configured, Mobilewright uploads the test report to mobilenext.ai after the run. This timeout limits how long that upload may take.

```ts
export default defineConfig({
  driver: {
    type: 'mobilenext',
    apiKey: process.env.MOBILENEXT_API_KEY,
    testResult: { uploadReport: 'on' },
    uploadTimeout: 2 * 60_000, // 2 minutes
  },
});
```

---

## Full example

```ts
// mobilewright.config.ts
import { defineConfig } from 'mobilewright';

export default defineConfig({
  timeout: 60_000,
  globalTimeout: 30 * 60_000,

  use: {
    actionTimeout: 10_000,
    appLaunchTimeout: 45_000,
    installTimeout: 3 * 60_000,
  },

  expect: {
    timeout: 10_000,
  },

  driver: {
    type: 'mobilenext',
    apiKey: process.env.MOBILENEXT_API_KEY,
    allocationTimeout: 15 * 60_000,
    uploadTimeout: 2 * 60_000,
    testResult: { uploadReport: 'on-failure' },
  },
});
```
