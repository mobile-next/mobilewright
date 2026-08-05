import type { Platform, DeviceInfo, DeviceType, DeviceSettings, MobilewrightDriver } from '@mobilewright/protocol';
import { Device } from '@mobilewright/core';
import { MobilecliDriver, DEFAULT_URL } from '@mobilewright/driver-mobilecli';
import { toArray } from './config.js';

export interface LaunchOptions {
  bundleId?: string;
  installApps?: string | string[];
  autoAppLaunch?: boolean;
  deviceId?: string;
  deviceName?: RegExp;
  /** mobilecli server URL. Ignored when `driver` is set — construct the driver with its own url instead. */
  url?: string;
  timeout?: number;
  /** Auto-start the mobilecli server if not running. Ignored when `driver` is set. Default: true. */
  autoStart?: boolean;
  driver?: MobilewrightDriver;
  actionTimeout?: number;
  expectTimeout?: number;
  appLaunchTimeout?: number;
  installTimeout?: number;
  animations?: 'on' | 'off';
}

interface PlatformLauncher {
  launch(opts?: LaunchOptions): Promise<Device>;
  devices(): Promise<DeviceInfo[]>;
}

export interface ConnectDeviceParams {
  platform: Platform;
  deviceId: string;
  deviceType?: DeviceType;
  driver?: MobilewrightDriver;
  url?: string;
  timeout?: number;
  actionTimeout?: number;
  expectTimeout?: number;
  appLaunchTimeout?: number;
  installTimeout?: number;
  deviceSettings?: DeviceSettings;
}

export interface FindDeviceParams {
  platform: Platform;
  deviceId?: string;
  deviceName?: RegExp;
  driver?: MobilewrightDriver;
  url?: string;
}

export async function connectDevice(params: ConnectDeviceParams): Promise<Device> {
  const driver = params.driver ?? new MobilecliDriver({ url: params.url });
  const device = new Device(driver, {
    locatorDefaults: {
      ...(params.actionTimeout !== undefined && { timeout: params.actionTimeout }),
      ...(params.expectTimeout !== undefined && { expectTimeout: params.expectTimeout }),
    },
    appLaunchTimeout: params.appLaunchTimeout,
    installTimeout: params.installTimeout,
  });
  await device.connect({
    platform: params.platform,
    deviceId: params.deviceId,
    deviceType: params.deviceType,
    timeout: params.timeout,
  });

  const settings = params.deviceSettings;
  if (settings && Object.values(settings).some((value) => value !== undefined)) {
    await device.applyDeviceSettings(settings);
  }

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
  const driver = params.driver ?? new MobilecliDriver({ url: params.url ?? DEFAULT_URL });
  const devices = await driver.listDevices({ platform: params.platform });

  const match = devices
    .filter((d) => d.state === 'online')
    .filter((d) => !params.deviceId || d.id === params.deviceId)
    .filter((d) => !params.deviceName || params.deviceName.test(d.name))
    .at(0);

  if (!match) {
    throw new Error(`no online ${params.platform} device found`);
  }
  return match;
}

function createLauncher(platform: Platform): PlatformLauncher {
  return {
    async launch(opts: LaunchOptions = {}): Promise<Device> {
      // One driver instance shared across find + connect: mobilecli's own
      // connect() handles server auto-start/reachability internally, and
      // owns killing any server it started when the device disconnects.
      const driver = opts.driver ?? new MobilecliDriver({ url: opts.url, autoStart: opts.autoStart });

      const found = await findDevice({
        platform,
        deviceId: opts.deviceId,
        deviceName: opts.deviceName,
        driver,
      });

      const device = await connectDevice({
        platform,
        deviceId: found.id,
        driver,
        timeout: opts.timeout,
        actionTimeout: opts.actionTimeout,
        expectTimeout: opts.expectTimeout,
        appLaunchTimeout: opts.appLaunchTimeout,
        installTimeout: opts.installTimeout,
        deviceSettings: { animations: opts.animations },
      });

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
