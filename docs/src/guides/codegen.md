---
sidebar_position: 11
title: Codegen
---

# Codegen

Codegen records what you do on a connected device and writes it as a Mobilewright
test. Click on a live screenshot of the device, and each action is sent to the device
and added to the test as a line of code, using the same locators the
[Inspector](./inspector) recommends.

## Start recording

```bash
npx mobilewright codegen
```

Codegen starts a local server and opens automatically in your browser. Use `--port`
to choose a specific port (default: `4621`):

```bash
npx mobilewright codegen --port 8080
```

Pick a device from the selector at the top. The device screen appears on the left and
the test on the right, starting from:

```ts
import { test, expect } from '@mobilewright/test';

test('test', async ({ device, screen }) => {
});
```

The screenshot refreshes continuously while the page is open.

## Recording actions

Hover over the screenshot to see which element a click will target, then click it.
Codegen taps that element on the device and adds a line to the test:

```ts
await screen.getByRole('button', { name: 'Sign in' }).tap();
```

Locators follow the Inspector's priority (`getByTestId` > `getByRole` > `getByLabel`
> `getByText`). When a locator matches more than one element, codegen adds `.nth()`
so the test taps the same one. Where no element has a usable locator, the click is
recorded by coordinates:

```ts
await screen.tap(201, 437);
```

Toggle **Record** to keep using the device without adding code.

## Device buttons and location

The buttons above the device screen press **Home**, **App switch** and **Back**
(App switch and Back are Android only), and **Set location** overrides the device's
GPS location. Each one is recorded:

```ts
await screen.pressButton('HOME');
await device.setGeolocation({ latitude: -17.833, longitude: 177.947 });
await device.setGeolocation(null); // Reset location
```

## Assertions

Click **Assert text** or **Assert value** in the toolbar, then click an element. Codegen
adds an assertion with the element's current text or value instead of tapping it:

```ts
await expect(screen.getByText('Welcome back')).toHaveText('Welcome back');
await expect(screen.getByLabel('Email')).toHaveValue('user@example.com');
```

## View tree

The **View tree** button opens the element hierarchy on the right. Hover over a row to
highlight the element on the screenshot, and click it to see its locators and
properties. To find an element without scrolling the tree, **Shift-click** it on the
screenshot: the tree opens, expands and selects it, and nothing is sent to the device.

From the details, **Tap**, **Double tap** and **Long press** perform that gesture on the
device and record it:

```ts
await screen.getByTestId('photo').doubleTap();
await screen.getByRole('listitem', { name: 'Inbox' }).longPress();
```

## Stopping codegen

Click **Copy** in the toolbar to copy the test to the clipboard, then press `Ctrl+C` in
the terminal. Codegen
disconnects from the device and shuts the server down.
