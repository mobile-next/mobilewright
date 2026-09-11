import { openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import type { PlaywrightWorkerOptions } from '@playwright/test';
import type { AllocatedDevice, Platform } from '@mobilewright/protocol';
import type { MobilewrightConfig } from 'mobilewright';

type VideoOption = PlaywrightWorkerOptions['video'] | undefined;
type ProjectName = string;
type DeviceOptions = {
  platform?: Platform;
  deviceId?: string;
  deviceName?: RegExp;
  deviceType?: 'simulator' | 'emulator' | 'real';
  osVersion?: string;
  installApps?: string | string[];
};
type Annotation = { type: string; description: string };
type VideoPlan = { shouldRecord: boolean; path: string; shouldAttach(failed: boolean): boolean };

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export function assertValidZipFile(path: string): void {
  const buf = Buffer.alloc(4);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buf, { offset: 0, length: 4, position: 0 });
  } finally {
    closeSync(fd);
  }
  if (!buf.equals(ZIP_MAGIC)) {
    throw new Error(`"${path}" is not a valid ZIP file`);
  }
}

/** Fixture options (set via `test.use`) win over config; `use` is merged from the active project. */
export function mergeDeviceConfig(config: MobilewrightConfig, options: DeviceOptions, projectName: ProjectName): MobilewrightConfig {
  const project = config.projects?.find(p => p.name === projectName);
  return {
    ...config,
    ...(options.platform && { platform: options.platform }),
    ...(options.deviceId !== undefined && { deviceId: options.deviceId }),
    ...(options.deviceName && { deviceName: options.deviceName }),
    ...(options.deviceType && { deviceType: options.deviceType }),
    ...(options.osVersion && { osVersion: options.osVersion }),
    ...(options.installApps !== undefined && { installApps: options.installApps }),
    use: { ...config.use, ...project?.use },
  };
}

export function assertSupportedPlatform(platform: string | undefined): Platform {
  if (platform !== 'ios' && platform !== 'android') {
    throw new Error(`Unsupported platform: "${platform}". Must be "ios" or "android".`);
  }
  return platform;
}

export function annotationsForDevice(handle: AllocatedDevice): Annotation[] {
  const optional = (type: string, description: string | undefined): Annotation[] =>
    description ? [{ type, description }] : [];
  return [
    ...optional('device.type', handle.type),
    { type: 'device.platform', description: handle.platform },
    ...optional('device.osVersion', handle.osVersion),
    ...optional('device.model', handle.model),
    ...optional('device.driver', handle.driver),
    { type: 'device.id', description: handle.deviceId },
  ];
}

export function connectOptionsFor(handle: AllocatedDevice, merged: MobilewrightConfig) {
  return {
    platform: handle.platform,
    deviceId: handle.deviceId,
    deviceType: handle.type,
    driver: merged.driver,
    timeout: merged.timeout,
    actionTimeout: merged.use?.actionTimeout,
    expectTimeout: merged.expect?.timeout,
    appLaunchTimeout: merged.use?.appLaunchTimeout,
    installTimeout: merged.use?.installTimeout,
    deviceSettings: { animations: merged.use?.animations },
  };
}

export function videoPlan(video: VideoOption, outputDir: string, testId: string): VideoPlan {
  const mode = typeof video === 'object' ? video.mode : video;
  const shouldRecord = mode === 'on' || mode === 'retain-on-failure';
  return {
    shouldRecord,
    path: shouldRecord ? join(outputDir, `video-${testId}.mp4`) : '',
    shouldAttach: (failed) => mode === 'on' || (mode === 'retain-on-failure' && failed),
  };
}

export function parseViewTreeOption(value: string | undefined): 'on-failure' | 'off' {
  const resolved = value ?? 'off';
  if (resolved !== 'on-failure' && resolved !== 'off') {
    throw new Error(`Invalid viewTree value: "${resolved}". Must be "on-failure" or "off".`);
  }
  return resolved;
}
