---
sidebar_position: 4
title: Docker
---

# Docker

The `ghcr.io/mobile-next/mobilewright` Docker image runs `mobilewright` commands inside a container — without installing Node.js or the Android SDK on your machine. It works two ways:

- **Local Android emulator** — connects to an emulator running on your host via ADB.
- **Cloud devices** — connects to real Android and iOS devices on [Mobile Next Cloud](https://mobilenext.ai).

The container runs Linux and cannot reach an iOS simulator running on your Mac host. To test iOS, use cloud devices.

## Local Android emulator

The image ships the ADB client and points it at the ADB server running on your host, so an emulator started on your machine is visible inside the container.

### Run `doctor`

Use `doctor` to verify the container can reach your host's ADB server.

#### macOS and Windows

`host.docker.internal` resolves automatically in Docker Desktop — no extra flags needed:

```bash
docker run --rm ghcr.io/mobile-next/mobilewright doctor
```

#### Linux

Pass `--add-host` so `host.docker.internal` resolves to the host gateway:

```bash
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  ghcr.io/mobile-next/mobilewright doctor
```

#### Expected output

All Android checks pass as long as your host ADB server is running and an emulator is connected.

```
mobilewright doctor  v0.0.x
────────────────────────────────────────────────────────────

  System
    ✓  Node.js  v24.x.x
    ✓  npm  x.x.x
    ✓  mobilecli  mobilecli version x.x.x
    ✓  mobilecli devices  1 online device
       emulator-5554

  Android
    ✓  ADB (Android Debug Bridge)  1.0.41
```

### Run tests

Mount your project directory into the container at `/home/mwuser` and run `mobilewright test`.

#### macOS and Windows

```bash
docker run --rm \
  -v "$(pwd):/home/mwuser" \
  ghcr.io/mobile-next/mobilewright test
```

#### Linux

```bash
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -v "$(pwd):/home/mwuser" \
  ghcr.io/mobile-next/mobilewright test
```

Test results, screenshots, and other output are written to the mounted directory and remain available after the container exits.

### Capture a screenshot

Mount your current directory so the output file lands on the host. The screenshot is written to `--output` relative to the working directory (`/home/mwuser`), which maps directly to your mounted path.

#### macOS and Windows

```bash
docker run --rm \
  -v "$(pwd):/home/mwuser" \
  ghcr.io/mobile-next/mobilewright screenshot
# → screenshot.png appears in the current directory
```

#### Linux

```bash
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -v "$(pwd):/home/mwuser" \
  ghcr.io/mobile-next/mobilewright screenshot
```

Use `--output` to specify a different filename:

```bash
docker run --rm \
  -v "$(pwd):/home/mwuser" \
  ghcr.io/mobile-next/mobilewright screenshot --output before-login.png
```

## Cloud devices

[Mobile Next Cloud](https://mobilenext.ai) gives the container access to real Android and iOS devices over the network. No host ADB server, emulator, or `--add-host` flag is needed, and the commands are identical on macOS, Windows, and Linux.

### Configure the cloud driver

Point your `mobilewright.config.ts` at the cloud driver. Read the API key from an environment variable so it is never committed:

```ts
import { defineConfig } from 'mobilewright';

export default defineConfig({
  platform: 'ios', // or 'android'
  driver: {
    type: 'mobile-use',
    apiKey: process.env.MOBILE_USE_API_KEY,
  },
});
```

### Run tests

Mount your project and pass the API key with `-e`:

```bash
docker run --rm \
  -v "$(pwd):/home/mwuser" \
  -e MOBILE_USE_API_KEY="$MOBILE_USE_API_KEY" \
  ghcr.io/mobile-next/mobilewright test
```

This works for both Android and iOS — the devices run in the cloud, so nothing else is required on the host.

## Volume and environment reference

| Option | Purpose |
|--------|---------|
| `-v "$(pwd):/home/mwuser"` | Mount your project so config, tests, and output are accessible on the host |
| `--add-host=host.docker.internal:host-gateway` | Local Android on Linux only — makes the host reachable as `host.docker.internal` |
| `-e MOBILE_USE_API_KEY=…` | Cloud devices only — authenticates with Mobile Next Cloud |

## Limitations

- **No local iOS simulator.** The container runs Linux and cannot reach an iOS simulator running on your Mac host. Test iOS against [cloud devices](#cloud-devices), or run directly on macOS with `npx mobilewright test`.
- **`screenshot` is local-only.** The `mobilewright screenshot` command always uses the local ADB driver and cannot capture Mobile Next Cloud devices. Capture cloud-device screenshots from within a test run instead.
