---
sidebar_position: 1
title: Configuration
---

# Configuration

Mobilewright is configured through a `mobilewright.config.ts` file at the root of your project. Wrap the object in `defineConfig` for type-checking and editor autocomplete.

```ts
import { defineConfig } from 'mobilewright';

export default defineConfig({
  platform: 'ios',
  bundleId: 'com.example.myapp',
  deviceName: /iPhone/,
  timeout: 30_000,
});
```

## Config file resolution

When you run `mobilewright test`, it looks for these files in the current directory, in order:

1. `mobilewright.config.ts`
2. `mobilewright.config.js`
3. `mobilewright.config.mjs`

Pass `--config <path>` to point at a specific file instead. If no config is found, Mobilewright runs with defaults.

## Device and app

Which device to run on and which app to drive.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `platform` | `'ios' \| 'android'` | — | Target platform |
| `deviceId` | `string` | — | Specific device identifier (local drivers only) |
| `deviceName` | `RegExp` | — | Match a device by name, e.g. `/iPhone 17/` |
| `bundleId` | `string` | — | App bundle ID to launch |
| `installApps` | `string \| string[]` | — | App paths (APK/IPA) to install before launching |
| `autoAppLaunch` | `boolean` | `true` | Launch the app automatically after connecting |

## Driver

The driver decides where tests run — a local device via mobilecli, or a cloud device.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `driver` | `DriverConfig` | `{ type: 'mobilecli' }` | Which driver to use (see below) |
| `url` | `string` | — | mobilecli server URL (for a remote server) |
| `mobilecliPath` | `string` | — | Path to the mobilecli binary if it's not on `PATH` |
| `autoStart` | `boolean` | `true` | Auto-start the mobilecli server if it isn't running |

**Local (mobilecli):**

```ts
driver: { type: 'mobilecli' }
```

**Cloud (Mobile Next):**

```ts
driver: {
  type: 'mobilenext',
  apiKey: process.env.MOBILENEXT_API_KEY,
  region: 'us',
  allocationTimeout: 300_000, // wait for a cloud device, ms (default: 5 min)
  uploadTimeout: 60_000,      // upload test results, ms (default: none)
}
```

With the `mobilenext` driver, test results are uploaded to mobilenext.ai automatically unless you set `testResult: { uploadReport: 'off' }`.

## Test runner

How tests are discovered and executed.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `testDir` | `string` | config file dir | Directory to search for tests |
| `testMatch` | `string \| RegExp \| Array` | `**/*.{test,spec}.{js,ts,mjs}` | Glob patterns for test files |
| `testIgnore` | `string \| RegExp \| Array` | — | Patterns to skip during discovery |
| `outputDir` | `string` | `test-results` | Directory for test artifacts |
| `timeout` | `number` | — | Per-test timeout in ms |
| `globalTimeout` | `number` | — | Hard cap on the entire suite run in ms |
| `retries` | `number` | — | Max retries for flaky tests — see [Retries](./retries.md) |
| `workers` | `number \| string` | `1` | Concurrent workers — see [Parallelism](./parallelism.md) |
| `fullyParallel` | `boolean` | `false` | Run all tests in parallel |
| `forbidOnly` | `boolean` | — | Fail the run if `test.only` is present (useful in CI) |
| `reporter` | `'list' \| 'html' \| 'json' \| 'junit' \| Array` | — | Reporter(s) to use |
| `globalSetup` | `string \| string[]` | — | File(s) run once before all tests |
| `globalTeardown` | `string \| string[]` | — | File(s) run once after all tests |
| `projects` | `ProjectConfig[]` | — | Multi-device / multi-platform matrix — see [Projects](./projects.md) |

## Timeouts and per-action defaults

`use` sets defaults applied to every test. `expect` sets the default assertion timeout. Both can be overridden per project and per call.

```ts
export default defineConfig({
  use: {
    actionTimeout: 5_000,     // tap, fill, etc. — default 5000
    appLaunchTimeout: 20_000, // wait for app foreground — default 20000
    installTimeout: 120_000,  // installApps — default none
    animations: 'off',        // system animations: 'on' | 'off'
  },
  expect: {
    timeout: 5_000, // toBeVisible, toHaveText, etc. — default 5000
  },
});
```

See [Timeouts](./timeouts.md) for how these interact and how to override them at call sites.

## Reporting

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `viewTree` | `'on-failure' \| 'off'` | `'off'` | Attach the accessibility tree as JSON to the report; `'on-failure'` attaches only on failing tests |
| `captureGitInfo` | `{ commit?: boolean; diff?: boolean }` | — | Capture git commit info into report metadata |

## Per-project overrides

Everything that varies by device belongs in `projects`. Each project has a `use` block that overrides the top-level settings for that run.

```ts
export default defineConfig({
  bundleId: 'com.example.myapp',
  projects: [
    { name: 'iOS', use: { platform: 'ios', deviceName: /iPhone/ } },
    { name: 'Android', use: { platform: 'android', deviceName: /Pixel/ } },
  ],
});
```

The project `use` block accepts `platform`, `deviceId`, `deviceName`, `bundleId`, `installApps`, `animations`, `actionTimeout`, `appLaunchTimeout`, and `installTimeout`. Projects can also override `timeout`, `testDir`, `testMatch`, `testIgnore`, `outputDir`, `retries`, `grep`, `grepInvert`, and declare `dependencies` on other projects. See [Projects](./projects.md) for the full matrix.
