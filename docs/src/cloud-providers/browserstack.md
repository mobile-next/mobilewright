---
sidebar_position: 3
title: BrowserStack
---

# BrowserStack

[BrowserStack App Automate](https://www.browserstack.com/app-automate) runs Mobilewright tests
on real devices through the
[`@browserstack/mobilewright`](https://www.npmjs.com/package/@browserstack/mobilewright) driver,
maintained by BrowserStack. Every test session is a first-class App Automate session — dashboard,
server-side video, device and network logs — with no BrowserStack-specific code in your tests.

Requires `mobilewright` ≥ 0.0.53.

## Setup

### 1. Install the driver

```bash
npm install --save-dev @browserstack/mobilewright
```

### 2. Set your credentials

Find your username and access key in the
[BrowserStack account settings](https://www.browserstack.com/accounts/profile/details) and
export them:

```bash
export BROWSERSTACK_USERNAME=...
export BROWSERSTACK_ACCESS_KEY=...
```

### 3. Set the driver

```ts
// mobilewright.config.ts
import { defineConfig } from 'mobilewright';
import { browserStackDriver } from '@browserstack/mobilewright';

export default defineConfig({
  testDir: './tests',
  bundleId: 'com.example.app',
  driver: browserStackDriver({
    app: 'bs://<app-id>', // or a local .apk/.ipa path, or an https:// url — uploaded for you
    project: 'My project',
  }),
  projects: [
    { name: 'android', use: { platform: 'android', deviceName: /Google Pixel 8\b/ } },
    { name: 'ios', use: { platform: 'ios', deviceType: 'real', osVersion: '>=17 <19' } },
  ],
});
```

Device selection uses the standard config fields: `deviceName` (regex), `osVersion` (range
expressions like `">=17 <19"`), and `deviceType` (App Automate is always `real`). The app falls
back to the `BROWSERSTACK_APP` env var when `app` is omitted.

Session names and statuses are automatic: at run end every App Automate session is named after
the tests it ran, marked passed or failed, and its dashboard link is printed.

## Switching between a local device and BrowserStack

Keep one config and pick the driver by environment: local (mobilecli) by default, BrowserStack
when credentials are present.

```ts
import { defineConfig, type MobilewrightConfig } from 'mobilewright';
import { browserStackDriver } from '@browserstack/mobilewright';

const config: MobilewrightConfig = { /* ...your existing config... */ };

if (process.env.BROWSERSTACK_USERNAME) {
  config.driver = browserStackDriver({ app: './build/app.apk' });
}

export default defineConfig(config);
```

```bash
npx mobilewright test                                     # local device
BROWSERSTACK_USERNAME=... BROWSERSTACK_ACCESS_KEY=... \
  npx mobilewright test                                   # the same suite on App Automate
```

Local `.apk`/`.ipa` paths are uploaded automatically, once per run.

## Learn more

BrowserStack Local, geolocation and network simulation, camera and biometric injection, and
other App Automate features are documented in the
[`@browserstack/mobilewright` package on npm](https://www.npmjs.com/package/@browserstack/mobilewright).
