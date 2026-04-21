import type { Platform, DeviceInfo, MobilewrightDriver } from '@mobilewright/protocol';
import { Device } from '@mobilewright/core';
import { MobilecliDriver, DEFAULT_URL } from '@mobilewright/driver-mobilecli';
import { MobileUseDriver } from '@mobilewright/driver-mobile-use';
import { ensureMobilecliReachable } from './server.js';
import type { DriverConfig, DriverConfigMobileUse } from './config.js';

export interface LaunchOptions {
  bundleId?: string;
  deviceId?: string;
  deviceName?: RegExp;
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
      apiKey: config.apiKey,
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
        const device = new Device(driver);
        await device.connect({ url, platform, deviceId: opts.deviceId, deviceName: opts.deviceName, timeout: opts.timeout });

        if (serverProcess) {
          device.onClose(() => serverProcess.kill());
        }

        if (opts.bundleId) {
          await device.launchApp(opts.bundleId);
        }

        return device;
      }

      // mobile-use driver path — don't pass mobilecli's default URL;
      // the driver has its own default (wss://api.mobilenexthq.com/ws).
      const driver = createDriver(driverConfig);
      const device = new Device(driver);
      await device.connect({ ...(opts.url && { url: opts.url }), platform, deviceName: opts.deviceName, timeout: opts.timeout });

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

/** iOS platform launcher */
export const ios = createLauncher('ios');

/** Android platform launcher */
export const android = createLauncher('android');
