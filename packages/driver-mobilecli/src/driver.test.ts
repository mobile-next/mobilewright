import { test, expect } from '@playwright/test';
import { MobilecliDriver } from './driver.js';

const SIMULATOR_DEVICE_ID = 'sim-iphone-15';
const SIMULATOR_DEVICE_NAME = 'iPhone 15';

/**
 * Patch a MobilecliDriver instance so it has a pre-established session and
 * its `listDevices` call returns a controlled list — no real mobilecli binary
 * or WebSocket server needed.
 */
function createDriverWithSession(opts?: {
  platform?: 'ios' | 'android';
  deviceType?: 'simulator' | 'real' | 'emulator';
}): MobilecliDriver {
  const platform = opts?.platform ?? 'ios';
  const deviceType = opts?.deviceType ?? 'simulator';

  const driver = new MobilecliDriver();

  // Inject a fake active session directly into the private field.
  (driver as any).session = {
    deviceId: SIMULATOR_DEVICE_ID,
    platform,
    rpc: {
      call: async () => {
        throw new Error('RPC call should not have been made');
      },
      disconnect: async () => { },
    },
  };

  // Stub listDevices to return the simulated device list.
  driver.listDevices = async () => [
    {
      id: SIMULATOR_DEVICE_ID,
      name: SIMULATOR_DEVICE_NAME,
      platform,
      type: deviceType,
      state: 'online',
    },
  ];

  return driver;
}

function allowRpc(driver: MobilecliDriver): void {
  (driver as any).session.rpc.call = async () => ({});
}

test.describe('MobilecliDriver.installApp()', () => {
  test.describe('iOS simulator', () => {
    test('accepts a .zip file', async () => {
      const driver = createDriverWithSession({ platform: 'ios', deviceType: 'simulator' });
      allowRpc(driver);
      await expect(driver.installApp('/path/to/MyApp.zip')).resolves.toBeUndefined();
    });

    test('rejects a .ipa file with instructions for building a .zip', async () => {
      const driver = createDriverWithSession({ platform: 'ios', deviceType: 'simulator' });
      let error: Error | undefined;
      try {
        await driver.installApp('/path/to/MyApp.ipa');
      } catch (e) {
        error = e as Error;
      }
      expect(error).toBeDefined();
      expect(error!.message).toContain(`iOS simulator "${SIMULATOR_DEVICE_NAME}" requires a .zip`);
      expect(error!.message).toContain('xcodebuild');
      expect(error!.message).toContain('zip -r MyApp.zip MyApp.app');
      expect(error!.message).toContain('installApps config');
    });

    test('rejects a .apk file', async () => {
      const driver = createDriverWithSession({ platform: 'ios', deviceType: 'simulator' });
      await expect(driver.installApp('/path/to/app.apk')).rejects.toThrow(
        `iOS simulator "${SIMULATOR_DEVICE_NAME}" requires a .zip`,
      );
    });

    test('is case-insensitive for extension check', async () => {
      const driver = createDriverWithSession({ platform: 'ios', deviceType: 'simulator' });
      await expect(driver.installApp('/path/to/MyApp.IPA')).rejects.toThrow(
        `iOS simulator "${SIMULATOR_DEVICE_NAME}" requires a .zip`,
      );
    });

    test('does not make an RPC call when rejected', async () => {
      const driver = createDriverWithSession({ platform: 'ios', deviceType: 'simulator' });
      let error: Error | undefined;
      try {
        await driver.installApp('/path/to/app.ipa');
      } catch (e) {
        error = e as Error;
      }
      expect(error).toBeDefined();
      expect(error!.message).not.toContain('RPC call should not have been made');
    });
  });

  test.describe('iOS real device', () => {
    test('accepts a .ipa file', async () => {
      const driver = createDriverWithSession({ platform: 'ios', deviceType: 'real' });
      allowRpc(driver);
      await expect(driver.installApp('/path/to/MyApp.ipa')).resolves.toBeUndefined();
    });

    test('rejects a .zip file', async () => {
      const driver = createDriverWithSession({ platform: 'ios', deviceType: 'real' });
      await expect(driver.installApp('/path/to/MyApp.zip')).rejects.toThrow(
        'iOS real device requires a .ipa file',
      );
    });

    test('rejects a .apk file', async () => {
      const driver = createDriverWithSession({ platform: 'ios', deviceType: 'real' });
      await expect(driver.installApp('/path/to/app.apk')).rejects.toThrow(
        'iOS real device requires a .ipa file',
      );
    });

    test('is case-insensitive for extension check', async () => {
      const driver = createDriverWithSession({ platform: 'ios', deviceType: 'real' });
      allowRpc(driver);
      await expect(driver.installApp('/path/to/MyApp.IPA')).resolves.toBeUndefined();
    });
  });

  test.describe('Android', () => {
    test('accepts a .apk file', async () => {
      const driver = createDriverWithSession({ platform: 'android', deviceType: 'emulator' });
      allowRpc(driver);
      await expect(driver.installApp('/path/to/app.apk')).resolves.toBeUndefined();
    });

    test('rejects a .ipa file', async () => {
      const driver = createDriverWithSession({ platform: 'android', deviceType: 'emulator' });
      await expect(driver.installApp('/path/to/MyApp.ipa')).rejects.toThrow(
        'Android requires a .apk file',
      );
    });

    test('rejects a .zip file', async () => {
      const driver = createDriverWithSession({ platform: 'android', deviceType: 'emulator' });
      await expect(driver.installApp('/path/to/app.zip')).rejects.toThrow(
        'Android requires a .apk file',
      );
    });

    test('is case-insensitive for extension check', async () => {
      const driver = createDriverWithSession({ platform: 'android', deviceType: 'emulator' });
      allowRpc(driver);
      await expect(driver.installApp('/path/to/app.APK')).resolves.toBeUndefined();
    });
  });
});
