import { test, expect } from '@playwright/test';
import { MobilecliDriver } from './driver.js';

const SIMULATOR_DEVICE_ID = 'sim-iphone-15';
const SIMULATOR_DEVICE_NAME = 'iPhone 15';

/**
 * Patch a MobilecliDriver instance so it has a pre-established session and
 * its `listDevices` call returns a controlled list — no real mobilecli binary
 * or WebSocket server needed.
 */
function createDriverWithSimulatorSession(opts?: {
  platform?: 'ios' | 'android';
  deviceType?: 'simulator' | 'real';
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
      disconnect: async () => {},
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

test.describe('MobilecliDriver.installApp()', () => {
  test('throws a clear error when installing a .ipa on an iOS simulator', async () => {
    const driver = createDriverWithSimulatorSession();

    await expect(
      driver.installApp('/path/to/MyApp.ipa'),
    ).rejects.toThrow(
      `Cannot install a .ipa file on iOS simulator "${SIMULATOR_DEVICE_NAME}".`,
    );
  });

  test('error message contains instructions for building a .zip', async () => {
    const driver = createDriverWithSimulatorSession();

    let caughtError: Error | undefined;
    try {
      await driver.installApp('/path/to/MyApp.ipa');
    } catch (err) {
      caughtError = err as Error;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError!.message).toContain('xcodebuild');
    expect(caughtError!.message).toContain('zip -r MyApp.zip MyApp.app');
    expect(caughtError!.message).toContain('installApps config');
  });

  test('does not throw for a .ipa path when the device is a real iOS device (no RPC guard needed)', async () => {
    const driver = createDriverWithSimulatorSession({ deviceType: 'real' });

    // The RPC stub throws if called — but we expect it to be called here
    // (real device allows .ipa). So swap the stub out to a no-op.
    (driver as any).session.rpc.call = async () => ({});

    await expect(driver.installApp('/path/to/MyApp.ipa')).resolves.toBeUndefined();
  });

  test('does not throw for a .zip path on an iOS simulator', async () => {
    const driver = createDriverWithSimulatorSession();

    // .zip path — guard must not fire; RPC will be called.
    (driver as any).session.rpc.call = async () => ({});

    await expect(driver.installApp('/path/to/MyApp.zip')).resolves.toBeUndefined();
  });

  test('does not throw for a .apk path (Android) even on a simulator-type device', async () => {
    const driver = createDriverWithSimulatorSession({
      platform: 'android',
      deviceType: 'simulator',
    });

    (driver as any).session.rpc.call = async () => ({});

    await expect(driver.installApp('/path/to/app.apk')).resolves.toBeUndefined();
  });

  test('is case-insensitive for the .IPA extension', async () => {
    const driver = createDriverWithSimulatorSession();

    await expect(
      driver.installApp('/path/to/MyApp.IPA'),
    ).rejects.toThrow(
      `Cannot install a .ipa file on iOS simulator "${SIMULATOR_DEVICE_NAME}".`,
    );
  });

  test('does not make an RPC call when the guard fires', async () => {
    const driver = createDriverWithSimulatorSession();

    // The injected RPC stub already throws — confirm installApp rejects with
    // OUR error message, not the stub's "should not have been made" message.
    let errorMessage = '';
    try {
      await driver.installApp('/path/to/app.ipa');
    } catch (err) {
      errorMessage = (err as Error).message;
    }

    expect(errorMessage).toContain('Cannot install a .ipa file on iOS simulator');
    expect(errorMessage).not.toContain('RPC call should not have been made');
  });
});
