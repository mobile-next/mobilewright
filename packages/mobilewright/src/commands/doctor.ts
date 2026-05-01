/**
 * mobilewright doctor
 *
 * Checks the local environment for everything needed to do iOS and Android
 * development. Supports macOS and Windows. Prints a human-readable report
 * by default; pass --json for structured output designed for AI agent
 * consumption.
 *
 * Each check result has the shape:
 *   id       – stable identifier for programmatic use
 *   name     – human-readable label
 *   category – 'system' | 'ios' | 'android'
 *   status   – 'ok' | 'warning' | 'error'
 *   version  – detected version string (null if not applicable)
 *   path     – detected binary / directory path (null if not applicable)
 *   details  – explanation when status !== 'ok' (null otherwise)
 *   fix      – ordered shell commands to resolve the issue (null if ok)
 */

import { spawnSync, SpawnSyncOptions } from 'node:child_process';
import { accessSync, constants, readdirSync } from 'node:fs';
import { arch, homedir, release } from 'node:os';
import { join } from 'node:path';
import { resolveMobilecliBinary } from '@mobilewright/driver-mobilecli';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CheckStatus = 'ok' | 'warning' | 'error';
export type CheckCategory = 'system' | 'ios' | 'android';

export interface CheckResult {
  id: string;
  name: string;
  category: CheckCategory;
  status: CheckStatus;
  version: string | null;
  path: string | null;
  details: string | null;
  /** Ordered list of shell commands that resolve this issue. */
  fix: string[] | null;
}

export interface DoctorReport {
  _schema: 'mobilewright-doctor-v1';
  mobilewright_version: string;
  timestamp: string;
  platform: string;
  arch: string;
  platform_version: string;
  summary: {
    total: number;
    ok: number;
    warnings: number;
    errors: number;
    ready: boolean;
  };
  /**
   * Plain-English instructions for an AI agent reading this JSON.
   * Tells it what to do with the `fix` arrays.
   */
  agent_instructions: string;
  checks: CheckResult[];
}

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
  white:  '\x1b[97m',
} as const;

const ICON: Record<CheckStatus, string> = {
  ok:      `${C.green}✓${C.reset}`,
  warning: `${C.yellow}⚠${C.reset}`,
  error:   `${C.red}✗${C.reset}`,
};

// ─── Platform helpers ─────────────────────────────────────────────────────────

function isMac(): boolean   { return process.platform === 'darwin'; }
function isWin(): boolean   { return process.platform === 'win32'; }

// ─── Low-level utilities ──────────────────────────────────────────────────────

function run(cmd: string, args: string[] = [], opts: SpawnSyncOptions = {}): string | null {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 8000, env: process.env, ...opts });
  if (r.error || r.status !== 0) return null;
  return ((r.stdout as string) || '').trim() || null;
}

/** Like run() but merges stdout + stderr — needed for java -version. */
function runCombined(cmd: string, args: string[] = []): string | null {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 8000, env: process.env });
  return (((r.stderr as string) || '') + ((r.stdout as string) || '')).trim() || null;
}

function which(bin: string): string | null {
  // On Windows use `where`, on Unix use `which`
  if (isWin()) {
    const r = spawnSync('where', [bin], { encoding: 'utf8', timeout: 5000, env: process.env });
    if (r.error || r.status !== 0) return null;
    // `where` returns all matches — take the first line
    return ((r.stdout as string) || '').split(/\r?\n/)[0]?.trim() || null;
  }
  return run('which', [bin]);
}

function pathExists(p: string): boolean {
  try { accessSync(p, constants.F_OK); return true; } catch { return false; }
}

function check(
  id: string,
  name: string,
  category: CheckCategory,
  status: CheckStatus,
  opts: Partial<Omit<CheckResult, 'id' | 'name' | 'category' | 'status'>> = {},
): CheckResult {
  return {
    id, name, category, status,
    version: opts.version ?? null,
    path:    opts.path    ?? null,
    details: opts.details ?? null,
    fix:     opts.fix     ?? null,
  };
}

// ─── System checks ────────────────────────────────────────────────────────────

