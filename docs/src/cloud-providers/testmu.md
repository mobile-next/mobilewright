---
sidebar_class_name: sidebar-icon-testmu
sidebar_position: 6
title: TestMu AI
---

# TestMu AI

[TestMu AI](https://www.testmuai.com/) (formerly LambdaTest) runs Mobilewright tests on real
Android and iOS devices through the
[`@testmuai/mobilewright`](https://www.npmjs.com/package/@testmuai/mobilewright) driver,
maintained by TestMu AI. Each test shows up on the App Automation dashboard with its video,
device logs and network logs, named after the test and marked passed or failed, and no
TestMu AI-specific code is needed in your tests.

Requires `mobilewright` 0.0.56 or later and Node.js ≥ 22.12. Real devices only, emulators and
simulators are not supported. Mobilewright support on TestMu AI is in beta.

## Setup

### 1. Install the driver

```bash
npm install --save-dev @testmuai/mobilewright
```

### 2. Set your credentials

Find your username and access key under
[Account Settings > Password & Security](https://accounts.lambdatest.com/security) and export
them:

```bash
export TESTMU_USERNAME=...
export TESTMU_ACCESS_KEY=...
```

The `LT_USERNAME` and `LT_ACCESS_KEY` names also work. The driver takes `username` and
`accessKey` options directly too, but keep credentials out of the repository.

### 3. Upload your app

Every session starts with the app under test installed. Upload it once and keep the `lt://` ID
it returns:

```bash
curl -u "$TESTMU_USERNAME:$TESTMU_ACCESS_KEY" \
  -X POST https://manual-api.lambdatest.com/app/upload/realDevice \
  -F "appFile=@app.apk"
```

The `app_url` in the response is the ID to pass to the driver. You can also pass a local
`.apk`, `.aab` or `.ipa` path, which is uploaded once per run and shared across workers, or a
public `https://` URL.

### 4. Set the driver

```ts
// mobilewright.config.ts
import { defineConfig } from 'mobilewright';
import { testMuDriver } from '@testmuai/mobilewright';

export default defineConfig({
  testDir: './tests',
  timeout: 180_000,
  use: { actionTimeout: 20_000 },
  expect: { timeout: 20_000 },
  driver: testMuDriver({
    apps: {
      android: 'lt://APP_ANDROID_ID',
      ios: 'lt://APP_IOS_ID',
    },
    build: 'my-first-build',
  }),
  projects: [
    {
      name: 'android',
      use: {
        platform: 'android',
        deviceName: /Pixel/,
        osVersion: '>=13',
        bundleId: 'com.lambdatest.proverbial',
      },
    },
    {
      name: 'ios',
      use: {
        platform: 'ios',
        deviceName: /iPhone/,
        osVersion: '>=17',
        bundleId: 'com.lambdatest.proverbial',
      },
    },
  ],
});
```

Device selection uses the standard config fields: `platform`, `deviceName` (regex) and
`osVersion` (exact, or a range like `">=17 <19"`, rounded to whole major versions). Broader
patterns get a device faster. Set `bundleId` so Mobilewright can relaunch the app before each
test.

The app under test goes in the driver's `app` or `apps`, not in `installApps`. Use
`installApps` only for helper apps.

Mobilewright's 5-second default timeouts are meant for local devices. Raise `actionTimeout` and
`expect` for cloud devices, as in the example above.

## Driver options

All options are optional, but every session needs an app.

| Option | Purpose |
| --- | --- |
| `username`, `accessKey` | Credentials; default to the environment variables above |
| `app` | `lt://` ID, local file or `https://` URL; defaults to `TESTMU_APP` |
| `apps` | Per-platform apps keyed `android`, `ios`, `android-real`, `ios-real`; overrides `app` |
| `build`, `project`, `name`, `tags` | How sessions are grouped and named on the dashboard; `build` defaults to `TESTMU_BUILD` |
| `region` | `US`, `EU` or `AP`; defaults to the nearest data center |
| `video`, `deviceLog`, `networkLog` | What TestMu AI records per session |
| `tunnel`, `tunnelName` | Route device traffic through a running tunnel |
| `geoLocation`, `timezone` | Two-letter country code for IP geolocation, device timezone |
| `autoGrantPermissions` | Grant Android runtime permissions on install |
| `autoAcceptAlerts`, `autoDismissAlerts` | Handle iOS system alerts |
| `disableAnimation` | Turn off system animations (`use.animations` has no effect here) |
| `visibility` | `'native'` (default) or `'bounds'`, which matches local runs |
| `allocationTimeout` | How long to wait for a device, including queue time (default 900s) |
| `capabilities` | Any other App Automation capability, such as `networkProfile`; wins over named options |

The [references page](https://www.testmuai.com/support/docs/mobilewright-references/) lists every
option and its default.

## Running tests

Each worker uses one device. Set `workers` to your plan's parallel session limit, extra workers
wait for a free device. Run Android and iOS in separate processes:

```bash
npx mobilewright test --project android
npx mobilewright test --project ios
```

```bash
DEBUG=testmu:* npx mobilewright test   # driver debug logging
```

The debug log shows device allocation, every device command and app uploads. Include it and the
session ID when you contact TestMu AI support.

## Tunnels

Use the [TestMu AI tunnel](https://www.testmuai.com/support/docs/mobilewright-set-up-test-environment/)
when your app talks to a server on your machine or on a private network. Start the tunnel binary
first, then point the driver at it by name:

```bash
./LT --user "$TESTMU_USERNAME" --key "$TESTMU_ACCESS_KEY" --tunnelName my-tunnel
```

```ts
driver: testMuDriver({
  app: 'lt://APP_ID',
  tunnel: true,
  tunnelName: 'my-tunnel',
}),
```

## Known differences from local runs

- On iOS, an element covered by another one can report as not visible. Set `visibility: 'bounds'` to match local runs.
- `getByType()` matches raw native types such as `XCUIElementTypeSwitch`. Prefer `getByRole()`.
- Web views are visible only in debug builds, or on iOS 16.4+ with `isInspectable = true`.
- `device.listApps()` returns only apps launched in the current session.

## Switching between a local device and TestMu AI

Keep one config and pick the driver by environment: local (mobilecli) by default, TestMu AI when
credentials are present.

```ts
import { defineConfig, type MobilewrightConfig } from 'mobilewright';
import { testMuDriver } from '@testmuai/mobilewright';

const config: MobilewrightConfig = { /* ...your existing config... */ };

if (process.env.TESTMU_USERNAME) {
  config.driver = testMuDriver({ app: process.env.TESTMU_APP });
}

export default defineConfig(config);
```

```bash
npx mobilewright test                                   # local device
TESTMU_USERNAME=... TESTMU_ACCESS_KEY=... TESTMU_APP=lt://... \
  npx mobilewright test                                 # the same suite on TestMu AI
```

## Learn more

Setup guides, troubleshooting and a complete example project are in the
[TestMu AI Mobilewright docs](https://www.testmuai.com/support/docs/mobilewright-overview/) and the
[sample repository](https://github.com/LambdaTest/testmuai-mobilewright-sample).
