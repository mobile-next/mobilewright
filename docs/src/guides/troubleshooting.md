---
sidebar_position: 5
title: Troubleshooting
---

# Troubleshooting

## Check your environment with `mobilewright doctor`

The `doctor` command verifies that your system has everything needed for mobile testing. Run it first when something isn't working:

```bash
npx mobilewright doctor
```

Example output:

```
mobilewright doctor  v0.0.1
────────────────────────────────────────────────────────────

  System
    ✓  macOS  macOS 15.7.4  [Apple Silicon (arm64)]
    ✓  Git  2.50.1 (Apple Git-155)
    ✓  Node.js  v22.19.0
    ✓  npm  10.9.3
    ✓  mobilecli  mobilecli version 0.3.66
    ✓  mobilecli devices  2 online devices
       iPhone (00008030-000E1D892340802E)
       iPhone 17 Pro (6A557392-1480-4355-9EBC-B1D12A0F665D)

  iOS
    ✓  Xcode  26.0.1 (17A400)
    ✓  Xcode Command Line Tools  /Applications/Xcode.app/Contents/Developer
    ✓  iOS Simulators  62 available, 2 booted

  Android
    ✓  Java (JDK)  21.0.10
    ✓  ANDROID_HOME  /Users/john/Library/Android/sdk
    ✓  ADB (Android Debug Bridge)  1.0.41
    ✓  Android Emulator  36.1.9.0

────────────────────────────────────────────────────────────
  Summary  17 ok
  ✓ Ready for mobile development!
```

The doctor checks:

- **System**: Node.js, npm, Git, mobilecli binary, and connected devices
- **iOS**: Xcode, command line tools, booted simulators, and agent installation
- **Android**: Java, ANDROID_HOME, ADB, emulator, SDK platforms, and build tools

You can filter by category or get machine-readable output:

```bash
# Check only iOS
npx mobilewright doctor --category ios

# JSON output (useful for CI or AI agents)
npx mobilewright doctor --json
```

## Debug logging

Mobilewright uses the `DEBUG` environment variable for diagnostic logging. Logs are silent by default and only appear when enabled.

### Enable mobilewright logs

```bash
# All mobilewright logs
DEBUG=mw:* npx mobilewright test

# Only mobilecli driver logs
DEBUG=mw:driver-mobilecli npx mobilewright test
```

On Windows, set the variable before running the command:

```powershell
# PowerShell
$env:DEBUG = "mw:*"
npx mobilewright test
```

```cmd
:: Command Prompt
set DEBUG=mw:*
npx mobilewright test
```

Example output with `DEBUG=mw:driver-mobile-use`:

```
mw:driver-mobile-use connecting to wss://api.mobile-use.com/ws +0ms
mw:driver-mobile-use websocket connected +570ms
mw:driver-mobile-use allocating device with filters [ { attribute: 'platform', operator: 'EQUALS', value: 'ios' } ] +0ms
mw:driver-mobile-use allocated device 00008140-001A24601E06001C (session=47abbd72-..., model=iPhone17,3) +192ms
```