function checkMacOS(): CheckResult | null {
  if (!isMac()) return null;

  const version = run('sw_vers', ['-productVersion']);
  const name    = run('sw_vers', ['-productName']) ?? 'macOS';

  if (!version) {
    return check('macos', 'macOS', 'system', 'error', {
      details: 'Could not determine macOS version.',
    });
  }

  const major = parseInt(version.split('.')[0], 10);
  const cpu   = arch() === 'arm64' ? 'Apple Silicon (arm64)' : 'Intel (x86_64)';

  return check('macos', 'macOS', 'system', major >= 13 ? 'ok' : 'warning', {
    version: `${name} ${version}  [${cpu}]`,
    details: major < 13 ? 'macOS 13 Ventura or newer is recommended.' : null,
    fix:     major < 13 ? ['# Open System Settings → General → Software Update'] : null,
  });
}

function checkWindows(): CheckResult | null {
  if (!isWin()) return null;

  // `ver` outputs e.g. "Microsoft Windows [Version 10.0.22631.4460]"
  const raw     = run('cmd', ['/c', 'ver']);
  const match   = raw?.match(/\[Version ([^\]]+)\]/);
  const version = match ? match[1] : raw ?? 'unknown';

  // Build number 22000+ = Windows 11
  const build   = parseInt(version.split('.')[2] ?? '0', 10);
  const isWin11 = build >= 22000;

  return check('windows', 'Windows', 'system', isWin11 ? 'ok' : 'warning', {
    version,
    details: !isWin11 ? 'Windows 11 is recommended for the best Android development experience.' : null,
  });
}

function checkWingetOrChoco(): CheckResult | null {
  if (!isWin()) return null;

  // Prefer winget (built into Windows 11), fall back to choco
  const wingetPath = which('winget');
  if (wingetPath) {
    const version = run('winget', ['--version'])?.replace('v', '');
    return check('package_manager', 'winget', 'system', 'ok', { version, path: wingetPath });
  }

  const chocoPath = which('choco');
  if (chocoPath) {
    const version = run('choco', ['--version']);
    return check('package_manager', 'Chocolatey', 'system', 'ok', { version, path: chocoPath });
  }

  return check('package_manager', 'Package Manager (winget / Chocolatey)', 'system', 'warning', {
    details: 'A package manager makes installing dev tools much easier.',
    fix: [
      '# winget ships with Windows 11 — update via Microsoft Store if missing',
      '# Or install Chocolatey (run in admin PowerShell):',
      'Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString("https://community.chocolatey.org/install.ps1"))',
    ],
  });
}

function checkGit(): CheckResult {
  const gitPath = which('git');
  if (!gitPath) {
    return check('git', 'Git', 'system', 'error', {
      details: 'Git is required for cloning repos and most toolchains.',
      fix: isMac()
        ? ['xcode-select --install']
        : ['winget install --id Git.Git', '# Or: choco install git'],
    });
  }
  return check('git', 'Git', 'system', 'ok', {
    version: run('git', ['--version'])?.replace('git version ', ''),
    path: gitPath,
  });
}

function checkNode(): CheckResult {
  const nodePath = which('node');
  if (!nodePath) {
    return check('node', 'Node.js', 'system', 'error', {
      details: 'Node.js 18+ is required.',
      fix: isMac()
        ? [
          'brew install node',
          '# Or use nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/HEAD/install.sh | bash && nvm install --lts',
        ]
        : [
          'winget install OpenJS.NodeJS.LTS',
          '# Or: choco install nodejs-lts',
          '# Or use nvm-windows: winget install CoreyButler.NVMforWindows',
        ],
    });
  }
  const version = run('node', ['--version']);
  const major   = parseInt(version?.replace('v', '').split('.')[0] ?? '0', 10);
  const ok      = major >= 18;
  return check('node', 'Node.js', 'system', ok ? 'ok' : 'warning', {
    version,
    path: nodePath,
    details: !ok ? 'Node.js 18 or newer is required.' : null,
    fix:     !ok
      ? isMac()
        ? ['brew upgrade node']
        : ['winget upgrade OpenJS.NodeJS.LTS']
      : null,
  });
}

function checkNpm(): CheckResult {
  const p = which('npm');
  if (!p) {
    return check('npm', 'npm', 'system', 'error', {
      details: 'npm ships with Node.js — reinstall Node.js.',
      fix: isMac() ? ['brew install node'] : ['winget install OpenJS.NodeJS.LTS'],
    });
  }
  return check('npm', 'npm', 'system', 'ok', { version: run('npm', ['--version']), path: p });
}

