import type { DeviceInfo } from '@mobilewright/protocol';
import { Device } from '@mobilewright/core';
import { MobilecliDriver } from '@mobilewright/driver-mobilecli';
import { loadSession, saveSession, type SessionState } from './session.js';

export interface Connected {
  device: Device;
  driver: MobilecliDriver;
  session: SessionState;
  close: () => Promise<void>;
}

export async function listDevices(): Promise<DeviceInfo[]> {
  return new MobilecliDriver().listDevices();
}

function pickDevice(devices: DeviceInfo[], wanted: string | undefined): DeviceInfo {
  if (wanted) {
    const found = devices.find((d) => d.id === wanted);
    if (!found) {
      throw new Error(`device "${wanted}" not found, run "mobilewright-cli devices"`);
    }
    return found;
  }
  const online = devices.filter((d) => d.state === 'online');
  if (online.length === 0) {
    throw new Error('no online devices found, run "mobilewright doctor"');
  }
  if (online.length > 1) {
    throw new Error(`multiple devices online, pick one with --device <id>:\n${online.map((d) => `  ${d.id}  ${d.name}`).join('\n')}`);
  }
  return online[0];
}

/**
 * Connect to the device for this session. The chosen device is remembered in the
 * session file so later commands need no --device flag.
 */
export async function connect(sessionName: string, explicitDevice: string | undefined): Promise<Connected> {
  const session = loadSession(sessionName);
  const wanted = explicitDevice ?? process.env['MOBILEWRIGHT_DEVICE'] ?? session.deviceId;
  const driver = new MobilecliDriver();

  let deviceId = wanted;
  let platform = session.platform;
  let deviceType = session.deviceType;
  const needsLookup = !deviceId || wanted !== session.deviceId || !platform || !deviceType;
  if (needsLookup) {
    const picked = pickDevice(await driver.listDevices(), wanted);
    deviceId = picked.id;
    platform = picked.platform;
    deviceType = picked.type;
  }

  const device = new Device(driver);
  // ponytail: every command connects and (if it started the server) tears it down
  // again; a long-lived daemon is the upgrade path once per-command latency hurts.
  await device.connect({ platform: platform!, deviceId, deviceType });
  const state: SessionState = {
    ...session,
    deviceId,
    platform,
    deviceType,
    // refs describe a screen on the previous device; never tap them on another one
    refs: deviceId === session.deviceId ? session.refs : {},
  };
  try {
    saveSession(sessionName, state);
  } catch (err) {
    await device.close().catch(() => {});
    throw err;
  }

  return {
    device,
    driver,
    session: state,
    close: () => device.close(),
  };
}
