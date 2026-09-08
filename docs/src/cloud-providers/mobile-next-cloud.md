---
sidebar_position: 2
title: Mobile Next Cloud
---

# Mobile Next Cloud

[Mobile Next Cloud](https://mobilenext.ai/cloud?utm_source=docs&utm_medium=docs&utm_campaign=mobilewright&utm_content=cloud-providers)
gives you API access to hundreds of real Android and iOS devices. Mobilewright allocates one
device per worker, runs your tests, and uploads the results to your dashboard — no reporter
configuration needed.

## Setup

The driver ships with Mobilewright — nothing extra to install.

### 1. Get an API key

Sign in at [mobilenext.ai](https://mobilenext.ai/cloud?utm_source=docs&utm_medium=docs&utm_campaign=mobilewright&utm_content=cloud-providers-api-key),
create an API key, and export it:

```bash
export MOBILENEXT_API_KEY=...
```

### 2. Set the driver

```ts
// mobilewright.config.ts
import { defineConfig } from 'mobilewright';
import { MobileNextDriver } from '@mobilewright/driver-mobilenext';

export default defineConfig({
  testDir: './tests',
  bundleId: 'com.example.app',
  driver: new MobileNextDriver({
    apiKey: process.env.MOBILENEXT_API_KEY,
  }),
  projects: [
    {
      name: 'ios',
      use: { platform: 'ios', deviceType: 'real', osVersion: '>=18', installApps: ['./build/app.ipa'] },
    },
    {
      name: 'android',
      use: { platform: 'android', deviceType: 'real', installApps: ['./build/app.apk'] },
    },
  ],
});
```

Device selection uses the standard config fields — `platform`, `deviceType`, `deviceName`,
`osVersion` — see [Configuration](../test/configuration.md#driver) for the full list of driver
options such as `allocationTimeout` and `uploadTimeout`.

## Switching between a local device and the cloud

Keep one config and pick the driver by environment: local (mobilecli) by default, Mobile Next
Cloud when the API key is present.

```ts
import { defineConfig, type MobilewrightConfig } from 'mobilewright';
import { MobileNextDriver } from '@mobilewright/driver-mobilenext';

const config: MobilewrightConfig = {
  testDir: './tests',
  bundleId: 'com.example.app',
  fullyParallel: true,
  workers: process.env.CI ? 4 : 1,
  projects: [
    { name: 'ios', use: { platform: 'ios', deviceType: 'real', installApps: ['./build/app.ipa'] } },
  ],
};

if (process.env.MOBILENEXT_API_KEY) {
  config.driver = new MobileNextDriver({ apiKey: process.env.MOBILENEXT_API_KEY });
}

export default defineConfig(config);
```

```bash
npx mobilewright test                              # local device
MOBILENEXT_API_KEY=... npx mobilewright test       # the same suite on Mobile Next Cloud
```

## Test results

With `MobileNextDriver`, the HTML report and test results are uploaded to mobilenext.ai after
every run. Control this with the driver's `testResult` option — see
[Reporting](../test/configuration.md#reporting).

## Debugging

Set `DEBUG=mw:driver-mobilenext` to log device allocation and connection details. See
[Troubleshooting](../guides/troubleshooting.md).