function checkMobilecli(): CheckResult {
  let binary: string;
  try {
    binary = resolveMobilecliBinary();
  } catch {
    return check('mobilecli', 'mobilecli', 'system', 'error', {
      details: 'mobilecli binary not found.',
      fix: ['npm install mobilecli'],
    });
  }

  const version = run(binary, ['--version']);
  if (!version) {
    return check('mobilecli', 'mobilecli', 'system', 'error', {
      details: 'mobilecli found but failed to report version.',
      path: binary,
    });
  }

  return check('mobilecli', 'mobilecli', 'system', 'ok', {
    version: version.trim(),
    path: binary,
  });
}

type MobilecliDeviceEntry = { id: string; name: string; state: string };
type MobilecliDevicesResponse = { status: string; data: { devices: MobilecliDeviceEntry[] } };
type AgentStatusResponse = { status: string; data: { message: string; agent?: { version: string; bundleId: string } } };

function getAgentStatus(binary: string, deviceId: string): string {
  const output = run(binary, ['agent', 'status', '--device', deviceId]);
  if (!output) {
    return 'agent: unknown';
  }

  try {
    const response = JSON.parse(output) as AgentStatusResponse;
    if (response.status !== 'ok' || !response.data.agent) {
      return 'agent: not installed';
    }
    const agent = response.data.agent;
    const version = agent.version || 'unknown';
    return `agent: ${agent.bundleId} v${version}`;
  } catch {
    return 'agent: unknown';
  }
}

function checkMobilecliDevices(): CheckResult {
  let binary: string;
  try {
    binary = resolveMobilecliBinary();
  } catch {
    return check('mobilecli_devices', 'mobilecli devices', 'system', 'error', {
      details: 'mobilecli binary not found.',
    });
  }

  const output = run(binary, ['devices']);
  if (!output) {
    return check('mobilecli_devices', 'mobilecli devices', 'system', 'warning', {
      details: 'Could not list devices via mobilecli.',
    });
  }

  try {
    const response = JSON.parse(output) as MobilecliDevicesResponse;
    const devices = response.data.devices;
    const online = devices.filter(d => d.state === 'online');

    if (online.length === 0) {
      return check('mobilecli_devices', 'mobilecli devices', 'system', 'warning', {
        version: `${devices.length} device${devices.length !== 1 ? 's' : ''} found, none online`,
        details: devices.length > 0
          ? 'Devices: ' + devices.map(d => `${d.name} (${d.id}) [${d.state}]`).join(', ')
          : null,
      });
    }

    const deviceLines = online.map(d => {
      const agentStatus = getAgentStatus(binary, d.id);
      return `${d.name} (${d.id}) — ${agentStatus}`;
    });

    return check('mobilecli_devices', 'mobilecli devices', 'system', 'ok', {
      version: `${online.length} online device${online.length !== 1 ? 's' : ''}`,
      details: deviceLines.join('\n'),
    });
  } catch {
    return check('mobilecli_devices', 'mobilecli devices', 'system', 'warning', {
      details: 'Could not parse mobilecli devices output.',
    });
  }
}

// ─── iOS checks (macOS only) ──────────────────────────────────────────────────

function checkXcode(): CheckResult | null {
  if (!isMac()) return null;

  const raw = run('xcodebuild', ['-version']);
  if (!raw) {
    return check('xcode', 'Xcode', 'ios', 'error', {
      details: 'Xcode is required for building iOS apps and running simulators.',
      fix: [
        '# Install from the Mac App Store:',
        'open "https://apps.apple.com/app/xcode/id497799835"',
        '# Or via mas-cli:',
        'brew install mas && mas install 497799835',
        '# Accept the license after install:',
        'sudo xcodebuild -license accept',
      ],
    });
  }

  const lines   = raw.split('\n');
  const version = lines[0]?.replace('Xcode ', '');
  const build   = lines[1]?.replace('Build version ', '');
  const xcPath  = run('xcode-select', ['-p']);

  return check('xcode', 'Xcode', 'ios', 'ok', {
    version: `${version} (${build})`,
    path: xcPath,
  });
}

function checkXcodeCLT(): CheckResult | null {
  if (!isMac()) return null;

  const cltPath = run('xcode-select', ['-p']);
  if (!cltPath) {
    return check('xcode_clt', 'Xcode Command Line Tools', 'ios', 'error', {
      details: 'CLT provides compilers and build tools required by many packages.',
      fix: ['xcode-select --install'],
    });
  }
  return check('xcode_clt', 'Xcode Command Line Tools', 'ios', 'ok', {
    path: cltPath,
  });
}

