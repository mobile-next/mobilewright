## [0.0.24] (2026-04-22)
* Fix: `loadConfig()` now unwraps double-wrapped default exports caused by Playwright's TS transpiler, which prevented `driver` and other config options from being applied in test fixtures
* Fix: Handle `allocating` state from `fleet.allocate` — poll `devices.list` until device is ready instead of crashing
* Fix: Validate `fleet.allocate` response and throw a clear error with the server response on failure
* Fix: `installApp` on mobile-use driver now uploads via `uploads.create` + S3 PUT before installing
* General: Add `installApps` config option to install apps (APK/IPA) before launching
* General: Add `autoAppLaunch` config option to skip automatic app launch (default: `true`)
* General: Add RPC send/receive debug logging to mobile-use driver
* General: Log screen recording download URL after `stopRecording`

## [0.0.23] (2026-04-20)
* General: Add `@mobilewright/driver-mobile-use` package for mobile-use.com cloud device support
* General: Refactor `ConnectionConfig` — replace required `deviceId` with required `platform`, optional `deviceId`, `deviceName`, `osVersion`
* General: Move device resolution into drivers — mobilecli resolves locally
* General: Add missing `scale` field to getScreenSize response
* General: Default `workers: 1` in `defineConfig` — mobile tests target a single device, changeable for cloud
* General: Add `debug` logging to both drivers (`DEBUG=mw:*` to enable)
* General: Improve WebSocket error messages with close code and reason
* General: Add `toMatch`, `toBeInstanceOf`, `toBeDefined`, `toBeGreaterThanOrEqual`, `toBeLessThanOrEqual`, `toBeNaN`, `toContainEqual`, `toHaveLength`, `toHaveProperty`, `toMatchObject`, `toStrictEqual`, `toThrow` assertions
* General: Handle both flat array and `{ apps: [...] }` response in `listApps`, thanks to [emor](https://github.com/emor)
* Docs: Add troubleshooting guide with `DEBUG=mw:*` and `mobilewright doctor` usage
* Tests: Add cross-driver integration test suite (`e2e/`)
* Fix: `LaunchOptions.locale` renamed to `locales` (to match mobilecli server protocol)
* Fix: `gesture()` now sends `actions` param to match OpenRPC spec (was incorrectly sending `pointers`)
* Fix: `startRecording` no longer drops `timeLimit: 0`
* Fix: `disconnect()` now properly awaits WebSocket close

## [0.0.22] (2026-04-16)
* General: Add `mobilewright install` command to install agents on devices ([#29](https://github.com/mobile-next/mobilewright/pull/29))
* General: Switch `listDevices()` to use mobilecli cli instead of launching server ([#29](https://github.com/mobile-next/mobilewright/pull/29))
* General: Upgrade mobilecli to `mobilecli@0.3.66` ([#29](https://github.com/mobile-next/mobilewright/pull/29))
* Doctor: Show mobilecli version and detected devices with agent install status ([#30](https://github.com/mobile-next/mobilewright/pull/30))
* Doctor: Show booted iOS simulators with UDIDs ([#30](https://github.com/mobile-next/mobilewright/pull/30))
* Doctor: Remove Homebrew check ([#30](https://github.com/mobile-next/mobilewright/pull/30))
* CI: Add explicit permissions to docs build workflow ([#28](https://github.com/mobile-next/mobilewright/pull/28))

## [0.0.21] (2026-04-14)
* General: Support plain value assertions in `expect()` — `toBe`, `toEqual`, `toBeTruthy`, `toBeFalsy`, `toContain`, `toMatch`, and more ([#17](https://github.com/mobile-next/mobilewright/pull/17))
* CI: Add explicit permissions and `npm audit` to CI workflow ([#19](https://github.com/mobile-next/mobilewright/pull/19))
* CI: Use `npm ci` instead of `npm install` and add CODEOWNERS ([#20](https://github.com/mobile-next/mobilewright/pull/20))

## [0.0.20] (2026-04-13)
* General: Add `count()`, `all()`, `first()`, `last()`, `nth()` to Locator for collection operations ([#10](https://github.com/mobile-next/mobilewright/pull/10))
* General: Add `screen.goBack()` convenience method for Android ([#11](https://github.com/mobile-next/mobilewright/pull/11))
* General: Add `toBeHidden()` assertion ([#11](https://github.com/mobile-next/mobilewright/pull/11))
* General: Rename `toHaveFocus()` to `toBeFocused()` for naming consistency ([#11](https://github.com/mobile-next/mobilewright/pull/11))
* General: Copy README into mobilewright package before npm publish ([#14](https://github.com/mobile-next/mobilewright/pull/14))

## [0.0.19] (2026-04-13)
* General: Add `screen.viewTree()` to dump the UI view hierarchy ([#12](https://github.com/mobile-next/mobilewright/pull/12))
* General: Add `mobilewright screenshot` CLI command ([#9](https://github.com/mobile-next/mobilewright/pull/9))
* General: Update mobilecli to 0.1.64

## [0.0.18] (2026-04-02)
* General: Fix mobilecli binary resolution using `createRequire` to work reliably from npx caches, global installs, and local node_modules ([#7](https://github.com/mobile-next/mobilewright/pull/7))

## [0.0.17] (2026-04-02)
* General: Add `mobilewright init` command to scaffold config and example test ([#2](https://github.com/mobile-next/mobilewright/pull/2))
* General: Improve html test report template with click-to-fullscreen screenshots ([#6](https://github.com/mobile-next/mobilewright/pull/6))
* General: Add `getByPlaceholder` locator for matching elements by placeholder text ([#4](https://github.com/mobile-next/mobilewright/pull/4))
* General: Add `toBeDisabled`, `toBeSelected`, `toHaveFocus`, `toBeChecked`, and `toHaveValue` assertions ([#4](https://github.com/mobile-next/mobilewright/pull/4))
* General: Add `isSelected`, `isFocused`, `isChecked`, and `getValue` locator queries ([#4](https://github.com/mobile-next/mobilewright/pull/4))
* General: Support `testId` matching against full Android `resourceId` for Appium migration ([#4](https://github.com/mobile-next/mobilewright/pull/4))
* General: Fix swipe command to convert direction to start/end coordinates for mobilecli RPC ([#5](https://github.com/mobile-next/mobilewright/pull/5))
* Android: Map React Native view types (ReactViewGroup, ReactTextView, ReactEditText, ReactImageView, ReactScrollView) to semantic roles ([#4](https://github.com/mobile-next/mobilewright/pull/4))
* Android: Parse `isChecked` state from UI hierarchy ([#4](https://github.com/mobile-next/mobilewright/pull/4))
