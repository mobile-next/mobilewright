import type { Platform, DeviceInfo, MobilewrightDriver } from '@mobilewright/protocol';
import { Device } from '@mobilewright/core';
import { MobilecliDriver, DEFAULT_URL } from '@mobilewright/driver-mobilecli';
import { MobileUseDriver } from '@mobilewright/driver-mobile-use';
import { ensureMobilecliReachable } from './server.js';
import type { DriverConfig } from './config.js';

export interface LaunchOptions {
  bundleId?: string;
  installApps?: string | string[];
  autoAppLaunch?: boolean;
  deviceId?: string;
  deviceName?: RegExp;
  url?: string;
  timeout?: number;
  autoStart?: boolean;
  driver?: DriverConfig;
}

interface PlatformLauncher {
  launch(opts?: LaunchOptions): Promise<Device>;
  devices(): Promise<DeviceInfo[]>;
}

function createDriver(driverConfig?: DriverConfig, url?: string): MobilewrightDriver {
  if (driverConfig?.type === 'mobile-use') {
    return new MobileUseDriver({
      region: driverConfig.region,
      apiKey: driverConfig.apiKey,
    });
  }
  return new MobilecliDriver({ url });
}

function createLauncher(platform: Platform): PlatformLauncher {
  return {
    async launch(opts: LaunchOptions = {}): Promise<Device> {
      const driverConfig = opts.driver;
      const url = opts.url ?? DEFAULT_URL;

      const appsToInstall = opts.installApps
        ? (Array.isArray(opts.installApps) ? opts.installApps : [opts.installApps])
        : [];

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

        for (const appPath of appsToInstall) {
          await device.installApp(appPath);
        }

        if (opts.bundleId && opts.autoAppLaunch !== false) {
          await device.launchApp(opts.bundleId);
        }

        return device;
      }

      // mobile-use driver path — don't pass mobilecli's default URL;
      // the driver has its own default (wss://api.mobilenexthq.com/ws).
      const driver = createDriver(driverConfig);
      const device = new Device(driver);
      await device.connect({ ...(opts.url && { url: opts.url }), platform, deviceName: opts.deviceName, timeout: opts.timeout });

      for (const appPath of appsToInstall) {
        await device.installApp(appPath);
      }

      if (opts.bundleId && opts.autoAppLaunch !== false) {
        await device.launchApp(opts.bundleId);
      }

      return device;
    },

    async devices(): Promise<DeviceInfo[]> {
      const driver = new MobilecliDriver();
      return driver.listDevices({ platform });
    },
  };
}

/** iOS platform launcher */
export const ios = createLauncher('ios');

/** Android platform launcher */
export const android = createLauncher('android');