function checkIOSSimulators(): CheckResult | null {
  if (!isMac()) return null;

  if (!which('xcrun')) {
    return check('ios_simulators', 'iOS Simulators', 'ios', 'error', {
      fix: ['xcode-select --install'],
    });
  }

  // Also validates xcrun/simctl responds — a hang here would block mobilecli
  const raw = run('xcrun', ['simctl', 'list', 'devices', '--json'], { timeout: 10000 });
  if (!raw) {
    return check('ios_simulators', 'iOS Simulators', 'ios', 'error', {
      details: '`xcrun simctl list` timed out or failed. Xcode may need repair.',
      fix: [
        'sudo xcode-select --reset',
        'sudo xcodebuild -license accept',
        '# If the issue persists, reinstall Xcode Command Line Tools:',
        'sudo rm -rf /Library/Developer/CommandLineTools',
        'xcode-select --install',
      ],
    });
  }

  type SimDevice = { isAvailable?: boolean; udid?: string; name?: string; state?: string };

  try {
    const data = JSON.parse(raw) as { devices?: Record<string, SimDevice[]> };
    const iosDevices = Object.entries(data.devices ?? {})
      .filter(([runtime]) => runtime.toLowerCase().includes('ios'))
      .flatMap(([, devs]) => devs.filter(d => d.isAvailable));

    if (iosDevices.length === 0) {
      return check('ios_simulators', 'iOS Simulators', 'ios', 'warning', {
        details: 'No iOS simulators found. Install one via Xcode → Settings → Platforms.',
        fix: ['open -a Xcode', '# Xcode → Settings (⌘,) → Platforms → click + → iOS'],
      });
    }

    const booted = iosDevices.filter(d => d.state === 'Booted');
    const bootedDetails = booted.length > 0
      ? booted.map(d => `${d.name} (${d.udid})`).join(', ')
      : null;

    return check('ios_simulators', 'iOS Simulators', 'ios', 'ok', {
      version: `${iosDevices.length} available, ${booted.length} booted`,
      details: bootedDetails,
    });
  } catch {
    return check('ios_simulators', 'iOS Simulators', 'ios', 'warning', {
      details: 'Could not parse simulator list.',
    });
  }
}

// ─── Android checks ───────────────────────────────────────────────────────────

function checkJava(): CheckResult {
  const javaPath = which('java');
  if (!javaPath) {
    return check('java', 'Java (JDK)', 'android', 'error', {
      details: 'JDK 17 is recommended for Android development.',
      fix: isMac()
        ? [
          'brew install --cask zulu@17',
          '# Add to your shell profile (~/.zshrc):',
          'export JAVA_HOME=$(/usr/libexec/java_home -v 17)',
        ]
        : [
          '# Find and install Microsoft OpenJDK 17:',
          'winget search Microsoft.OpenJDK',
          'winget install Microsoft.OpenJDK.17',
          '# Then set JAVA_HOME in System Environment Variables to:',
          '# C:\\Program Files\\Microsoft\\jdk-17',
        ],
    });
  }

  const raw     = runCombined('java', ['-version']);
  const match   = raw?.match(/version "([^"]+)"/);
  const version = match ? match[1] : raw?.split('\n')[0] ?? null;
  const parts   = version?.split('.') ?? [];
  const major   = parts[0] === '1' ? parseInt(parts[1] ?? '0', 10) : parseInt(parts[0] ?? '0', 10);
  const ok      = major >= 11;

  return check('java', 'Java (JDK)', 'android', ok ? 'ok' : 'warning', {
    version,
    path: javaPath,
    details: !ok ? 'Java 17 is recommended for Android.' : null,
    fix:     !ok
      ? isMac()
        ? ['brew install --cask zulu@17']
        : ['winget search Microsoft.OpenJDK', 'winget install Microsoft.OpenJDK.17']
      : null,
  });
}

function checkJavaHome(): CheckResult {
  const javaHome = process.env['JAVA_HOME'];
  if (!javaHome) {
    return check('java_home', 'JAVA_HOME', 'android', 'warning', {
      details: 'JAVA_HOME is not set. Some Android build tools require it explicitly.',
      fix: isMac()
        ? [
          '# Add to your shell profile (~/.zshrc or ~/.bashrc):',
          'export JAVA_HOME=$(/usr/libexec/java_home)',
          '# Or for a specific version:',
          'export JAVA_HOME=$(/usr/libexec/java_home -v 17)',
        ]
        : [
          '# Set JAVA_HOME in System Environment Variables (run in admin PowerShell):',
          '[System.Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\\Program Files\\Microsoft\\jdk-17", "Machine")',
        ],
    });
  }
  if (!pathExists(javaHome)) {
    return check('java_home', 'JAVA_HOME', 'android', 'error', {
      details: `JAVA_HOME="${javaHome}" does not exist.`,
      fix: isMac()
        ? ['export JAVA_HOME=$(/usr/libexec/java_home)']
        : ['# Update JAVA_HOME in System Environment Variables to a valid JDK path'],
    });
  }
  return check('java_home', 'JAVA_HOME', 'android', 'ok', { path: javaHome });
}

