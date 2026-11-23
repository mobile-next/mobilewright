import createDebug from 'debug';
import { execFileSync } from 'node:child_process';
import type { DeviceInfo } from '@mobilewright/protocol';

const debug = createDebug('mw:driver-mobilecli');

/**
 * Device IDs whose agent has already been verified in this process. connect()
 * runs once per test, but the agent doesn't come and go during a run, so the
 * `mobilecli agent status` subprocess only needs to be spawned once per device.
 */
const agentVerified = new Set<string>();

interface MobilecliAgentStatusResponse {
  status: string;
  error?: string;
  data?: {
    message?: string;
    agent?: { version: string; bundleId: string };
  };
}

/**
 * Make sure the mobilecli agent is on the device, installing it on simulators
 * and emulators when it is missing.
 */
export function ensureAgentInstalled(binary: string, device: DeviceInfo): void {
  if (agentVerified.has(device.id)) {
    debug('agent already verified on %s, skipping status check', device.id);
    return;
  }
  const statusResponse = readAgentStatus(binary, device.id);
  if (statusResponse.status === 'ok') {
    agentVerified.add(device.id);
    return;
  }
  if (device.type === 'simulator' || device.type === 'emulator') {
    debug('agent not installed on %s %s, installing automatically', device.type, device.id);
    debug('running: %s agent install --device %s --verbose', binary, device.id);
    const installOutput = execFileSync(binary, ['agent', 'install', '--device', device.id, '--verbose'], { encoding: 'utf8' });
    debug('agent install output: %s', installOutput.trim());
    const verifyResponse = readAgentStatus(binary, device.id);
    if (verifyResponse.status !== 'ok') {
      throw new Error(`agent install failed on ${device.type} ${device.id}: ${verifyResponse.data?.message ?? 'unknown error'}`);
    }
    agentVerified.add(device.id);
    return;
  }
  throw new Error(`agent not installed, run \`npx mobilewright install --device ${device.id}\` to get started`);
}

/**
 * Run `mobilecli agent status`. mobilecli exits non-zero when the agent is not
 * installed ("fail") but still prints the response, so a non-zero exit with a
 * readable response is an answer, not a crash. An "error" response means
 * mobilecli could not check at all, and is thrown.
 */
function readAgentStatus(binary: string, deviceId: string): MobilecliAgentStatusResponse {
  debug('running: %s agent status --device %s', binary, deviceId);
  let response: MobilecliAgentStatusResponse;
  try {
    // stderr is piped so mobilecli's "not installed" line doesn't reach the user before the auto-install.
    const output = execFileSync(binary, ['agent', 'status', '--device', deviceId], { encoding: 'utf8', stdio: 'pipe' });
    debug('agent status output: %s', output.trim());
    response = JSON.parse(output) as MobilecliAgentStatusResponse;
  } catch (err) {
    const parsed = parseResponseFromFailedRun(err);
    if (!parsed) {
      throw err;
    }
    response = parsed;
  }
  if (response.status === 'error') {
    throw new Error(`mobilecli agent status failed on ${deviceId}: ${response.error ?? 'unknown error'}`);
  }
  return response;
}

function parseResponseFromFailedRun(err: unknown): MobilecliAgentStatusResponse | undefined {
  const stdout = (err as { stdout?: unknown }).stdout;
  if (typeof stdout !== 'string' || stdout.trim() === '') {
    return undefined;
  }
  debug('agent status exited non-zero, output: %s', stdout.trim());
  try {
    return JSON.parse(stdout) as MobilecliAgentStatusResponse;
  } catch {
    return undefined;
  }
}
