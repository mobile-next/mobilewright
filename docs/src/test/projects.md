---
title: Projects
description: Run the same test suite on multiple platforms or configurations.
sidebar:
  order: 4
---

A **project** is a named group of tests that share the same configuration. The most common use-case is running your test suite on both iOS and Android from a single config file.

## iOS and Android in one config

Define a `projects` array in `mobilewright.config.ts`. Each project sets its own `platform` and app path under `use`:

```typescript
import { defineConfig } from 'mobilewright';

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  bundleId: 'com.example.myapp',
  workers: 2,
  projects: [
    {
      name: 'ios',
      use: {
        platform: 'ios',
        installApps: 'ios/MyApp.zip',
      },
    },
    {
      name: 'android',
      use: {
        platform: 'android',
        installApps: 'android/MyApp.apk',
      },
    },
  ],
});
```

Running `npx mobilewright test` will execute all tests twice — once for each project. With `workers: 2`, both platforms run in parallel if two devices are available.

## Run a single project

Use the `--project` flag to target one platform:

```bash
npx mobilewright test --project=android
```

## Per-project overrides

The `use` block inside each project accepts the same options as the top-level config. Project-level values override the top-level defaults for that project only.

| Option | Description |
|--------|-------------|
| `platform` | `'ios'` or `'android'` |
| `bundleId` | App bundle identifier |
| `installApps` | APK or IPA/ZIP path(s) to install before tests run |
| `deviceName` | Regex to match a specific device |

A common pattern is to share `bundleId` and `timeout` at the top level, and only specify `platform` and `installApps` per project:

```typescript
export default defineConfig({
  bundleId: 'com.example.myapp',
  timeout: 120_000,
  projects: [
    {
      name: 'ios',
      use: {
        platform: 'ios',
        installApps: 'ios/MyApp.zip',
      },
    },
    {
      name: 'android',
      use: {
        platform: 'android',
        installApps: 'android/MyApp.apk',
      },
    },
  ],
});
```