function checkAndroidHome(): CheckResult {
  const androidHome = process.env['ANDROID_HOME'] ?? process.env['ANDROID_SDK_ROOT'];

  // Default SDK locations per platform
  const defaultPath = isMac()
    ? join(homedir(), 'Library', 'Android', 'sdk')
    : isWin()
      ? join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'Android', 'Sdk')
      : join(homedir(), 'Android', 'Sdk');

  if (!androidHome) {
    return check('android_home', 'ANDROID_HOME', 'android', 'error', {
      details: 'ANDROID_HOME is not set. Install Android Studio and configure it.',
      fix: isMac()
        ? [
          'brew install --cask android-studio',
          '# Open Android Studio and complete the setup wizard (downloads the SDK)',
          '# Then add to your shell profile (~/.zshrc or ~/.bashrc):',
          'export ANDROID_HOME=$HOME/Library/Android/sdk',
          'export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator',
        ]
        : [
          'winget install Google.AndroidStudio',
          '# Or: choco install androidstudio',
          '# Open Android Studio and complete the setup wizard (downloads the SDK)',
          '# Then set ANDROID_HOME in System Environment Variables (admin PowerShell):',
          `[System.Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\\Android\\Sdk", "Machine")`,
          `$path = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")`,
          `[System.Environment]::SetEnvironmentVariable("PATH", "$path;$env:LOCALAPPDATA\\Android\\Sdk\\platform-tools;$env:LOCALAPPDATA\\Android\\Sdk\\emulator", "Machine")`,
        ],
    });
  }
  if (!pathExists(androidHome)) {
    return check('android_home', 'ANDROID_HOME', 'android', 'error', {
      details: `ANDROID_HOME="${androidHome}" does not exist. Run Android Studio setup.`,
      fix: isMac()
        ? ['open -a "Android Studio"']
        : ['# Open Android Studio to download the SDK, or run: winget install Google.AndroidStudio'],
    });
  }

  return check('android_home', 'ANDROID_HOME', 'android', 'ok', {
    path: androidHome,
  });
}

function findAdb(): string | null {
  const androidHome = process.env['ANDROID_HOME'] ?? process.env['ANDROID_SDK_ROOT'];
  if (androidHome) {
    const candidate = join(androidHome, 'platform-tools', isWin() ? 'adb.exe' : 'adb');
    if (pathExists(candidate)) return candidate;
  }
  return which('adb');
}

function checkADB(): CheckResult {
  const adbPath = findAdb();

  if (!adbPath) {
    return check('adb', 'ADB (Android Debug Bridge)', 'android', 'error', {
      details: 'ADB is required to communicate with Android devices and emulators.',
      fix: isMac()
        ? ['brew install android-platform-tools']
        : [
          'winget install Google.PlatformTools',
          '# Or: choco install adb',
          '# Ensure platform-tools is on your PATH',
        ],
    });
  }

  const raw     = run(adbPath, ['version']);
  const match   = raw?.match(/Android Debug Bridge version ([^\n\r]+)/);
  const version = match ? match[1].trim() : null;

  return check('adb', 'ADB (Android Debug Bridge)', 'android', 'ok', { version, path: adbPath });
}

