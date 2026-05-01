## [0.0.30] (2026-05-01)
* Fix(config): `loadConfig()` now uses `pathToFileURL` for dynamic import — fixes config not loading on Windows
* Fix(doctor): Suggest `Microsoft.OpenJDK.17` instead of Azul Zulu for Windows JDK installs
* Feat(test): `swipe` on a locator — e.g. swipe left on a list item
* Docs: Added Windows instructions for enabling debug logs (`$env:DEBUG` / `set DEBUG`)

## [0.0.29] (2026-04-30)
* General: mobilecli agent is automatically installed on simulators and emulators at connect time — no manual `mobilewright install` step needed
* Fix(cli): `npx mobilewright init` now works correctly — templates were missing from the published dist
* Fix(driver-mobilecli): Windows 11 is now supported — `win32-x64` resolves to `mobilecli-windows-amd64.exe`

## [0.0.28] (2026-04-29)
* Fix(test): Stream cloud recordings to disk instead of loading into memory — safe for large video files
* Fix(test): Video attachments now work with the cloud drivers
* Fix(cli): Fixed HTML report branding so it now applies when the `html` reporter is configured

## [0.0.27] (2026-04-28)
* General: New worker/device-pool architecture: workers acquire devices from a shared pool instead of each worker owning a dedicated device
* General: Track installed apps per slot to skip re-install when the same worker reuses a device
* General: Per-allocation timeouts via `AbortSignal`; pool shutdown drains waiters and releases all slots
* General: Stack traces from `expect()` failures now omit mobilewright frames — set `MWDEBUGIMPL=1` to see them
* General: Upgrade mobilecli to `0.3.67`
* CLI: Add `--shard` option to the `test` command for multi-host sharding of tests
* CLI: Add `mobilewright merge-reports` command, needed for sharding
* Fix: Fix 'text' field from viewTree to fetch from dump's 'text' instead of 'label', thanks to [emor](https://github.com/emor)
* Fix(allocator-factory): Throw on unknown driver type instead of silently falling back to mobile-use
* Fix(driver-mobile-use): Only call `fleet.release` on disconnect when this instance owns the lease
* Fix(device-pool): Re-queue waiters on `NoDeviceAvailableError`; treat `NaN` `--workers` as 1
* Fix(rpc-client): Close WebSocket nicely with code 1000 and await the close handshake on `disconnect()`

## [0.0.26] (2026-04-22)
* Fix(driver-mobile-use): Device allocation now correctly waits for provisioning to complete 
* Fix(driver-mobile-use): `devices.list` response properly unwrapped from `{ devices: [...] }` envelope
* Fix(driver-mobile-use): `installApp` upload now includes `duplex: 'half'` required by Node.js for stream bodies

## [0.0.25] (2026-04-22)
* General: Add `installApps` config option to install apps before launching
* General: Add `autoAppLaunch` config option to skip automatic app launch (default: `true`)
* Fix: `loadConfig()` now unwraps double-wrapped default exports caused by Playwright's transpiler
* Fix(driver-mobile-use): Handle `allocating` state from mobile-use.com, wait until device is ready
* Fix(driver-mobile-use): `installApp` uploads file via `uploads.create`

## [0.0.24] (2026-04-22)
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
