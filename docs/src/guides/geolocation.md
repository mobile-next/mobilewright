---
sidebar_position: 10
title: Geolocation
---

# Geolocation

Use `device.setGeolocation()` to override the GPS location the device reports. Every app on the device, including your own, sees the fake coordinates until you clear the override.

```typescript
await device.setGeolocation({ latitude: 55.73511, longitude: 9.1309 });
```

Pass `null` (or nothing) to clear the override and restore the location the device reports on its own:

```typescript
await device.setGeolocation(null);
```

Latitude must be between -90 and 90, longitude between -180 and 180. Out-of-range values throw before anything is sent to the device.

## Try it: the maps app

The system maps app is installed on every device and centers on the current location when it opens, so it's a quick way to verify the override works before wiring it into your own app.

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
  <TabItem value="ios" label="iOS">

```typescript
import { test, expect } from '@mobilewright/test';

test('maps app shows the overridden location', async ({ device, screen }) => {
  await device.setGeolocation({ latitude: 55.73511, longitude: 9.1309 });
  await device.launchApp('com.apple.Maps');
  await expect(screen.getByText('Billund')).toBeVisible();
});
```

  </TabItem>
  <TabItem value="android" label="Android">

```typescript
import { test, expect } from '@mobilewright/test';

test('maps app shows the overridden location', async ({ device, screen }) => {
  await device.setGeolocation({ latitude: 55.73511, longitude: 9.1309 });
  await device.launchApp('com.google.android.apps.maps');
  await expect(screen.getByText('Billund')).toBeVisible();
});
```

  </TabItem>
</Tabs>

## Testing your app

Set the location before launching your app so its first location fix already returns the fake coordinates. The override does not grant location permission; your app still has to be allowed to read location, the same way it would on a real device.

```typescript
import { test, expect } from '@mobilewright/test';

test('nearby stores lists the closest branch', async ({ device, screen }) => {
  await device.setGeolocation({ latitude: 55.73511, longitude: 9.1309 });
  await device.launchApp('com.example.app');
  await screen.getByText('Nearby stores').tap();
  await expect(screen.getByText('Billund')).toBeVisible();
});
```

To move the device mid-test, call `setGeolocation()` again with new coordinates. Apps that subscribe to location updates receive the change without a relaunch.

## Clean up between tests

The override outlives the test that set it. Clear it in an `afterEach` so a fake location never leaks into the next test:

```typescript
import { test } from '@mobilewright/test';

test.afterEach(async ({ device }) => {
  await device.setGeolocation(null);
});
```

## Platform notes

| Platform | Setting | Clearing |
|---|---|---|
| iOS simulator | Applied instantly | Restores the simulator's own location setting |
| iOS real device, iOS 16 and older | Applied instantly and sticks on its own | Restores the real GPS location |
| iOS real device, iOS 17 and newer | Held open for the duration of the test run | Restores the real GPS location, also happens when the run ends |
| Android emulator | Applied instantly | An emulator has no real location to go back to, so clearing resets it to the emulator default (the Googleplex) |
| Android real device | Mock location permission is granted to the shell and a test provider is registered | Test provider is removed and the permission is revoked |

On Android real devices, no developer-options toggle is needed: mobilewright grants the mock location permission to the shell package itself, so your app does not need to be selected as the mock location app.

On cloud providers, support depends on the provider. `setGeolocation()` rejects with an unsupported error when the device behind it cannot fake its location.