function checkADBDevices(): CheckResult {
  const adbPath = findAdb();

  if (!adbPath) {
    return check('adb_devices', 'ADB Devices', 'android', 'error', {
      details: 'ADB not found — install it first.',
    });
  }

  const devicesRaw = run(adbPath, ['devices'], { timeout: 10000 });

  if (devicesRaw === null) {
    return check('adb_devices', 'ADB Devices', 'android', 'error', {
      path: adbPath,
      details: '`adb devices` did not complete within 10 seconds. The ADB server may be stuck.',
      fix: [
        `${adbPath} kill-server`,
        `${adbPath} start-server`,
        '# Then re-run: npx mobilewright doctor',
      ],
    });
  }

  if (!devicesRaw.includes('List of devices attached')) {
    return check('adb_devices', 'ADB Devices', 'android', 'error', {
      path: adbPath,
      details: '`adb devices` returned unexpected output (missing "List of devices attached").',
    });
  }

  const lines = devicesRaw.split('\n').slice(1); // skip "List of devices attached"
  const deviceIds = lines
    .map(line => line.trim().split(/\s+/)[0])
    .filter(id => id && id.length > 0);

  return check('adb_devices', 'ADB Devices', 'android', 'ok', {
    path: adbPath,
    version: `${deviceIds.length} device${deviceIds.length !== 1 ? 's' : ''} connected`,
    details: deviceIds.length > 0 ? JSON.stringify(deviceIds) : null,
  });
}

function checkAndroidEmulator(): CheckResult {
  const androidHome = process.env['ANDROID_HOME'] ?? process.env['ANDROID_SDK_ROOT'];
  let emulatorPath: string | null = null;

  if (androidHome) {
    const candidate = join(androidHome, 'emulator', isWin() ? 'emulator.exe' : 'emulator');
    if (pathExists(candidate)) emulatorPath = candidate;
  }
  if (!emulatorPath) emulatorPath = which('emulator');

  if (!emulatorPath) {
    return check('android_emulator', 'Android Emulator', 'android', 'warning', {
      details: 'Required to run Android virtual devices locally.',
      fix: isMac()
        ? [
          '# Open Android Studio → SDK Manager → SDK Tools',
          '# Check "Android Emulator" → Apply',
          'export PATH=$PATH:$ANDROID_HOME/emulator',
        ]
        : [
          '# Open Android Studio → SDK Manager → SDK Tools',
          '# Check "Android Emulator" → Apply',
          '# Ensure emulator directory is on your PATH',
        ],
    });
  }

  const r       = spawnSync(emulatorPath, ['-version'], { encoding: 'utf8', timeout: 8000 });
  const raw     = (((r.stdout as string) || '') + ((r.stderr as string) || '')).trim();
  const match   = raw.match(/Android emulator version ([^\n\r\s-]+)/);
  const version = match ? match[1] : null;

  return check('android_emulator', 'Android Emulator', 'android', 'ok', {
    version,
    path: emulatorPath,
  });
}

function checkAndroidSDKPlatforms(): CheckResult | null {
  const androidHome = process.env['ANDROID_HOME'] ?? process.env['ANDROID_SDK_ROOT'];
  if (!androidHome) return null;

  const platformsDir = join(androidHome, 'platforms');
  if (!pathExists(platformsDir)) {
    return check('android_sdk_platforms', 'Android SDK Platforms', 'android', 'error', {
      details: 'No Android SDK platforms installed.',
      fix: [
        '# Open Android Studio → SDK Manager → SDK Platforms',
        '# Install "Android 14 (API 34)" or the latest stable release',
      ],
    });
  }

  let platforms: string[] = [];
  try { platforms = readdirSync(platformsDir).filter(d => d.startsWith('android-')); } catch { /* ignore */ }

  if (platforms.length === 0) {
    return check('android_sdk_platforms', 'Android SDK Platforms', 'android', 'error', {
      details: 'No Android SDK platforms installed.',
      fix: ['# Open Android Studio → SDK Manager → SDK Platforms → install Android 14 (API 34)'],
    });
  }

  const apiLevels = platforms
    .map(p => parseInt(p.replace('android-', ''), 10))
    .filter(n => !isNaN(n))
    .sort((a, b) => b - a);

  return check('android_sdk_platforms', 'Android SDK Platforms', 'android', 'ok', {
    version: `API ${apiLevels[0]} (latest)  [${platforms.length} platform${platforms.length !== 1 ? 's' : ''} installed]`,
  });
}

