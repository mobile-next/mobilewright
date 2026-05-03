# Mobilewright

[![npm](https://img.shields.io/npm/dw/mobilewright?style=flat-square&label=npm%20downloads)](https://www.npmjs.com/package/mobilewright)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Framework for mobile device automation, inspired by Playwright's architecture and developer experience. 

**Mobilewright** targets iOS and Android devices, simulators, and emulators through a clean, auto-waiting API built on top of [mobilecli](https://github.com/mobile-next/mobilecli).

[Get Started](#quick-start) · [API Docs](#api-reference) · [Roadmap](ROADMAP.md) · [Cloud (mobile-use.com)](https://mobile-use.com)

## Why Mobilewright?

If you've used Playwright, you already know Mobilewright.

| | Mobilewright | Appium | Detox | XCTest/Espresso |
|---|---|---|---|---|
| API style | Playwright (`getByRole`, `expect`) | Selenium (WebDriver) | Custom | Native framework |
| Auto-wait | Built-in, every action | Manual waits | Partial | Manual |
| Setup | `npm install mobilewright` | Server + drivers + caps | React Native only | Xcode/AS only |
| Cross-platform | iOS + Android, one API | Yes, verbose | React Native only | Single platform |
| AI agent support | First-class (accessibility tree) | Limited | No | No |
| Real devices in the cloud | Via [mobile-use.com](https://mobile-use.com) | Yes (complex) | Simulators only | Yes |
| Locators | Semantic roles + labels | XPath, CSS, ID | Test IDs | Native queries |

## Built for AI agents

Your agent needs a phone, not a screenshot.

Mobilewright exposes the device's accessibility tree — deterministic, token-efficient, no vision model needed. Use it with [mobile-mcp](https://github.com/mobile-next/mobile-mcp), Claude, Cursor, or any coding agent.

```typescript
// An AI agent can control a real phone with readable, semantic actions
await screen.getByRole('button', { name: 'Sign In' }).tap();
await screen.getByLabel('Email').fill('user@example.com');
await expect(screen.getByText('Welcome')).toBeVisible();
```

No XPath. No coordinates. No vision model. The agent reads the accessibility tree and acts on it directly.

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
| `@mobilewright/driver-mobile-use` | WebSocket JSON-RPC client for [mobile-use.com](https://mobile-use.com) cloud devices |
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
const device = await ios.launch({ deviceName: /My.*iPhone/ });

// Explicit device UDID (skips discovery)
const device = await ios.launch({ deviceId: '5A5FCFCA-...' });

// List available devices
const devices = ios.devices();
const devices = android.devices();
```

`launch()` handles the full lifecycle:
1. Checks if mobilecli is reachable (auto-starts it for local URLs if not running)
2. Discovers booted devices (prefers simulators over real devices)
3. Connects and optionally launches the app
4. On `device.close()`, kills the auto-started server

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
await locator.isSelected()                           // boolean
await locator.isFocused()                            // boolean
await locator.isChecked()                            // boolean
await locator.getText()                              // waits for visibility first
await locator.getValue()                             // raw value (e.g. text field content)
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
| `button` | Button, ImageButton | Button, ImageButton, ReactViewGroup* |
| `textfield` | TextField, SecureTextField, SearchField | EditText, ReactEditText |
| `text` | StaticText | TextView, Text, ReactTextView |
| `image` | Image | ImageView, ReactImageView |
| `switch` | Switch | Switch, Toggle |
| `checkbox` | -- | Checkbox |
| `slider` | Slider | SeekBar |
| `list` | Table, CollectionView, ScrollView | ListView, RecyclerView, ReactScrollView |
| `header` | NavigationBar | Toolbar, Header |
| `link` | Link | Link |
| `listitem` | Cell | LinearLayout, RelativeLayout, Other |
| `tab` | Tab, TabBar | Tab, TabBar |

\* ReactViewGroup matches `button` only when the element has `clickable="true"` or `accessible="true"` in its raw attributes, to avoid false positives since React Native uses ReactViewGroup for all container views.

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
| `deviceName` | `RegExp` | RegExp to match device name (optional) |
| `timeout` | `number` | Global locator timeout in ms (optional) |
| `testDir` | `string` | Directory to search for test files (optional) |
| `testMatch` | `string \| RegExp \| Array` | Glob patterns for test files (optional) |
| `reporter` | `'list' \| 'html' \| 'json' \| 'junit' \| Array` | Reporter to use (optional) |
| `retries` | `number` | Maximum retry count for flaky tests (optional) |
| `projects` | `MobilewrightProjectConfig[]` | Multi-device / multi-platform project matrix (optional) |

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

## Run on real devices with mobile-use.com

Need real phones in the cloud? [mobile-use.com](https://mobile-use.com) gives you API access to hundreds of real Android and iOS devices. Your Mobilewright scripts run with zero modification — point your config at the mobile-use.com endpoint and go.

mobile-use.com is the only device cloud with native Mobilewright support.

## Telemetry

Mobilewright collects anonymous usage telemetry via PostHog. To disable it, set the `MOBILEWRIGHT_DISABLE_TELEMETRY` environment variable:

```bash
MOBILEWRIGHT_DISABLE_TELEMETRY=1 npx mobilewright test
```

When telemetry is enabled, a random identifier is generated and stored in `~/.config/mobilenext/mobilewright/config.json`. No personal information or test data is ever collected.

## Contributing

```bash
# Run the repository's own unit tests
npm test
```

## Framework Support

| Framework | iOS | Android | Notes |
|---|---|---|---|
| UIKit / Storyboards | ✅ | — | Full native element types, all locators work |
| SwiftUI | ✅ | — | Maps to standard `XCUIElementType` accessibility tree |
| Jetpack Compose | — | ✅ | Renders to native Android accessibility nodes |
| Android Views (XML layouts) | — | ✅ | Full native element types, all locators work |
| React Native | ✅ | ✅ | Uses real native components; RN-specific types mapped to roles |
| Expo | ✅ | ✅ | Same as React Native (Expo builds to RN) |
| Flutter | ⏳ | ⏳ | Renders via Skia/Impeller, not native views — requires Dart VM Service driver |
| .NET MAUI | ✅ | ✅ | Compiles to native controls on both platforms |
| Kotlin Multiplatform (shared UI) | ⏳ | ✅ | Android native works; iOS Compose Multiplatform support in progress |
| Cordova / Capacitor | ✅ | ✅ | WebView content accessible via native accessibility tree |
| NativeScript | ✅ | ✅ | Renders to native views on both platforms |

## License

This project is licensed under the Apache License 2.0 — see the [LICENSE](LICENSE) file for details.

