# End-to-end tests

End-to-end tests that verify mobilewright's locators, assertions, and other
functionality against real emulators, simulators, and physical devices.

Tests under `src/conformance` run on both platforms; tests under `src/ios` and
`src/android` are platform-specific.

## Prerequisites

Download the Playground app from
[github.com/mobile-next/playground/releases/latest](https://github.com/mobile-next/playground/releases/latest)
and install it on the target device.

## Running

```sh
# against a local device via mobilecli
npm run test:mobilecli

# against a Mobile Next cloud device (requires MOBILENEXT_API_KEY)
npm run test:mobilenext
```
