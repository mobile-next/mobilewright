import type { Platform, DeviceInfo, MobilewrightDriver } from '@mobilewright/protocol';
import { Device } from '@mobilewright/core';
import { MobilecliDriver, DEFAULT_URL } from '@mobilewright/driver-mobilecli';
import { MobileUseDriver } from '@mobilewright/driver-mobile-use';
import { ensureMobilecliReachable } from './server.js';
import { toArray } from './config.js';
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

export interface ConnectDeviceParams {
  platform: Platform;
  deviceId: string;
  driverConfig?: DriverConfig;
  url?: string;
  timeout?: number;
}

export interface FindDeviceParams {
  platform: Platform;
  deviceId?: string;
  deviceName?: RegExp;
  driverConfig?: DriverConfig;
  url?: string;
}

export function createDriver(driverConfig?: DriverConfig, url?: string): MobilewrightDriver {
  if (driverConfig?.type === 'mobile-use') {
    return new MobileUseDriver({
      region: driverConfig.region,
      apiKey: driverConfig.apiKey,
    });
  }
  return new MobilecliDriver({ url });
}

export async function connectDevice(params: ConnectDeviceParams): Promise<Device> {
  // URL is baked into the driver at construction time; don't override it here.
  // Passing mobilecli's default URL into MobileUseDriver.connect() would send
  // requests to the wrong server.
  const driver = createDriver(params.driverConfig, params.url);
  const device = new Device(driver);
  await device.connect({
    platform: params.platform,
    deviceId: params.deviceId,
    timeout: params.timeout,
  });
  return device;
}

export async function installAndLaunchApps(device: Device, opts: LaunchOptions): Promise<void> {
  const appsToInstall = toArray(opts.installApps);
  for (const appPath of appsToInstall) {
    await device.installApp(appPath);
  }
  if (opts.bundleId && opts.autoAppLaunch !== false) {
    await device.launchApp(opts.bundleId);
  }
}

export async function findDevice(params: FindDeviceParams): Promise<DeviceInfo> {
  const url = params.url ?? DEFAULT_URL;
  const driver = createDriver(params.driverConfig, url);
  const devices = await driver.listDevices({ platform: params.platform });

  for (const device of devices) {
    if (device.state !== 'online') {
      continue;
    }
    if (params.deviceId && device.id !== params.deviceId) {
      continue;
    }
    if (params.deviceName && !params.deviceName.test(device.name)) {
      continue;
    }
    return device;
  }
  throw new Error(`no online ${params.platform} device found`);
}

function createLauncher(platform: Platform): PlatformLauncher {
  return {
    async launch(opts: LaunchOptions = {}): Promise<Device> {
      const driverConfig = opts.driver;
      const url = opts.url ?? DEFAULT_URL;

      let serverProcess: { kill: () => void } | undefined;
      if (!driverConfig || driverConfig.type === 'mobilecli') {
        const ensured = await ensureMobilecliReachable(url, { autoStart: opts.autoStart ?? true });
        serverProcess = ensured.serverProcess ?? undefined;
      }

      const found = await findDevice({
        platform,
        deviceId: opts.deviceId,
        deviceName: opts.deviceName,
        driverConfig,
        url,
      });

      const device = await connectDevice({
        platform,
        deviceId: found.id,
        driverConfig,
        url,
        timeout: opts.timeout,
      });

      if (serverProcess) {
        const proc = serverProcess;
        device.onClose(() => Promise.resolve(proc.kill()).then(() => undefined));
      }

      await installAndLaunchApps(device, opts);
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
