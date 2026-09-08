import { test, expect } from '@playwright/test';
import type {
  Geolocation,
  MobilewrightDriver,
  Orientation,
  AppInfo,
  DeviceInfo,
  ScreenSize,
} from '@mobilewright/protocol';
import { Device } from './device.js';

function createMockDriver(screenSize: ScreenSize): MobilewrightDriver {
  return {
    connect: async () => ({ deviceId: 'device1', platform: 'ios' as const }),
    disconnect: async () => {},
    getViewHierarchy: async () => [],
    tap: async () => {},
    doubleTap: async () => {},
    longPress: async () => {},
    typeText: async () => {},
    pressKeys: async () => {},
    clearText: async () => {},
    swipe: async () => {},
    gesture: async () => {},
    pressButton: async () => {},
    screenshot: async () => Buffer.from(''),
    getScreenSize: async () => screenSize,
    getOrientation: async () => 'portrait' as Orientation,
    setOrientation: async () => {},
    setGeolocation: async () => {},
    launchApp: async () => {},
    terminateApp: async () => {},
    listApps: async () => [] as AppInfo[],
    getForegroundApp: async () => ({ bundleId: 'com.test' }),
    installApp: async () => {},
    uninstallApp: async () => {},
    listDevices: async () => [] as DeviceInfo[],
    openUrl: async () => {},
    startRecording: async () => {},
    stopRecording: async () => ({}),
    allocate: async () => ({ deviceId: 'device1', platform: 'ios' as const }),
    release: async () => {},
  };
}

test.describe('Device.screenSize', () => {
  test('returns the width, height, and scale from the driver', async () => {
    const driver = createMockDriver({ width: 390, height: 844, scale: 3 });
    const device = new Device(driver);

    const size = await device.screenSize();

    expect(size).toEqual({ width: 390, height: 844, scale: 3 });
  });
});

test.describe('Device.applyDeviceSettings', () => {
  test('forwards the settings to the driver', async () => {
    const driver = createMockDriver({ width: 390, height: 844, scale: 3 });
    const applied: unknown[] = [];
    driver.applyDeviceSettings = async (settings) => {
      applied.push(settings);
    };
    const device = new Device(driver);

    await device.applyDeviceSettings({ animations: 'off' });

    expect(applied).toEqual([{ animations: 'off' }]);
  });

  test('no-ops when the driver does not support device settings', async () => {
    const driver = createMockDriver({ width: 390, height: 844, scale: 3 });
    expect(driver.applyDeviceSettings).toBeUndefined();
    const device = new Device(driver);

    await expect(device.applyDeviceSettings({ animations: 'off' })).resolves.toBeUndefined();
  });
});

test.describe('Device.id', () => {
  test('returns the deviceId from the connected session', async () => {
    const driver = createMockDriver({ width: 390, height: 844, scale: 3 });
    const device = new Device(driver);

    await device.connect({ platform: 'ios' });

    expect(device.id).toBe('device1');
  });

  test('throws when read before connect()', () => {
    const driver = createMockDriver({ width: 390, height: 844, scale: 3 });
    const device = new Device(driver);

    expect(() => device.id).toThrow(/not connected yet/);
  });
});

test.describe('Device.setGeolocation', () => {
  function createGeolocationRecordingDriver(): { driver: MobilewrightDriver; calls: Array<Geolocation | null> } {
    const driver = createMockDriver({ width: 390, height: 844, scale: 3 });
    const calls: Array<Geolocation | null> = [];
    driver.setGeolocation = async (geolocation) => {
      calls.push(geolocation);
    };
    return { driver, calls };
  }

  test('passes the coordinates to the driver', async () => {
    const { driver, calls } = createGeolocationRecordingDriver();
    const device = new Device(driver);

    await device.setGeolocation({ latitude: -17.833, longitude: 177.947 });

    expect(calls).toEqual([{ latitude: -17.833, longitude: 177.947 }]);
  });

  test('clears the override when called with null', async () => {
    const { driver, calls } = createGeolocationRecordingDriver();
    const device = new Device(driver);

    await device.setGeolocation(null);

    expect(calls).toEqual([null]);
  });

  test('clears the override when called with no arguments', async () => {
    const { driver, calls } = createGeolocationRecordingDriver();
    const device = new Device(driver);

    await device.setGeolocation();

    expect(calls).toEqual([null]);
  });

  test('throws when latitude is out of range', async () => {
    const { driver, calls } = createGeolocationRecordingDriver();
    const device = new Device(driver);

    await expect(device.setGeolocation({ latitude: 90.1, longitude: 0 })).rejects.toThrow(/latitude/);
    await expect(device.setGeolocation({ latitude: -90.1, longitude: 0 })).rejects.toThrow(/latitude/);
    expect(calls).toEqual([]);
  });

  test('throws when longitude is out of range', async () => {
    const { driver, calls } = createGeolocationRecordingDriver();
    const device = new Device(driver);

    await expect(device.setGeolocation({ latitude: 0, longitude: 180.1 })).rejects.toThrow(/longitude/);
    await expect(device.setGeolocation({ latitude: 0, longitude: -180.1 })).rejects.toThrow(/longitude/);
    expect(calls).toEqual([]);
  });
});

test.describe('Device step reporting', () => {
  function createRecordingStepFn(titles: string[]) {
    return (title: string, fn: () => Promise<unknown>) => {
      titles.push(title);
      return fn();
    };
  }

  test('reports app and device actions as test steps', async () => {
    const driver = createMockDriver({ width: 390, height: 844, scale: 3 });
    const device = new Device(driver);
    const titles: string[] = [];
    device.setStepFn(createRecordingStepFn(titles));

    await device.launchApp('com.test');
    await device.terminateApp('com.test');
    await device.installApp('/tmp/app.apk');
    await device.uninstallApp('com.test');
    await device.openUrl('https://example.com');
    await device.setOrientation('landscape');
    await device.setGeolocation({ latitude: -17.833, longitude: 177.947 });

    expect(titles).toEqual([
      'device.launchApp()',
      'device.terminateApp()',
      'device.installApp()',
      'device.uninstallApp()',
      'device.openUrl()',
      'device.setOrientation()',
      'device.setGeolocation()',
    ]);
  });

  test('propagates the step function to the screen', async () => {
    const driver = createMockDriver({ width: 390, height: 844, scale: 3 });
    const device = new Device(driver);
    const titles: string[] = [];
    device.setStepFn(createRecordingStepFn(titles));

    await device.screen.tap(10, 20);

    expect(titles).toEqual(['screen.tap()']);
  });
});
