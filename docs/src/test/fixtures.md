---
sidebar_position: 2
title: Fixtures
---

# Fixtures

Mobilewright uses fixtures to set up the environment each test needs. Instead of writing setup and teardown logic in every test, you declare which fixtures your test requires, and the framework handles the rest.

## Built-in fixtures

### `screen`

The most commonly used fixture. It gives you access to the device screen, where you can find elements and interact with them.

```typescript
import { test, expect } from '@mobilewright/test';

test('shows welcome message', async ({ screen }) => {
  await expect(screen.getByText('Welcome')).toBeVisible();
});
```

The `screen` fixture is scoped to each test. It also handles video recording and captures a screenshot on test failure, attaching both to the test report.

### `device`

Provides direct control over the mobile device. Use it when you need to perform device-level operations beyond screen interactions.

```typescript
import { test } from '@mobilewright/test';

test('launch a different app', async ({ device }) => {
  const screen = await device.launchApp('com.example.other');
  // ...
});
```

The `device` fixture is shared across all tests in a worker, so the device is launched once and reused.

### `app`

The app under test: the one set by `bundleId`. It is the same as `device.app(bundleId)`.

```typescript
import { test } from '@mobilewright/test';

test.use({ bundleId: 'com.example.app' });

test('starts clean', async ({ app, device }) => {
  await app.clearData();
  await device.launchApp(app.bundleId);
});
```

`app.clearData()` clears the app's data and stops the app, so launch it again with `device.launchApp()`. `app.bundleId` is the app's bundle id. It also resets the app's permissions on Android and on iOS simulators, except notifications on a simulator. On a real iOS device it throws, because clearing app data is not supported there.

The `app` fixture needs a `bundleId`, from the config or from `test.use({ bundleId })`. A test that asks for `app` without one fails during setup.

The app is already running when the test starts. To clear its data before the first launch, set `autoAppLaunch: false` and launch it yourself.

## Configuration overrides

You can override the following settings per-test or per-project, in addition to what's set in `mobilewright.config.ts`:

| Option | Type | Description |
|--------|------|-------------|
| `platform` | `'ios' \| 'android'` | Target platform |
| `deviceId` | `string` | Specific device ID |
| `deviceName` | `RegExp` | Device name pattern |
| `bundleId` | `string` | App bundle identifier |
| `installApps` | `string \| string[]` | App paths (APK/IPA) to install before launching |
| `autoAppLaunch` | `boolean` | Automatically launch the app after connecting. Default: `true` |
| `animations` | `'on' \| 'off'` | Toggle system animations on the device for stable screenshots (set under `use`). If omitted, then no change — the device is left as-is. |
| `viewTree` | `'on-failure' \| 'off'` | Attach the accessibility view tree as JSON to the report when a test fails. Default: `'off'` |

```typescript
import { test } from '@mobilewright/test';

test.use({ bundleId: 'com.example.settings' });

test('opens settings app', async ({ screen }) => {
  await expect(screen.getByText('Settings')).toBeVisible();
});
```