function checkAndroidBuildTools(): CheckResult | null {
  const androidHome = process.env['ANDROID_HOME'] ?? process.env['ANDROID_SDK_ROOT'];
  if (!androidHome) return null;

  const buildToolsDir = join(androidHome, 'build-tools');
  if (!pathExists(buildToolsDir)) {
    return check('android_build_tools', 'Android Build Tools', 'android', 'warning', {
      details: 'Build tools are required to compile Android apps.',
      fix: ['# Open Android Studio → SDK Manager → SDK Tools → check "Android SDK Build-Tools" → Apply'],
    });
  }

  let versions: string[] = [];
  try {
    versions = readdirSync(buildToolsDir)
      .filter(d => /^\d/.test(d))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch { /* ignore */ }

  if (versions.length === 0) {
    return check('android_build_tools', 'Android Build Tools', 'android', 'warning', {
      details: 'No build-tools versions found.',
      fix: ['# Open Android Studio → SDK Manager → SDK Tools → check "Android SDK Build-Tools" → Apply'],
    });
  }

  return check('android_build_tools', 'Android Build Tools', 'android', 'ok', {
    version: `${versions[0]} (latest)  [${versions.length} version${versions.length !== 1 ? 's' : ''} installed]`,
  });
}

// ─── Windows-specific Android checks ─────────────────────────────────────────

/**
 * On Windows, Android Emulator requires Hardware Acceleration (HAXM or
 * Windows Hypervisor Platform).  Check that Hyper-V / WHPX is enabled.
 */
function checkWindowsHypervisor(): CheckResult | null {
  if (!isWin()) return null;

  // `systeminfo` is slow; use a quicker PowerShell query
  const raw = run('powershell', [
    '-NoProfile', '-Command',
    '(Get-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform).State',
  ]);

  if (!raw) {
    return check('windows_hypervisor', 'Windows Hypervisor Platform', 'android', 'warning', {
      details: 'Could not determine Hypervisor Platform status. Android Emulator requires hardware acceleration.',
      fix: [
        '# Enable via admin PowerShell:',
        'Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All -NoRestart',
        '# Or: Settings → System → Optional Features → Windows Hypervisor Platform',
      ],
    });
  }

  const enabled = raw.trim().toLowerCase() === 'enabled';
  return check('windows_hypervisor', 'Windows Hypervisor Platform', 'android', enabled ? 'ok' : 'error', {
    details: !enabled ? 'Required for Android Emulator hardware acceleration.' : null,
    fix: !enabled
      ? [
        '# Enable via admin PowerShell:',
        'Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All',
        '# Restart required after enabling',
      ]
      : null,
  });
}

/**
 * Windows Defender can heavily slow down Android builds and the emulator.
 * Check if the Android SDK path is excluded from real-time scanning.
 */
function checkWindowsDefenderExclusion(): CheckResult | null {
  if (!isWin()) return null;

  const androidHome = process.env['ANDROID_HOME'] ?? process.env['ANDROID_SDK_ROOT'];
  if (!androidHome) return null;

  const raw = run('powershell', [
    '-NoProfile', '-Command',
    '(Get-MpPreference).ExclusionPath -join ";"',
  ]);

  if (!raw) {
    return check('windows_defender', 'Windows Defender SDK Exclusion', 'android', 'warning', {
      details: 'Could not read Defender exclusions. Adding the Android SDK improves build performance.',
      fix: [
        '# Run in admin PowerShell:',
        `Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\\Android\\Sdk"`,
        `Add-MpPreference -ExclusionPath "$env:USERPROFILE\\.gradle"`,
      ],
    });
  }

  const excluded = raw.split(';').some(p =>
    p.trim().toLowerCase() === androidHome.toLowerCase(),
  );

  return check('windows_defender', 'Windows Defender SDK Exclusion', 'android', excluded ? 'ok' : 'warning', {
    path: excluded ? androidHome : null,
    details: !excluded
      ? 'Android SDK is not excluded from Windows Defender. This can significantly slow down builds and the emulator.'
      : null,
    fix: !excluded
      ? [
        '# Run in admin PowerShell:',
        `Add-MpPreference -ExclusionPath "${androidHome}"`,
        `Add-MpPreference -ExclusionPath "$env:USERPROFILE\\.gradle"`,
      ]
      : null,
  });
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export function gatherChecks(categoryFilter?: CheckCategory): CheckResult[] {
  const all: (CheckResult | null)[] = [
    // System
    checkMacOS(),
    checkWindows(),
    checkWingetOrChoco(),
    checkGit(),
    checkNode(),
    checkNpm(),
    checkMobilecli(),
    checkMobilecliDevices(),
    // iOS (macOS only — each returns null on other platforms)
    checkXcode(),
    checkXcodeCLT(),
    checkIOSSimulators(),
    // Android
    checkJava(),
    checkJavaHome(),
    checkAndroidHome(),
    checkADB(),
    checkADBDevices(),
    checkAndroidEmulator(),
    checkAndroidSDKPlatforms(),
    checkAndroidBuildTools(),
    // Windows-specific Android
    checkWindowsHypervisor(),
    checkWindowsDefenderExclusion(),
  ];

  const checks = all.filter((c): c is CheckResult => c !== null);
  return categoryFilter ? checks.filter(c => c.category === categoryFilter) : checks;
}

// ─── Renderers ────────────────────────────────────────────────────────────────

export function renderTerminal(checks: CheckResult[], version: string): string {
  const SEP = `${C.dim}${'─'.repeat(60)}${C.reset}`;
  const out: string[] = [];

  out.push('');
  out.push(`${C.bold}${C.white}mobilewright doctor${C.reset}  ${C.dim}v${version}${C.reset}`);
  out.push(SEP);

  const categories: Array<{ id: CheckCategory; label: string }> = [
    { id: 'system',  label: 'System'  },
    { id: 'ios',     label: 'iOS'     },
    { id: 'android', label: 'Android' },
  ];

  for (const cat of categories) {
    const items = checks.filter(c => c.category === cat.id);
    if (items.length === 0) continue;

    out.push('');
    out.push(`  ${C.bold}${cat.label}${C.reset}`);

    for (const item of items) {
      const icon       = ICON[item.status];
      const versionStr = item.version ? `  ${C.dim}${item.version}${C.reset}` : '';
      const pathStr    = item.path && !item.version ? `  ${C.gray}${item.path}${C.reset}` : '';

      out.push(`    ${icon}  ${C.white}${item.name}${C.reset}${versionStr}${pathStr}`);

      if (item.details) {
        const dc = item.status === 'error' ? C.red : item.status === 'warning' ? C.yellow : C.gray;
        for (const line of item.details.split('\n')) {
          out.push(`       ${dc}${line}${C.reset}`);
        }
      }

      if (item.fix) {
        for (const line of item.fix) {
          if (line.startsWith('#')) {
            out.push(`         ${C.gray}${line}${C.reset}`);
          } else {
            out.push(`       ${C.cyan}→ ${line}${C.reset}`);
          }
        }
      }
    }
  }

  out.push('');
  out.push(SEP);

  const ok       = checks.filter(c => c.status === 'ok').length;
  const warnings = checks.filter(c => c.status === 'warning').length;
  const errors   = checks.filter(c => c.status === 'error').length;

  const parts: string[] = [];
  if (ok > 0)       parts.push(`${C.green}${ok} ok${C.reset}`);
  if (warnings > 0) parts.push(`${C.yellow}${warnings} warning${warnings !== 1 ? 's' : ''}${C.reset}`);
  if (errors > 0)   parts.push(`${C.red}${errors} error${errors !== 1 ? 's' : ''}${C.reset}`);

  out.push(`  ${C.bold}Summary${C.reset}  ${parts.join(C.dim + ' · ' + C.reset)}`);

  if (errors === 0 && warnings === 0) {
    out.push(`  ${C.green}${C.bold}✓ Ready for mobile development!${C.reset}`);
  } else if (errors > 0) {
    out.push(`  ${C.dim}Fix the errors above, then re-run: npx mobilewright doctor${C.reset}`);
    out.push(`  ${C.dim}For AI-assisted fixes: npx mobilewright doctor --json | pbcopy${C.reset}`);
  } else {
    out.push(`  ${C.dim}Warnings are optional but recommended.${C.reset}`);
  }

  out.push('');
  return out.join('\n');
}

export function renderJSON(checks: CheckResult[], version: string): DoctorReport {
  const ok       = checks.filter(c => c.status === 'ok').length;
  const warnings = checks.filter(c => c.status === 'warning').length;
  const errors   = checks.filter(c => c.status === 'error').length;

  const platformVersion = isMac()
    ? (run('sw_vers', ['-productVersion']) ?? release())
    : isWin()
      ? (run('cmd', ['/c', 'ver'])?.match(/\[Version ([^\]]+)\]/)?.[1] ?? release())
      : release();

  return {
    _schema: 'mobilewright-doctor-v1',
    mobilewright_version: version,
    timestamp:            new Date().toISOString(),
    platform:             process.platform,
    arch:                 arch(),
    platform_version:     platformVersion,
    summary: { total: checks.length, ok, warnings, errors, ready: errors === 0 },
    agent_instructions: errors > 0
      ? 'Environment has issues. For each check where status is "error" or "warning", run the commands in its "fix" array to resolve it. Re-run "npx mobilewright doctor --json" after fixes to verify.'
      : 'Environment looks good. No action required.',
    checks,
  };
}
