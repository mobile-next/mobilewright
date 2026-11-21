import { test, expect } from '@playwright/test';
import { isSupportedNodeVersion, formatDeviceLine, fixCommandsFor, usesRemoteAdbServer, hypervisorVerdict, gatherChecks } from './doctor.js';

test('accepts node 22.12 and newer', () => {
  expect(isSupportedNodeVersion('v22.12.0')).toBe(true);
  expect(isSupportedNodeVersion('v22.23.2')).toBe(true);
  expect(isSupportedNodeVersion('v24.21.0')).toBe(true);
});

test('rejects node older than 22.12', () => {
  expect(isSupportedNodeVersion('v22.11.0')).toBe(false);
  expect(isSupportedNodeVersion('v20.19.0')).toBe(false);
  expect(isSupportedNodeVersion('')).toBe(false);
});

// Android devices do not use an agent (`mobilecli agent status` answers "no
// agent needed for android devices"), so the per-device line must not show
// "agent: not installed" for them — and must not even ask mobilecli.
test.describe('device lines in the mobilecli devices check', () => {
  const lookupThatMustNotBeCalled = (id: string): string => { throw new Error(`agent status looked up for ${id}`); };

  test('an Android device says the agent is not needed', () => {
    const line = formatDeviceLine({ id: 'emulator-5554', name: 'Pixel 9 Pro', platform: 'android' }, lookupThatMustNotBeCalled);
    expect(line).toBe('Pixel 9 Pro (emulator-5554) — agent: not needed on Android');
  });

  test('an iOS device shows the looked-up agent status', () => {
    const line = formatDeviceLine({ id: 'UDID-1', name: 'iPhone 17 Pro', platform: 'ios' }, () => 'agent: com.example.runner v0.0.33');
    expect(line).toBe('iPhone 17 Pro (UDID-1) — agent: com.example.runner v0.0.33');
  });
});

// ─── Linux and remote-ADB environments ──────────────────────────────────────
// `doctor` only knew macOS and "everything else is Windows": on Linux (and in
// the official Docker image) it printed `winget install …` fixes and flagged
// Git, Java and ANDROID_HOME as errors even though the container talks to the
// host's ADB server and needs none of them.

function withProcessPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try { return fn(); } finally { Object.defineProperty(process, 'platform', original); }
}

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test.describe('fix commands per platform', () => {
  const byOs = { darwin: ['brew install x'], win32: ['winget install x'], linux: ['sudo apt-get install -y x'] };

  test('Linux gets its own commands, never winget', () => {
    expect(fixCommandsFor('linux', byOs)).toEqual(['sudo apt-get install -y x']);
  });

  test('macOS and Windows keep theirs', () => {
    expect(fixCommandsFor('darwin', byOs)).toEqual(['brew install x']);
    expect(fixCommandsFor('win32', byOs)).toEqual(['winget install x']);
  });

  test('an unknown platform falls back to the Linux commands', () => {
    expect(fixCommandsFor('freebsd', byOs)).toEqual(['sudo apt-get install -y x']);
  });
});

test.describe('remote ADB server (Docker image, device labs)', () => {
  test('is detected from ANDROID_ADB_SERVER_HOST', () => {
    expect(usesRemoteAdbServer({ ANDROID_ADB_SERVER_HOST: 'host.docker.internal' })).toBe(true);
    expect(usesRemoteAdbServer({ ADB_SERVER_SOCKET: 'tcp:10.0.0.5:5037' })).toBe(true);
    expect(usesRemoteAdbServer({})).toBe(false);
  });

  test('local Android SDK checks are skipped when a remote ADB server is configured', () => {
    const ids = withEnv({ ANDROID_ADB_SERVER_HOST: 'host.docker.internal', ANDROID_ADB_SERVER_PORT: '5037' }, () =>
      gatherChecks('android').map((c) => c.id));
    for (const skipped of ['java', 'java_home', 'android_home', 'android_emulator', 'android_sdk_platforms', 'android_build_tools']) {
      expect(ids, `${skipped} must not run against a remote ADB server`).not.toContain(skipped);
    }
    expect(ids).toContain('adb');
  });
});

test.describe('on Linux', () => {
  test('no fix suggests winget, choco, brew or PowerShell', () => {
    const checks = withProcessPlatform('linux', () => gatherChecks());
    const fixes = checks.flatMap((c) => c.fix ?? []).join('\n');
    expect(fixes).not.toMatch(/winget|choco|brew |PowerShell|SetEnvironmentVariable/);
  });

  test('a missing git is a warning, not a failure that makes doctor exit non-zero', () => {
    const checks = withProcessPlatform('linux', () => withEnv({ PATH: '/nonexistent' }, () => gatherChecks('system')));
    const git = checks.find((c) => c.id === 'git')!;
    expect(git.status).toBe('warning');
  });
});

test.describe('Windows hypervisor verdict', () => {
  test('any enabled accelerator is ok', () => {
    expect(hypervisorVerdict({ whp: 'Enabled', hyperV: 'Disabled', aehd: false }).status).toBe('ok');
    expect(hypervisorVerdict({ whp: 'Disabled', hyperV: 'Enabled', aehd: false }).status).toBe('ok');
    expect(hypervisorVerdict({ whp: 'Disabled', hyperV: 'Disabled', aehd: true }).status).toBe('ok');
  });

  test('all accelerators disabled is a warning with the enable command, not an error', () => {
    const verdict = hypervisorVerdict({ whp: 'Disabled', hyperV: 'Disabled', aehd: false });
    expect(verdict.status).toBe('warning');
    expect(verdict.fix.join('\n')).toContain('Enable-WindowsOptionalFeature');
  });

  test('an undeterminable state (no admin rights) is a warning that says so', () => {
    const verdict = hypervisorVerdict({ whp: null, hyperV: null, aehd: false });
    expect(verdict.status).toBe('warning');
    expect(verdict.details).toMatch(/could not determine/i);
  });
});
