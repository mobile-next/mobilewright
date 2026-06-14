---
sidebar_position: 6
title: Deep Links
---

# Deep Links

Use `device.openUrl()` to open a URL or custom scheme on the device. The OS routes the URL to the appropriate app — your own app, a system app, or the default browser.

```typescript
await device.openUrl('myapp://home');
```

## Try it: opening the phone dialer

The `tel:` scheme is available on every device and is a good way to verify your setup before testing your own app's scheme.

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
  <TabItem value="ios" label="iOS">

```typescript
import { test, expect } from '@mobilewright/test';

test('tel: scheme opens the phone dialer', async ({ device, screen }) => {
  await device.openUrl('tel:+15550001234');
  await expect(screen.getByText('Call')).toBeVisible();
});
```

  </TabItem>
  <TabItem value="android" label="Android">

```typescript
import { test, expect } from '@mobilewright/test';

test('tel: scheme opens the phone dialer', async ({ device, screen }) => {
  await device.openUrl('tel:+15550001234');
  await expect(screen.getByText('+1 555-000-1234')).toBeVisible();
});
```

  </TabItem>
</Tabs>

## Testing your app's custom scheme

Register your URL scheme in your app's manifest, then use it in tests to navigate directly to any screen.

<Tabs>
  <TabItem value="ios" label="iOS">

On iOS, URL schemes are declared in `Info.plist` under `CFBundleURLSchemes`.

```typescript
import { test, expect } from '@mobilewright/test';

test('deep link opens product detail', async ({ device, screen }) => {
  await device.openUrl('myapp://products/42');
  await expect(screen.getByTestId('product-detail')).toBeVisible();
});
```

  </TabItem>
  <TabItem value="android" label="Android">

On Android, URL schemes are declared as `<intent-filter>` entries in `AndroidManifest.xml`.

```typescript
import { test, expect } from '@mobilewright/test';

test('deep link opens product detail', async ({ device, screen }) => {
  await device.openUrl('myapp://products/42');
  await expect(screen.getByTestId('product-detail')).toBeVisible();
});
```

  </TabItem>
</Tabs>

## Universal Links and App Links

Universal Links (iOS) and App Links (Android) use `https://` URLs instead of a custom scheme. The OS opens your app if it's installed, or the browser as a fallback.

<Tabs>
  <TabItem value="ios" label="iOS (Universal Links)">

```typescript
test('universal link opens in-app', async ({ device, screen }) => {
  await device.openUrl('https://example.com/products/42');
  await expect(screen.getByTestId('product-detail')).toBeVisible();
});
```

Universal Links require an `apple-app-site-association` file hosted at `https://example.com/.well-known/apple-app-site-association`.

  </TabItem>
  <TabItem value="android" label="Android (App Links)">

```typescript
test('app link opens in-app', async ({ device, screen }) => {
  await device.openUrl('https://example.com/products/42');
  await expect(screen.getByTestId('product-detail')).toBeVisible();
});
```

App Links require a `assetlinks.json` file hosted at `https://example.com/.well-known/assetlinks.json`.

  </TabItem>
</Tabs>

## Skipping login with deep links

Deep links let you land a test directly on the screen it needs without tapping through the app, this makes each test fast and focused.

```typescript
import { test, expect } from '@mobilewright/test';

test.describe('order history', () => {
  test.beforeEach(async ({ device }) => {
    // Navigate straight to the screen under test
    await device.openUrl('myapp://account/orders');
  });

  test('shows past orders', async ({ screen }) => {
    await expect(screen.getByText('Your Orders')).toBeVisible();
  });

  test('empty state shown when no orders', async ({ screen }) => {
    await expect(screen.getByTestId('empty-orders')).toBeVisible();
  });
});
```

## Passing parameters

Pass IDs, filters, or any state as path segments or query parameters — whatever your app's routing supports.

```typescript
// Path parameter
await device.openUrl('myapp://users/99');

// Query parameter
await device.openUrl('myapp://search?q=headphones&sort=price');

// Combined
await device.openUrl('myapp://products/42?variant=blue&size=M');
```

## Verifying that a link opens the right app

Use `device.getForegroundApp()` to assert which app is in the foreground after opening a URL.

<Tabs>
  <TabItem value="ios" label="iOS">

```typescript
test('https link opens Safari when app is not installed', async ({ device }) => {
  await device.openUrl('https://example.com');
  const app = await device.getForegroundApp();
  expect(app.bundleId).toBe('com.apple.mobilesafari');
});
```

  </TabItem>
  <TabItem value="android" label="Android">

```typescript
test('https link opens Chrome when app is not installed', async ({ device }) => {
  await device.openUrl('https://example.com');
  const app = await device.getForegroundApp();
  expect(app.packageName).toBe('com.android.chrome');
});
```

  </TabItem>
</Tabs>
