import { test, expect } from '@playwright/test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceInfo, DeviceType } from '@mobilewright/protocol';
import { ensureAgentInstalled } from './agent.js';

interface FakeMobilecliOptions {
  agentInstalled: boolean;
  installPutsAgentOnDevice?: boolean;
  deviceExists?: boolean;
  statusCrashes?: boolean;
}

interface FakeMobilecli {
  path: string;
  commandsRun(): string[];
}

// The fake mobilecli is a script with a shebang, which Windows cannot execute.
test.skip(process.platform === 'win32', 'fake mobilecli needs a POSIX shebang');

let tmpDir: string;
let deviceCounter = 0;

test.beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mw-agent-test-'));
});

test.afterAll(() => {
  rmSync(tmpDir, { recursive: true });
});

/**
 * A stand-in for the mobilecli binary that answers `agent status` and
 * `agent install` the way mobilecli 1.0.24 does: a "fail" response with exit
 * code 1 when the agent is missing, and an "error" response with exit code 1
 * when the device cannot be found. With statusCrashes it dies without printing
 * a response, like a panic.
 */
function createFakeMobilecli(options: FakeMobilecliOptions): FakeMobilecli {
  const dir = mkdtempSync(join(tmpDir, 'mobilecli-'));
  const agentMarker = join(dir, 'agent-installed');
  const log = join(dir, 'commands.log');
  const path = join(dir, 'mobilecli');
  if (options.agentInstalled) {
    writeFileSync(agentMarker, '');
  }
  writeFileSync(path, `#!/usr/bin/env node
const fs = require('node:fs');
const [command, subcommand, , deviceId] = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, command + ' ' + subcommand + '\\n');
function reply(response, exitCode) {
  process.stdout.write(JSON.stringify(response, null, 2) + '\\n');
  if (exitCode !== 0) {
    process.stderr.write((response.error ?? response.data.message) + '\\n');
  }
  process.exit(exitCode);
}
if (${JSON.stringify(options.statusCrashes === true)}) {
  process.stderr.write('panic: runtime error\\n');
  process.exit(2);
}
if (${JSON.stringify(options.deviceExists === false)}) {
  reply({ status: 'error', error: 'device not found: ' + deviceId }, 1);
}
if (subcommand === 'status') {
  if (fs.existsSync(${JSON.stringify(agentMarker)})) {
    reply({ status: 'ok', data: { message: 'Agent version 0.0.38 is installed on device' } }, 0);
  }
  reply({ status: 'fail', data: { message: 'Agent is not installed on the device' } }, 1);
}
if (subcommand === 'install') {
  if (${JSON.stringify(options.installPutsAgentOnDevice ?? true)}) {
    fs.writeFileSync(${JSON.stringify(agentMarker)}, '');
  }
  reply({ status: 'ok', data: { message: 'Agent installed successfully' } }, 0);
}
`);
  chmodSync(path, 0o755);
  return {
    path,
    commandsRun: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []),
  };
}

/** A device with an ID no other test uses, since verified agents are cached per device. */
function newDevice(type: DeviceType): DeviceInfo {
  deviceCounter += 1;
  return { id: `device-${deviceCounter}`, name: 'iPhone 16', platform: 'ios', type, state: 'online' };
}

test('installs the agent on a fresh simulator whose agent status exits non-zero', () => {
  const mobilecli = createFakeMobilecli({ agentInstalled: false });

  ensureAgentInstalled(mobilecli.path, newDevice('simulator'));

  expect(mobilecli.commandsRun()).toEqual(['agent status', 'agent install', 'agent status']);
});

test('installs the agent on a fresh emulator whose agent status exits non-zero', () => {
  const mobilecli = createFakeMobilecli({ agentInstalled: false });

  ensureAgentInstalled(mobilecli.path, newDevice('emulator'));

  expect(mobilecli.commandsRun()).toEqual(['agent status', 'agent install', 'agent status']);
});

test('does not reinstall when the agent is already on the simulator', () => {
  const mobilecli = createFakeMobilecli({ agentInstalled: true });

  ensureAgentInstalled(mobilecli.path, newDevice('simulator'));

  expect(mobilecli.commandsRun()).toEqual(['agent status']);
});

test('checks the agent only once per device', () => {
  const mobilecli = createFakeMobilecli({ agentInstalled: true });
  const device = newDevice('simulator');

  ensureAgentInstalled(mobilecli.path, device);
  ensureAgentInstalled(mobilecli.path, device);

  expect(mobilecli.commandsRun()).toEqual(['agent status']);
});

test('tells the user to run mobilewright install on a real device without the agent', () => {
  const mobilecli = createFakeMobilecli({ agentInstalled: false });
  const device = newDevice('real');

  expect(() => ensureAgentInstalled(mobilecli.path, device)).toThrow(
    `agent not installed, run \`npx mobilewright install --device ${device.id}\` to get started`,
  );
  expect(mobilecli.commandsRun()).toEqual(['agent status']);
});

test('reports a failed install when the agent is still missing afterwards', () => {
  const mobilecli = createFakeMobilecli({ agentInstalled: false, installPutsAgentOnDevice: false });
  const device = newDevice('simulator');

  expect(() => ensureAgentInstalled(mobilecli.path, device)).toThrow(
    `agent install failed on simulator ${device.id}: Agent is not installed on the device`,
  );
  expect(mobilecli.commandsRun()).toEqual(['agent status', 'agent install', 'agent status']);
});

test('reports mobilecli errors instead of installing', () => {
  const mobilecli = createFakeMobilecli({ agentInstalled: false, deviceExists: false });
  const device = newDevice('simulator');

  expect(() => ensureAgentInstalled(mobilecli.path, device)).toThrow(
    `mobilecli agent status failed on ${device.id}: device not found: ${device.id}`,
  );
  expect(mobilecli.commandsRun()).toEqual(['agent status']);
});

test('passes on the original error when mobilecli crashes without a response', () => {
  const mobilecli = createFakeMobilecli({ agentInstalled: false, statusCrashes: true });

  expect(() => ensureAgentInstalled(mobilecli.path, newDevice('simulator'))).toThrow('panic: runtime error');
  expect(mobilecli.commandsRun()).toEqual(['agent status']);
});
