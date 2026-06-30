import { test, expect } from '@playwright/test';
import type { Device } from '@mobilewright/core';
import type { DeviceInfo } from '@mobilewright/protocol';
import { DeviceManager, DeviceError } from './device-manager.js';

type FakeDevice = Pick<Device, 'close'> & { screen: object };

function fakeDevice(overrides: Partial<FakeDevice> = {}): FakeDevice {
  return { screen: {}, close: async () => {}, ...overrides };
}

interface FakeLauncherOpts {
  devices?: DeviceInfo[]
  device?: FakeDevice | null
}

function makeLauncher({ devices = [], device = null }: FakeLauncherOpts = {}) {
  return {
    devices: async () => devices,
    launch: async () => (device ?? fakeDevice()) as unknown as Device,
  };
}

// ---- listDevices ----

test.describe('DeviceManager.listDevices', () => {
  test('returns combined ios and android devices', async () => {
    const dm = new DeviceManager({
      ios: makeLauncher({ devices: [{ id: 'sim-1', name: 'iPhone 15' }] as DeviceInfo[] }),
      android: makeLauncher({ devices: [{ id: 'emu-1', name: 'Pixel 7' }] as DeviceInfo[] }),
    });
    const devices = await dm.listDevices();
    expect(devices.length).toBe(2);
    expect(devices.some(d => d.id === 'sim-1')).toBe(true);
    expect(devices.some(d => d.id === 'emu-1')).toBe(true);
  });

  test('tags ios devices with platform=ios', async () => {
    const dm = new DeviceManager({
      ios: makeLauncher({ devices: [{ id: 'sim-1', name: 'iPhone 15' }] as DeviceInfo[] }),
      android: makeLauncher({ devices: [] }),
    });
    const devices = await dm.listDevices();
    expect(devices[0].platform).toBe('ios');
  });

  test('tags android devices with platform=android', async () => {
    const dm = new DeviceManager({
      ios: makeLauncher({ devices: [] }),
      android: makeLauncher({ devices: [{ id: 'emu-1', name: 'Pixel 7' }] as DeviceInfo[] }),
    });
    const devices = await dm.listDevices();
    expect(devices[0].platform).toBe('android');
  });

  test('tolerates ios failure, still returns android devices', async () => {
    const dm = new DeviceManager({
      ios: { devices: async () => { throw new Error('ios dead'); }, launch: async () => { throw new Error(); } },
      android: makeLauncher({ devices: [{ id: 'emu-1', name: 'Pixel 7' }] as DeviceInfo[] }),
    });
    const devices = await dm.listDevices();
    expect(devices.length).toBe(1);
    expect(devices[0].id).toBe('emu-1');
  });

  test('tolerates android failure, still returns ios devices', async () => {
    const dm = new DeviceManager({
      ios: makeLauncher({ devices: [{ id: 'sim-1', name: 'iPhone 15' }] as DeviceInfo[] }),
      android: { devices: async () => { throw new Error('android dead'); }, launch: async () => { throw new Error(); } },
    });
    const devices = await dm.listDevices();
    expect(devices.length).toBe(1);
    expect(devices[0].id).toBe('sim-1');
  });

  test('returns empty array when both platforms fail', async () => {
    const dm = new DeviceManager({
      ios: { devices: async () => { throw new Error('dead'); }, launch: async () => { throw new Error(); } },
      android: { devices: async () => { throw new Error('dead'); }, launch: async () => { throw new Error(); } },
    });
    const devices = await dm.listDevices();
    expect(devices).toEqual([]);
  });
});

// ---- select ----

test.describe('DeviceManager.select', () => {
  test('sets device and deviceInfo after connect', async () => {
    const launched = fakeDevice();
    const dm = new DeviceManager({
      ios: { devices: async () => [], launch: async () => launched as unknown as Device },
      android: { devices: async () => [], launch: async () => { throw new Error(); } },
    });
    await dm.select('sim-1', 'ios');
    expect(dm.device).toBe(launched);
    expect(dm.deviceInfo).toEqual({ id: 'sim-1', platform: 'ios' });
  });

  test('throws DeviceError(blocked) when inspect in flight', async () => {
    const dm = new DeviceManager({
      ios: { devices: async () => [], launch: async () => fakeDevice() as unknown as Device },
      android: { devices: async () => [], launch: async () => { throw new Error(); } },
    });
    dm.beginInspect();
    const err = await dm.select('sim-1', 'ios').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeviceError);
    expect((err as DeviceError).code).toBe('blocked');
  });

  test('throws DeviceError(in_progress) when select already running', async () => {
    let resolveLaunch!: (d: Device) => void;
    const dm = new DeviceManager({
      ios: { devices: async () => [], launch: () => new Promise<Device>(r => { resolveLaunch = r; }) },
      android: { devices: async () => [], launch: async () => { throw new Error(); } },
    });
    const first = dm.select('sim-1', 'ios');
    const err = await dm.select('sim-2', 'ios').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeviceError);
    expect((err as DeviceError).code).toBe('in_progress');
    resolveLaunch(fakeDevice() as unknown as Device);
    await first;
  });

  test('wraps launcher errors in DeviceError(connect_failed)', async () => {
    const dm = new DeviceManager({
      ios: { devices: async () => [], launch: async () => { throw new Error('timeout'); } },
      android: { devices: async () => [], launch: async () => { throw new Error(); } },
    });
    const err = await dm.select('sim-1', 'ios').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeviceError);
    expect((err as DeviceError).code).toBe('connect_failed');
  });

  test('closes previous device before connecting new one', async () => {
    let firstClosed = false;
    const first = fakeDevice({ close: async () => { firstClosed = true; } });
    const second = fakeDevice();
    const dm = new DeviceManager({
      ios: {
        devices: async () => [],
        launch: async (opts: { deviceId: string }) =>
          (opts.deviceId === 'sim-2' ? second : first) as unknown as Device,
      },
      android: { devices: async () => [], launch: async () => { throw new Error(); } },
    });
    await dm.select('sim-1', 'ios');
    await dm.select('sim-2', 'ios');
    expect(firstClosed).toBe(true);
    expect(dm.device).toBe(second);
  });
});

// ---- beginInspect / endInspect ----

test.describe('DeviceManager.beginInspect / endInspect', () => {
  test('beginInspect returns true when idle', () => {
    const dm = new DeviceManager({ ios: makeLauncher(), android: makeLauncher() });
    expect(dm.beginInspect()).toBe(true);
  });

  test('beginInspect returns false when already in flight', () => {
    const dm = new DeviceManager({ ios: makeLauncher(), android: makeLauncher() });
    dm.beginInspect();
    expect(dm.beginInspect()).toBe(false);
  });

  test('beginInspect returns true after endInspect', () => {
    const dm = new DeviceManager({ ios: makeLauncher(), android: makeLauncher() });
    dm.beginInspect();
    dm.endInspect();
    expect(dm.beginInspect()).toBe(true);
  });
});

// ---- DeviceError ----

test.describe('DeviceError', () => {
  test('is instanceof Error', () => {
    expect(new DeviceError('msg', 'blocked')).toBeInstanceOf(Error);
  });

  test('has name=DeviceError', () => {
    expect(new DeviceError('msg', 'blocked').name).toBe('DeviceError');
  });

  test('has code property', () => {
    expect(new DeviceError('msg', 'blocked').code).toBe('blocked');
    expect(new DeviceError('msg', 'in_progress').code).toBe('in_progress');
  });
});
