---
sidebar_position: 4
title: Docker
---

# Docker

The `mobilewright/mobilewright` Docker image lets you run `mobilewright` commands inside a container without installing Node.js or the Android SDK on your machine. It connects to an Android emulator running on the host via ADB.

**Android only.** iOS requires macOS and cannot run inside a Docker container.

## Run `doctor`

Use `doctor` to verify the container can reach your host's ADB server.

### macOS and Windows

`host.docker.internal` resolves automatically in Docker Desktop — no extra flags needed:

```bash
docker run --rm mobilewright/mobilewright doctor
```

### Linux

Pass `--add-host` so `host.docker.internal` resolves to the host gateway:

```bash
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  mobilewright/mobilewright doctor
```

## Expected `doctor` output

The `ANDROID_HOME` check will show a warning. This is expected — the image ships only the ADB client, not the full Android SDK. All other Android checks should pass as long as your host ADB server is running and an emulator is connected.

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
    ⚠  ANDROID_HOME  not set (expected inside Docker — ADB client only)

────────────────────────────────────────────────────────────
  Summary  N ok, 1 warning
```

The `ANDROID_HOME` warning does not affect test execution.

## Run tests

Mount your project directory into the container at `/home/mwuser` and run `mobilewright test`.

### macOS and Windows

```bash
docker run --rm \
  -v "$(pwd):/home/mwuser" \
  mobilewright/mobilewright test
```

### Linux

```bash
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -v "$(pwd):/home/mwuser" \
  mobilewright/mobilewright test
```

Test results, screenshots, and other output are written to the mounted directory and remain available after the container exits.

## Volume and environment reference

| Option | Purpose |
|--------|---------|
| `-v "$(pwd):/home/mwuser"` | Mount your project so tests and output are accessible on the host |
| `--add-host=host.docker.internal:host-gateway` | Required on Linux — makes the host reachable as `host.docker.internal` |
| `-e ANDROID_SERIAL=emulator-5554` | Target a specific emulator when multiple are connected |

## iOS is not supported

iOS automation requires macOS system frameworks that are unavailable inside Linux containers. Run iOS tests directly on macOS using `npx mobilewright test`.
