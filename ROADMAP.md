# Roadmap

This is a living document of planned and in-progress features. Items are roughly prioritized top-to-bottom. Have a feature request? [Open an issue](https://github.com/mobile-next/mobilewright/issues/new/choose).

## What's included today

| Feature | Example |
|---|---|
| ✅ Android & iOS support | `platform: 'ios'` or `'android'` in config |
| ✅ Test framework | `test.skip()`, `test.step()`, `test.beforeEach()`, `test.describe.serial()` |
| ✅ Parallel workers & sharding | `--workers 4`, `--shard 1/3`, `fullyParallel: true` |
| ✅ Reporters | `list`, `html`, `json`, `blob` — via config or `--reporter` |
| ✅ Locator API | `getByText()`, `getByRole()`, `getByTestId()`, `getByLabel()`, `first()`, `nth()`, `count()` |
| ✅ Touch interactions | `tap()`, `doubleTap()`, `longPress()`, `fill()`, `scrollIntoViewIfNeeded()` |
| ✅ Screen actions | `swipe()`, `pressButton()`, `goBack()`, `screenshot()` |
| ✅ Locator assertions | `toBeVisible()`, `toBeEnabled()`, `toBeChecked()`, `toBeHidden()`, `toHaveText()`, `toHaveValue()` |
| ✅ Value assertions | `toBe()`, `toEqual()`, `toContain()`, `toBeGreaterThan()`, `toMatch()` |
| ✅ App lifecycle | `launchApp()`, `terminateApp()`, `installApp()`, `uninstallApp()` |
| ✅ Device control | `setOrientation()`, `setGeolocation()`, `openUrl()`, `listApps()`, `getForegroundApp()` |
| ✅ Video recording | Attached to the HTML report (`on`, `on failure`, `off`) |
| ✅ WebView support | `getByWebView().getByRole('button')` — full locator API inside WebViews |
| ✅ Multi-project config | `projects: [{ name: 'iPhone', use: { platform: 'ios' } }, ...]` |
| ✅ Inspector | `mobilewright inspect` — browse the live view hierarchy and copy locators |
| ✅ CLI | `test`, `show-report`, `init`, `devices`, `doctor`, `screenshot`, `inspect` |

## What's coming

| Feature | Description | Status |
|---|---|---|
| **Flutter Support** | Full locator support for Flutter apps via the Dart VM Service driver. Flutter renders via Skia/Impeller rather than native views, requiring a dedicated driver. | In Progress |
| **Crashes** | Retrieve all crashes (or crashes specific to one app) from device | In Progress | 
| **Disable Animations** | Turn off system and app animations before a test run for faster, less flaky execution. | In Progress |
| **Filesystem** | Access filesystem on device, or within app container | Planned |
| **Mobilewright CLI** | Command-line tool for managing fleets of real devices — provisioning, grouping, and running tests across many devices in parallel. | Planned |
| **Mobilewright MCP** | MCP server exposing Mobilewright capabilities to AI agents and coding assistants. | Planned |
| **Device Logs** | Programmatic access to device system logs (iOS `os_log`, Android `logcat`). Filter, capture, and assert on log output from within your test. | Planned |
| **Codegen** | Record interactions on a real device or simulator and automatically generate Mobilewright TypeScript test code. Similar to `playwright codegen`. | Planned |
| **Tracing** | Step-by-step execution traces with per-action logs, screenshots, and timing attached to a visual timeline. Open with `mobilewright show-trace`. | Planned |
| **Network Capture** | Record `.har` files and inspect HTTP/HTTPS traffic during test runs. | Planned |
| **Network Interception** | Stub, modify, or block HTTP/HTTPS requests in flight to test error states and offline behavior without a live backend. | Planned |
| **Network Conditioning** | Simulate throttled or degraded networks — 3G, edge, high latency, packet loss, or fully offline — to test loading states and retry behavior. | Planned |
| **GPS Route Replay** | Replay a route of coordinates to test location-aware flows. Setting a fixed location shipped as `device.setGeolocation()`. | Planned |
| **Device Settings** | Prepare device system settings before a test — dark mode, high contrast, font size, locale, and permissions. | Planned |
| **Timezone** | Set the device timezone before a test run, to verify date/time rendering and timezone-dependent logic. | Planned |
| **Shake Gesture** | Trigger a device shake from a test, for apps that use it for undo, bug reporting, or debug menus. | Planned |
| **Device PIN / Passcode** | Set a device lock PIN once before a test run and keep it persisted across all tests, for apps that require a passcode. | Planned |
| **Media Import** | Seed the device photo library with photos and videos before a test, for flows that pick existing media. | Planned |
| **Biometrics** | Enroll a biometric on the device and match or reject a Face ID / Touch ID / fingerprint prompt from within a test. | Planned |
| **Push Notifications** | Deliver a push notification to the app under test and assert on or interact with the resulting banner. | Planned |
| **Apple Pay / Google Pay** | Drive the system payment sheet in a sandbox environment to test wallet-based checkout flows. | Planned |
| **App Launch Options** | Launch an app with custom environment variables and locale overrides, without modifying the app binary. | Planned |
| **Visual Screenshot Comparison** | Pixel-level screenshot diffing to catch unintended UI regressions across commits. | Planned |
| **Camera & Photo Injection** | Mock the photo or video returned by the system camera API during a test. | Planned |
| **Kotlin Multiplatform** | Full iOS support for Kotlin Multiplatform apps using Compose Multiplatform. Android native already works; iOS requires mapping Compose Multiplatform to native accessibility nodes. | Planned |
| **Additional Cloud Providers** | Support for running Mobilewright tests on additional device cloud providers. | Planned |
