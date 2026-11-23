---
sidebar_class_name: sidebar-icon-saucelabs
sidebar_position: 5
title: Sauce Labs
---

# Sauce Labs

[Sauce Labs](https://saucelabs.com/) runs Mobilewright tests on real Android and iOS devices
through the
[`@saucelabs/mobilewright-driver`](https://www.npmjs.com/package/@saucelabs/mobilewright-driver)
package, maintained by Sauce Labs. Each test shows up on the Sauce Labs
[Test Results](https://docs.saucelabs.com/mobile-apps/real-device-access-api/real-device-access-api-test-results/)
page with its video, screenshots and device logs, and no Sauce Labs-specific code is needed in
your tests.

Requires `mobilewright` 0.0.67, Node.js ≥ 22.12, and Android 13 or later on Android devices.

The driver uses the Sauce Labs
[Real Device Access API](https://docs.saucelabs.com/mobile-apps/real-device-access-api/real-device-access-api-public-and-private-devices/),
which is available on Enterprise plans only. Self-serve plans don't include it.

## Setup

### 1. Install the driver

```bash
npm install --save-dev @saucelabs/mobilewright-driver
```

### 2. Set your credentials

Find your username and access key in your
[Sauce Labs user settings](https://app.saucelabs.com/user-settings) and export them:

```bash
export SAUCE_USERNAME=...
export SAUCE_ACCESS_KEY=...
```

The driver also takes `username` and `accessKey` options directly, but keep credentials out of
the repository.

### 3. Set the driver

This example runs the [Sauce Labs demo app](https://github.com/saucelabs/my-demo-app-android) on
a Pixel and an iPhone:

```ts
// mobilewright.config.ts
import { defineConfig } from 'mobilewright';
import { sauceLabsDriver } from '@saucelabs/mobilewright-driver';

export default defineConfig({
  testDir: './tests',
  use: { actionTimeout: 30_000 },
  expect: { timeout: 30_000 },
  driver: sauceLabsDriver({ region: 'us-west-1', build: 'my-first-build' }),
  projects: [
    {
      name: 'android',
      use: {
        platform: 'android',
        deviceName: /Google_Pixel(?!.*Fold)/, // no foldables: apps can open on the hidden screen
        osVersion: '>=13',
        bundleId: 'com.saucelabs.mydemoapp.android',
        installApps: 'https://github.com/saucelabs/my-demo-app-android/releases/download/2.3.0/mda-2.3.0-27.apk',
      },
    },
    {
      name: 'ios',
      use: {
        platform: 'ios',
        deviceName: /iPhone/,
        osVersion: '>=16.6',
        bundleId: 'com.saucelabs.mydemo.app.ios',
        installApps: 'https://github.com/saucelabs/my-demo-app-ios/releases/download/2.3.0/SauceLabs-Demo-App.ipa',
      },
    },
  ],
});
```

Device selection uses the standard config fields: `platform`, `deviceName` (regex) and
`osVersion` (exact, or a range like `">=17 <19"`).

`installApps` takes an `https://` URL (Sauce Labs downloads it), a file in
[App Storage](https://docs.saucelabs.com/mobile-apps/app-storage/) (`storage:<id>` or
`storage:filename=<name>`), or a local `.apk`, `.ipa` or `.zip`, which is uploaded once and then
reused.

Mobilewright's 5-second default timeouts are meant for local devices. Use 30 seconds for
`actionTimeout` and `expect`, as in the example above.

## Driver options

All options are optional.

| Option | Purpose |
| --- | --- |
| `username`, `accessKey` | Credentials; default to the environment variables above |
| `region` | [Data center](https://docs.saucelabs.com/basics/data-center-endpoints/): `us-west-1` (default), `us-east-4`, `eu-central-1` or `asia-south-2` |
| `build`, `tags` | Build name and tags shown on the Test Results page |
| `reportTests` | Report each test to the Test Results page (default `true`) |
| `artifacts` | What Sauce Labs records per test: `{ video, screenshots, deviceLogs, networkCapture }` |
| `allocationTimeout` | How long to wait for a device (default 300s) |
| `sessionDuration` | Maximum session length, e.g. `PT1H` |
| `sauceConnect` | Start a Sauce Connect tunnel for the run (default `false`) |
| `sauceConnectOpts` | Tunnel options: any `sc run` flag, camelCased (e.g. `tunnelDomains`) |
| `tunnelName`, `tunnelOwner` | Use a tunnel that is already running, or one shared with you |

## Running tests

Each worker uses one device. Set `workers` to your account's
[concurrency](https://docs.saucelabs.com/basics/acct-team-mgmt/concurrency/managing-concurrency/),
and run Android and iOS in separate processes:

```bash
npx mobilewright test --project android
npx mobilewright test --project ios
```

```bash
DEBUG=mw:mobilewright-driver* npx mobilewright test   # driver debug logging
SAUCE_LIVE_VIEW=1 npx mobilewright test              # print a link to watch each device live
```

A retry shows up on Sauce Labs as `… (retry 1)`. Each test in the HTML report links to its Sauce
Labs job, where the video is.

## Sauce Connect

Use [Sauce Connect](https://docs.saucelabs.com/secure-connections/sauce-connect-5/) when your app
talks to a server on your machine or on a private network. The driver downloads it, starts the
tunnel before the first test and stops it at the end:

```ts
driver: sauceLabsDriver({
  sauceConnect: true,
  sauceConnectOpts: { tunnelDomains: ['.*\\.internal'] }, // optional: only these hosts use the tunnel
}),
```

Devices don't send `localhost` or `127.0.0.1` through the tunnel, so use another host name for
your server.

## Switching between a local device and Sauce Labs

Keep one config and pick the driver by environment: local (mobilecli) by default, Sauce Labs when
credentials are present.

```ts
import { defineConfig, type MobilewrightConfig } from 'mobilewright';
import { sauceLabsDriver } from '@saucelabs/mobilewright-driver';

const config: MobilewrightConfig = { /* ...your existing config... */ };

if (process.env.SAUCE_USERNAME) {
  config.driver = sauceLabsDriver();
}

export default defineConfig(config);
```

```bash
npx mobilewright test                               # local device
SAUCE_USERNAME=... SAUCE_ACCESS_KEY=... \
  npx mobilewright test                             # the same suite on Sauce Labs
```

## Learn more

Public and private devices, web views, Sauce Connect details, troubleshooting and complete example
projects are in the
[`@saucelabs/mobilewright-driver` repository](https://github.com/saucelabs/mobilewright-saucelabs).
