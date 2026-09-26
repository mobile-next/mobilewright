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

  test('waits for an in-flight inspect to finish, then connects', async () => {
    // Codegen refreshes back to back, so an inspect is almost always running when the user switches.
    const launched = fakeDevice();
    let launchCalls = 0;
    const dm = new DeviceManager({
      ios: { devices: async () => [], launch: async () => { launchCalls++; return launched as unknown as Device; } },
      android: { devices: async () => [], launch: async () => { throw new Error(); } },
    });
    dm.beginInspect();
    const selecting = dm.select('sim-1', 'ios');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(launchCalls).toBe(0);

    dm.endInspect();
    await selecting;

    expect(dm.device).toBe(launched);
  });

  test('blocks new inspects while waiting to switch devices', async () => {
    const dm = new DeviceManager({
      ios: { devices: async () => [], launch: async () => fakeDevice() as unknown as Device },
      android: { devices: async () => [], launch: async () => { throw new Error(); } },
    });
    dm.beginInspect();
    const selecting = dm.select('sim-1', 'ios');
    dm.endInspect();
    expect(dm.beginInspect()).toBe(false);
    await selecting;
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
    expect(new DeviceError('msg', 'not_found')).toBeInstanceOf(Error);
  });

  test('has name=DeviceError', () => {
    expect(new DeviceError('msg', 'not_found').name).toBe('DeviceError');
  });

  test('has code property', () => {
    expect(new DeviceError('msg', 'not_found').code).toBe('not_found');
    expect(new DeviceError('msg', 'in_progress').code).toBe('in_progress');
  });
});

// ---- screenSize ----

function deviceReportingScreenSize(onCall: () => void, size = { width: 390, height: 844, scale: 3 }): Device {
  return { ...fakeDevice(), screenSize: async () => { onCall(); return size; } } as unknown as Device;
}

test.describe('DeviceManager.screenSize', () => {
  test('asks the device for its screen size once per connection', async () => {
    let calls = 0;
    const dm = new DeviceManager({
      ios: { devices: async () => [], launch: async () => deviceReportingScreenSize(() => calls++) },
      android: makeLauncher(),
    });
    await dm.select('sim-1', 'ios');

    await dm.screenSize();
    const size = await dm.screenSize();

    expect(calls).toBe(1);
    expect(size).toEqual({ width: 390, height: 844, scale: 3 });
  });

  test('asks again after switching to another device', async () => {
    let calls = 0;
    const dm = new DeviceManager({
      ios: { devices: async () => [], launch: async () => deviceReportingScreenSize(() => calls++) },
      android: makeLauncher(),
    });
    await dm.select('sim-1', 'ios');
    await dm.screenSize();

    await dm.select('sim-2', 'ios');
    await dm.screenSize();

    expect(calls).toBe(2);
  });

  test('retries on the next call when asking failed', async () => {
    let calls = 0;
    const flaky = { ...fakeDevice(), screenSize: async () => {
      calls++;
      if (calls === 1) {
        throw new Error('device busy');
      }
      return { width: 1, height: 2, scale: 1 };
    } } as unknown as Device;
    const dm = new DeviceManager({ ios: { devices: async () => [], launch: async () => flaky }, android: makeLauncher() });
    await dm.select('sim-1', 'ios');

    await expect(dm.screenSize()).rejects.toThrow('device busy');
    await expect(dm.screenSize()).resolves.toEqual({ width: 1, height: 2, scale: 1 });
  });

  test('rejects when no device is selected', async () => {
    const dm = new DeviceManager({ ios: makeLauncher(), android: makeLauncher() });
    await expect(dm.screenSize()).rejects.toThrow('No device selected');
  });
});

test.describe('DeviceManager.screenSize — hung device', () => {
  test('gives up on a screen size call that never answers, and asks again next time', async () => {
    let calls = 0;
    const hangsFirstTime = { ...fakeDevice(), screenSize: () => {
      calls++;
      if (calls === 1) {
        return new Promise(() => {});
      }
      return Promise.resolve({ width: 390, height: 844, scale: 3 });
    } } as unknown as Device;
    const dm = new DeviceManager({
      ios: { devices: async () => [], launch: async () => hangsFirstTime },
      android: makeLauncher(),
      screenSizeTimeoutMs: 10,
    });
    await dm.select('sim-1', 'ios');

    await expect(dm.screenSize()).rejects.toThrow('timed out');
    await expect(dm.screenSize()).resolves.toEqual({ width: 390, height: 844, scale: 3 });
  });
});

// ---- withDevice ----

test.describe('DeviceManager.withDevice', () => {
  test('runs the operation on the active device', async () => {
    const launched = fakeDevice();
    const dm = new DeviceManager({ ios: makeLauncher({ device: launched }), android: makeLauncher() });
    await dm.select('sim-1', 'ios');

    const used = await dm.withDevice(async device => device);

    expect(used).toBe(launched);
  });

  test('rejects with not_found when no device is selected', async () => {
    const dm = new DeviceManager({ ios: makeLauncher(), android: makeLauncher() });
    const err = await dm.withDevice(async () => {}).catch((e: unknown) => e);
    expect((err as DeviceError).code).toBe('not_found');
  });

  test('switching devices waits for a running operation before closing the device', async () => {
    const events: string[] = [];
    const dm = new DeviceManager({
      ios: makeLauncher({ device: fakeDevice({ close: async () => { events.push('closed'); } }) }),
      android: makeLauncher(),
    });
    await dm.select('sim-1', 'ios');
    let finishTap!: () => void;
    const tapping = dm.withDevice(() => new Promise<void>(resolve => {
      finishTap = () => { events.push('tap finished'); resolve(); };
    }));

    const switching = dm.select('sim-2', 'ios');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(events).toEqual([]);

    finishTap();
    await tapping;
    await switching;
    expect(events).toEqual(['tap finished', 'closed']);
  });

  test('rejects with in_progress while switching devices', async () => {
    let finishLaunch!: () => void;
    let launches = 0;
    const dm = new DeviceManager({
      ios: { devices: async () => [], launch: async () => {
        launches++;
        if (launches > 1) {
          await new Promise<void>(resolve => { finishLaunch = resolve; });
        }
        return fakeDevice() as unknown as Device;
      } },
      android: makeLauncher(),
    });
    await dm.select('sim-1', 'ios');
    const switching = dm.select('sim-2', 'ios');

    const err = await dm.withDevice(async () => {}).catch((e: unknown) => e);

    expect((err as DeviceError).code).toBe('in_progress');
    await new Promise(resolve => setTimeout(resolve, 0));
    finishLaunch();
    await switching;
  });
});
