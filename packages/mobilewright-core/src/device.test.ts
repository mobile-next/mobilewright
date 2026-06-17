import { test, expect } from '@playwright/test';
import type {
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
