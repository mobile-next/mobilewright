---
title: Setting up on Windows
description: Install Node.js, the Android SDK and hardware acceleration to run Mobilewright tests on Windows 11.
---

# Setting up on Windows

Mobilewright runs Android tests on Windows 11. iOS testing needs Xcode, so it is macOS only — to test iOS from Windows, use a [cloud provider](../cloud-providers/mobile-next-cloud.md).

Run the commands below in **PowerShell**. Commands that change system settings need an **admin** PowerShell window (right-click → *Run as administrator*).

## 1. Run the doctor first

Before installing anything, see what is already in place:

```powershell
npx mobilewright doctor
```

On Windows the doctor checks, in order: Windows version, winget, Git, Node.js, mobilecli, Java, `JAVA_HOME`, `ANDROID_HOME`, ADB, the Android Emulator, SDK platforms and build tools, Windows Hypervisor Platform, and the Windows Defender exclusion. Every failing check prints the command that fixes it. The rest of this page walks through the same steps.

To check only the Android part:

```powershell
npx mobilewright doctor --category android
```

## 2. Install Node.js

Mobilewright needs Node.js 22.12 or newer. [winget](https://learn.microsoft.com/windows/package-manager/winget/) ships with Windows 11:

```powershell
winget install OpenJS.NodeJS.LTS
```

Open a new terminal afterwards so `node` and `npx` are on your `PATH`.

You do not need to install mobilecli — it ships with the `mobilewright` package as a Windows binary.

## 3. Install a JDK

```powershell
winget install Microsoft.OpenJDK.17
```

The installer sets `JAVA_HOME` for you. Open a new terminal and confirm with `npx mobilewright doctor`.

If the doctor still reports `JAVA_HOME` as missing, point it at the installed JDK. The folder name includes the full version (for example `jdk-17.0.13.11-hotspot`), so look it up instead of typing it (admin PowerShell):

```powershell
$jdk = (Get-ChildItem "C:\Program Files\Microsoft" -Directory -Filter "jdk-17*" | Select-Object -First 1).FullName
if (-not $jdk) { throw "No jdk-17* folder in C:\Program Files\Microsoft. Run: (Get-Command java).Source, and set JAVA_HOME to the folder above bin." }
[System.Environment]::SetEnvironmentVariable("JAVA_HOME", $jdk, "Machine")
```

## 4. Install the Android SDK

```powershell
winget install Google.AndroidStudio
```

Open Android Studio once and finish the setup wizard — it downloads the SDK to `%LOCALAPPDATA%\Android\Sdk`. In **SDK Manager**, make sure an SDK platform, **Android SDK Build-Tools** and **Android Emulator** are installed.

Then set `ANDROID_HOME` and add `adb` and `emulator` to your `PATH` (admin PowerShell):

```powershell
[System.Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "Machine")
$path = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")
[System.Environment]::SetEnvironmentVariable("PATH", "$path;$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:LOCALAPPDATA\Android\Sdk\emulator", "Machine")
```

Open a new terminal so the variables take effect.

## 5. Enable hardware acceleration

The Android Emulator needs the Windows Hypervisor Platform (admin PowerShell, then restart):

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All
```

You can also enable it in **Settings → System → Optional features → More Windows features → Windows Hypervisor Platform**. Skip this step if you only test on a USB-connected phone.

## 6. Exclude the SDK from Windows Defender

Optional, but real-time scanning noticeably slows the emulator and Android builds (admin PowerShell):

```powershell
Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\Android\Sdk"
Add-MpPreference -ExclusionPath "$env:USERPROFILE\.gradle"
```

## 7. Check again and run a test

Start an emulator from Android Studio's **Device Manager**, or connect a phone with USB debugging enabled. Mobilewright does not start one for you. Then:

```powershell
npx mobilewright doctor
npx mobilewright devices
```

When the doctor is green and your device is listed, scaffold a project and run it as described in [Installation](./intro.md#installing-mobilewright). Set `platform: 'android'` in `mobilewright.config.ts`.

## Troubleshooting

- **`Unsupported platform: win32-x64`**, or the doctor reports *mobilecli binary not found* — upgrade to the latest `mobilewright`. Older versions did not resolve the Windows binary.
- **Environment variables not picked up** — variables set with `SetEnvironmentVariable` only apply to terminals opened afterwards. Close and reopen your terminal (and your editor).
- **Setting `DEBUG` on Windows** — see [Debug logging](../guides/troubleshooting.md#debug-logging).
