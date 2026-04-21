import type { Platform, DeviceInfo, MobilewrightDriver } from '@mobilewright/protocol';
import { Device } from '@mobilewright/core';
import { MobilecliDriver, DEFAULT_URL } from '@mobilewright/driver-mobilecli';
import { MobileUseDriver } from '@mobilewright/driver-mobile-use';
import { ensureMobilecliReachable } from './server.js';
import { MobilewrightError } from './errors.js';
import type { DriverConfig, DriverConfigMobileUse } from './config.js';

export interface LaunchOptions {
  bundleId?: string;
  deviceName?: RegExp;
  deviceId?: string;
  url?: string;
  timeout?: number;
  autoStart?: boolean;
  driver?: DriverConfig;
}

interface PlatformLauncher {
  launch(opts?: LaunchOptions): Promise<Device>;
  devices(): DeviceInfo[];
}

function createDriver(driverConfig?: DriverConfig, url?: string): MobilewrightDriver {
  const type = driverConfig?.type ?? 'mobilecli';
  if (type === 'mobile-use') {
    const config = driverConfig as DriverConfigMobileUse;
    return new MobileUseDriver({
      region: config.region,
      username: config.username,
      password: config.password,
    });
  }
  return new MobilecliDriver({ url });
}

function createLauncher(platform: Platform): PlatformLauncher {
  return {
    async launch(opts: LaunchOptions = {}): Promise<Device> {
      const driverConfig = opts.driver;
      const url = opts.url ?? DEFAULT_URL;

      if (!driverConfig || driverConfig.type === 'mobilecli') {
        const { serverProcess } = await ensureMobilecliReachable(url, {
          autoStart: opts.autoStart ?? true,
        });

        const driver = createDriver(driverConfig, url);
        const deviceId = opts.deviceId ?? resolveDeviceId(driver as MobilecliDriver, platform, opts.deviceName);

        const device = new Device(driver);
        await device.connect({ url, deviceId, platform, timeout: opts.timeout });

        if (serverProcess) {
          device.onClose(() => serverProcess.kill());
        }

        if (opts.bundleId) {
          await device.launchApp(opts.bundleId);
        }

        return device;
      }

      // mobile-use driver path
      const driver = createDriver(driverConfig);
      const deviceId = opts.deviceId ?? '';

      const device = new Device(driver);
      await device.connect({ url, deviceId, platform, timeout: opts.timeout });

      if (opts.bundleId) {
        await device.launchApp(opts.bundleId);
      }

      return device;
    },

    devices(): DeviceInfo[] {
      const driver = new MobilecliDriver();
      return driver.listDevices({ platform });
    },
  };
}

function resolveDeviceId(
  driver: MobilecliDriver,
  platform: Platform,
  deviceName?: RegExp,
): string {
  const allDevices = driver.listDevices();

  const online = allDevices.filter(
    (d) => d.platform === platform && d.state === 'online',
  );

  let candidates = online.filter(
    (d) => d.type === 'simulator' || d.type === 'emulator',
  );
  if (candidates.length === 0) {
    candidates = online;
  }

  if (deviceName) {
    candidates = candidates.filter((d) => deviceName.test(d.name));
    if (candidates.length === 0) {
      const available = online.map((d) => d.name).join(', ');
      throw new MobilewrightError(
        `No online ${platform} device matching ${deviceName} found.\n` +
          (available ? `Available: ${available}` : `No online ${platform} devices found.`),
      );
    }
  }

  if (candidates.length === 0) {
    throw new MobilewrightError(
      `No online ${platform} devices found.\n\n` +
        (platform === 'ios'
          ? `Start a simulator in Xcode, or boot one with:\n  xcrun simctl boot "<simulator name>"`
          : `Start an emulator in Android Studio, or boot one with:\n  emulator -avd <avd_name>`),
    );
  }

  return candidates[0].id;
}

/** iOS platform launcher */
export const ios = createLauncher('ios');

/** Android platform launcher */
export const android = createLauncher('android');
