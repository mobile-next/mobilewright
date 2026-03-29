# Mobilewright

A TypeScript framework for mobile device automation, inspired by [Playwright](https://playwright.dev/)'s architecture and developer experience. Mobilewright targets iOS and Android devices, simulators, and emulators through a clean, auto-waiting API built on top of [mobilecli](https://github.com/mobile-next/mobilecli).

## Features

- **Playwright-style API** — `screen.getByRole('button').tap()`, just like `page.getByRole('button').click()`
- **Zero config** — auto-discovers booted simulators
- **Cross-platform** — unified interface for iOS and Android
- **Auto-waiting** — actions wait for elements to be visible, enabled, and stable before interacting
- **Chainable locators** — `screen.getByType('Cell').getByLabel('Item 1')`
- **Retry assertions** — `expect(locator).toBeVisible()` polls until satisfied or timeout
- **Remote support** — connect to mobilecli on another machine for device lab setups
- **Test fixtures** — `@mobilewright/test` extends Playwright Test with `screen` and `device` fixtures

## Quick Start

```bash
npm install mobilewright
```

```typescript
import { ios, expect } from 'mobilewright';

const device = await ios.launch({ bundleId: 'com.example.myapp' });
const { screen } = device;

await screen.getByLabel('Email').fill('user@example.com');
await screen.getByLabel('Password').fill('password123');
await screen.getByRole('button', { name: 'Sign In' }).tap();

await expect(screen.getByText('Welcome back')).toBeVisible();
const screenshot = await screen.screenshot();

await device.close();
```

## Prerequisites

- Node.js >= 18
- A booted iOS simulator, Android emulator, or connected real device

Run `mobilewright doctor` to verify your environment is ready:

```bash
npx mobilewright doctor
```

It checks Xcode, Android SDK, simulators, ADB, and other dependencies — and tells you exactly what's missing and how to fix it. Add `--json` for machine-readable output.

## Packages

| Package | Description |
|---|---|
| `mobilewright` | Main entry point — `ios`, `android` launchers, `expect`, config, CLI |
| `@mobilewright/test` | Test fixtures |
| `@mobilewright/protocol` | TypeScript interfaces (`MobilewrightDriver`, `ViewNode`) |
| `@mobilewright/driver-mobilecli` | WebSocket JSON-RPC client for mobilecli |
| `@mobilewright/mobilewright-core` | `Device`, `Screen`, `Locator`, `expect` — the user-facing API |

Most users only need `mobilewright` (or `@mobilewright/test` for vitest integration).

## API Reference

### Launchers — `ios` and `android`

The top-level entry points. Like Playwright's `chromium` / `firefox` / `webkit`.

```typescript
import { ios, android } from 'mobilewright';

// Launch with auto-discovery (finds first booted simulator)
const device = await ios.launch();

// Launch a specific app
const device = await ios.launch({ bundleId: 'com.example.app' });

// Target a specific simulator by name
const device = await ios.launch({ deviceName: 'My.*iPhone' });

// Explicit device UDID (skips discovery)
const device = await ios.launch({ deviceId: '5A5FCFCA-...' });

// List available devices
const devices = await ios.devices();
const devices = await android.devices();
```

`launch()` handles the full lifecycle:
1. Checks if mobilecli is reachable (auto-starts it for local URLs if not running)
2. Checks mobilecli version (warns if older than minimum supported)
3. Discovers booted devices (prefers simulators over real devices)
4. Connects and optionally launches the app
5. On `device.close()`, kills the auto-started server

### Screen

Entry point for finding and interacting with elements. Access via `device.screen`.

**Locator factories:**

```typescript
screen.getByLabel('Email')                          // accessibility label
screen.getByTestId('login-button')                  // accessibility identifier
screen.getByText('Welcome')                         // visible text (exact match)
screen.getByText(/welcome/i)                        // RegExp match
screen.getByText('welcome', { exact: false })       // substring match
screen.getByType('TextField')                       // element type
screen.getByRole('button', { name: 'Sign In' })     // semantic role + name filter
```

**Direct actions:**

```typescript
await screen.screenshot()                            // capture PNG
await screen.screenshot({ format: 'jpeg', quality: 80 })
await screen.swipe('up')
await screen.swipe('down', { distance: 300, duration: 500 })
await screen.pressButton('HOME')
await screen.tap(195, 400)                           // raw coordinate tap
```

### Locator

Lazy, chainable element reference. No queries execute until you call an action or assertion.

**Actions** (all auto-wait for the element to be visible, enabled, and have stable bounds):

```typescript
await locator.tap()
await locator.doubleTap()
await locator.longPress({ duration: 1000 })
await locator.fill('hello@example.com')              // tap to focus + type text
```

**Queries:**

```typescript
await locator.isVisible()                            // boolean
await locator.isEnabled()                            // boolean
await locator.getText()                              // waits for visibility first
```

**Explicit waiting:**

```typescript
await locator.waitFor({ state: 'visible' })
await locator.waitFor({ state: 'hidden' })
await locator.waitFor({ state: 'enabled' })
await locator.waitFor({ state: 'disabled', timeout: 10_000 })
```

**Chaining** — scope queries within a parent element's bounds:

```typescript
// Tap the delete button inside the first row
const row = screen.getByType('Cell');
await row.getByRole('button', { name: 'Delete' }).tap();

// Get text from a navigation bar
const title = await screen.getByType('NavigationBar').getByType('StaticText').getText();
```

When chaining, child lookups use bounds-based containment: any element whose bounds fit within the parent's bounds is considered a child. This works correctly with mobilecli's flat element lists.

### Device

Manages the connection lifecycle and exposes device/app-level controls.

```typescript
// Orientation
await device.setOrientation('landscape');
const orientation = await device.getOrientation();

// URLs / deep links (goto is a Playwright-style alias for openUrl)
await device.goto('myapp://settings');
await device.openUrl('https://example.com');

// App lifecycle
await device.launchApp('com.example.app', { locale: 'fr_FR' });
await device.terminateApp('com.example.app');
const apps = await device.listApps();
const foreground = await device.getForegroundApp();
await device.installApp('/path/to/app.ipa');
await device.uninstallApp('com.example.app');

// Cleanup (disconnects + stops auto-started mobilecli)
await device.close();
```

### Assertions — `expect`

All assertions poll repeatedly until satisfied or timeout (default 5s). Supports `.not` for negation.

```typescript
import { expect } from 'mobilewright';

await expect(locator).toBeVisible();
await expect(locator).not.toBeVisible();

await expect(locator).toBeEnabled();
await expect(locator).not.toBeEnabled();

await expect(locator).toHaveText('Welcome back!');
await expect(locator).toHaveText(/welcome/i);
await expect(locator).toContainText('back');

await expect(locator).toBeVisible({ timeout: 10_000 });
```

### Role Mapping

`getByRole` maps semantic roles to platform-specific element types:

| Role | iOS | Android |
|---|---|---|
| `button` | Button, ImageButton | Button, ImageButton |
| `textfield` | TextField, SecureTextField, SearchField | EditText |
| `text` | StaticText | TextView, Text |
| `image` | Image | ImageView |
| `switch` | Switch | Switch, Toggle |
| `checkbox` | -- | Checkbox |
| `slider` | Slider | SeekBar |
| `list` | Table, CollectionView, ScrollView | ListView, RecyclerView |
| `header` | NavigationBar | Toolbar |
| `link` | Link | Link |

Falls back to direct type matching if no mapping exists.

## Configuration

Create a `mobilewright.config.ts` in your project root:

```typescript
import { defineConfig } from 'mobilewright';

export default defineConfig({
  platform: 'ios',
  bundleId: 'com.example.myapp',
  deviceName: 'iPhone 16',
  timeout: 10_000,
});
```

All options:

| Option | Type | Description |
|---|---|---|
| `platform` | `'ios' \| 'android'` | Device platform (optional) |
| `bundleId` | `string` | App bundle ID (optional) |
| `deviceId` | `string` | Explicit device UDID (optional) |
| `deviceName` | `string` | RegExp to match device name (optional) |
| `timeout` | `number` | Global locator timeout in ms (optional) |

Config values are used as defaults — `LaunchOptions` passed to `ios.launch()` always take precedence.

Mobilewright will use the first device that matches your configured criteria.

## Test Fixtures

`@mobilewright/test` extends [Playwright Test](https://playwright.dev/docs/test-intro) with mobile-specific fixtures:

```typescript
import { test, expect } from '@mobilewright/test';

// Configure the app bundle and video recording for all tests in this file
test.use({ bundleId: 'com.example.myapp', video: 'on' });

test('can sign in', async ({ device, screen, bundleId }) => {
  // Fresh-launch the app before the test
  await device.terminateApp(bundleId).catch(() => {});
  await device.launchApp(bundleId);

  await screen.getByLabel('Email').fill('user@example.com');
  await screen.getByLabel('Password').fill('password123');
  await screen.getByRole('button', { name: 'Sign In' }).tap();

  await expect(screen.getByText('Welcome back')).toBeVisible();
});
```

The `device` fixture connects once per worker (reading from `mobilewright.config.ts`) and calls `device.close()` after all tests complete. The `screen` fixture provides `device.screen` to each test, with automatic screenshot-on-failure and optional video recording.

## CLI

### `mobilewright init`

Scaffold a `mobilewright.config.ts` and `example.test.ts` in the current directory. Skips files that already exist.

```bash
npx mobilewright init
```

```
created  mobilewright.config.ts
created  example.test.ts
```

### `mobilewright devices`

List all connected devices, simulators, and emulators.

```bash
npx mobilewright devices
```

```
ID                                      Name                     Platform  Type        State
-------------------------------------------------------------------------------------------------
00008110-0011281A112A801E               VPhone                   ios       real-device    booted
5A5FCFCA-27EC-4D1B-B412-BAE629154EE0    iPhone 17 Pro            ios       simulator   booted
```

### `mobilewright test`

Run your tests. Auto-discovers `mobilewright.config.ts` in the current directory.

```bash
npx mobilewright test
npx mobilewright test login.test.ts         # run a specific file
npx mobilewright test --grep "sign in"      # filter by test name
npx mobilewright test --reporter html       # generate HTML report
npx mobilewright test --retries 2           # retry flaky tests
npx mobilewright test --workers 4           # parallel workers
npx mobilewright test --list                # list tests without running
```

### `mobilewright show-report`

Open the HTML report generated by `--reporter html`.

```bash
npx mobilewright show-report
npx mobilewright show-report mobilewright-report/
```

## Contributing

```bash
# Run the repository's own unit tests
npm test
```

