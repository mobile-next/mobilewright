---
sidebar_position: 4
title: TestingBot
---

# TestingBot

[TestingBot App Automate](https://testingbot.com/support/app-automate/mobilewright) runs
Mobilewright tests on real devices, emulators and simulators through the
`@testingbot/mobilewright-driver` package, maintained by TestingBot. Every test session shows up
on the TestingBot dashboard with video and logs, and no TestingBot-specific code is needed in
your tests.

Requires `mobilewright` ≥ 0.0.53 and Node.js ≥ 18.

## Setup

### 1. Install the driver

```bash
npm install --save-dev @testingbot/mobilewright-driver
```

### 2. Set your credentials

Find your key and secret in your
[TestingBot account settings](https://testingbot.com/members/user/edit) and export them:

```bash
export TESTINGBOT_KEY=...
export TESTINGBOT_SECRET=...
```

`TB_KEY` and `TB_SECRET` are accepted as aliases. The driver also takes `key` and `secret`
options directly, but keep credentials out of the repository.

### 3. Set the driver

```ts
// mobilewright.config.ts
import { defineConfig } from 'mobilewright';
import { TestingBotDriver } from '@testingbot/mobilewright-driver';

export default defineConfig({
  testDir: './tests',
  bundleId: 'com.example.app',
  driver: new TestingBotDriver({
    apps: {
      android: './build/app.apk',
      'ios-simulator': './build/app-sim.zip',
      'ios-real': './build/app.ipa',
    },
  }),
  projects: [
    { name: 'android', use: { platform: 'android', deviceType: 'emulator' } },
    { name: 'ios', use: { platform: 'ios', deviceType: 'real', osVersion: '>=17' } },
  ],
});
```

Local `.apk`, `.ipa` and simulator `.zip` files are uploaded to TestingBot Storage for you;
already-uploaded builds are referenced by their `tb://` URL. Pass an array for a platform when
the test needs helper apps — the first entry is the app under test, the rest are installed
alongside it.

Device selection uses the standard config fields: `platform` (required), `deviceType`
(`real`, `simulator`, `emulator`), `deviceName` (regex), `osVersion` (exact, prefix, or a range
like `">=17 <19"`), and `deviceId` to pin one physical device from the catalog.

## Driver options

| Option | Purpose |
| --- | --- |
| `apps` | Required; app paths or `tb://` URLs per platform |
| `key`, `secret` | Credentials; default to the environment variables above |
| `sessionPerTest` | Fresh device session per test (default `false`) |
| `build` | Groups sessions on the dashboard; auto-detected in CI |
| `tunnelIdentifier` | Reuse an already-running TestingBot Tunnel |
| `tunnel` | Start and stop a tunnel around the run |
| `allocationTimeout` | How long to wait for a device (default 395s) |
| `commandTimeout` | Per-command timeout (default 60s) |

## Running tests

```bash
npx mobilewright test
```

```bash
DEBUG=testingbot:* npx mobilewright test   # driver debug logging
```

Build metadata is picked up automatically on GitHub Actions, GitLab, CircleCI, Buildkite,
Bitrise, Travis, Azure DevOps, Jenkins and TeamCity — no extra configuration.

## TestingBot runtime commands

Optional helpers for annotating sessions and simulating network conditions:

```ts
import { testingbot } from '@testingbot/mobilewright-driver';

await testingbot.setName('checkout flow');
await testingbot.annotate('tapped Pay');
await testingbot.throttle('3G');
console.log(testingbot.dashboardUrl());
```

## Switching between a local device and TestingBot

Keep one config and pick the driver by environment: local (mobilecli) by default, TestingBot
when credentials are present.

```ts
import { defineConfig, type MobilewrightConfig } from 'mobilewright';
import { TestingBotDriver } from '@testingbot/mobilewright-driver';

const config: MobilewrightConfig = { /* ...your existing config... */ };

if (process.env.TESTINGBOT_KEY) {
  config.driver = new TestingBotDriver({ apps: { android: './build/app.apk' } });
}

export default defineConfig(config);
```

```bash
npx mobilewright test                                   # local device
TESTINGBOT_KEY=... TESTINGBOT_SECRET=... \
  npx mobilewright test                                 # the same suite on TestingBot
```

## Learn more

Tunnels, device catalog and the rest of the driver options are documented in the
[TestingBot Mobilewright guide](https://testingbot.com/support/app-automate/mobilewright).
