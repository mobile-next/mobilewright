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

## Configuration overrides

You can override the following settings per-test or per-project, in addition to what's set in `mobilewright.config.ts`:

| Option | Type | Description |
|--------|------|-------------|
| `platform` | `'ios' \| 'android'` | Target platform |
| `deviceId` | `string` | Specific device ID |
| `deviceName` | `RegExp` | Device name pattern |
| `bundleId` | `string` | App bundle identifier |

```typescript
import { test } from '@mobilewright/test';

test.use({ bundleId: 'com.example.settings' });

test('opens settings app', async ({ screen }) => {
  await expect(screen.getByText('Settings')).toBeVisible();
});
```
