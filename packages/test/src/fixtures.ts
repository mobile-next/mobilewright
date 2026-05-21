import { test as base, type TestInfo } from '@playwright/test';
import { createWriteStream, openSync, readSync, closeSync } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import createDebug from 'debug';
import {
  createDevicePoolClient,
  connectDevice,
  loadConfig,
  toArray,
  type DevicePoolClient,
} from 'mobilewright';
import { expect } from '@mobilewright/core';
import type { Device, Screen } from '@mobilewright/core';

const debug = createDebug('mw:test:fixtures');

const ZIP_MAGIC = Buffer.from([0x50, 0x4B, 0x03, 0x04]);

function assertValidZipFile(path: string): void {
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

async function attachVideo(testInfo: TestInfo, url: string | undefined, localPath: string): Promise<void> {
  if (url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download recording: ${response.status} ${response.statusText}`);
    }
    await pipeline(Readable.fromWeb(response.body!), createWriteStream(localPath));
  }
  await testInfo.attach('video', { path: localPath, contentType: 'video/mp4' });
}

type MobilewrightTestFixtures = {
  screen: Screen;
  bundleId: string | undefined;
  autoAppLaunch: boolean | undefined;
  platform: 'ios' | 'android' | undefined;
  deviceName: RegExp | undefined;
  installApps: string | string[] | undefined;
  viewTree: 'on-failure' | 'off';
  device: Device;
};

let cachedClient: DevicePoolClient | undefined;
function getClient(): DevicePoolClient {
  if (!cachedClient) {
    cachedClient = createDevicePoolClient();
  }
  return cachedClient;
}

export const test = base.extend<MobilewrightTestFixtures>({
  bundleId: [async ({}, use, testInfo) => {
    const config = await loadConfig(process.cwd(), testInfo.config.configFile);
    await use(config.bundleId);
  }, { option: true }],

  autoAppLaunch: [async ({}, use, testInfo) => {
    const config = await loadConfig(process.cwd(), testInfo.config.configFile);
    await use(config.autoAppLaunch);
  }, { option: true }],

  platform: [undefined, { option: true }],
  deviceName: [undefined, { option: true }],
  installApps: [undefined, { option: true }],

  viewTree: [async ({}, use, testInfo) => {
    const config = await loadConfig(process.cwd(), testInfo.config.configFile);
    const value = config.viewTree ?? 'off';
    if (value !== 'on-failure' && value !== 'off') {
      throw new Error(`Invalid viewTree value: "${value}". Must be "on-failure" or "off".`);
    }
    
    await use(value);
  }, { option: true }],

  device: async ({ platform, deviceName, bundleId, autoAppLaunch, installApps }, use, testInfo) => {
    const config = await loadConfig(process.cwd(), testInfo.config.configFile);
    const merged = {
      ...config,
      ...(platform && { platform }),
      ...(deviceName && { deviceName }),
      ...(installApps !== undefined && { installApps }),
    };
    
    if (merged.platform !== 'ios' && merged.platform !== 'android') {
      throw new Error(`Unsupported platform: "${merged.platform}". Must be "ios" or "android".`);
    }

    for (const appPath of toArray(merged.installApps)) {
      assertValidZipFile(appPath);
    }

    const client = getClient();
    debug('allocating device (platform=%s)', merged.platform);
    const handle = await client.allocate({
      platform: merged.platform,
      deviceNamePattern: merged.deviceName?.source,
      deviceId: merged.deviceId,
    });
    debug('allocated device %s', handle.deviceId);

    if (handle.type) {
      testInfo.annotations.push({ type: 'device.type', description: handle.type });
    }

    testInfo.annotations.push({ type: 'device.platform', description: handle.platform });

    if (handle.osVersion) {
      testInfo.annotations.push({ type: 'device.osVersion', description: handle.osVersion });
    }

    if (handle.model) {
      testInfo.annotations.push({ type: 'device.model', description: handle.model });
    }

    if (handle.driver) {
      testInfo.annotations.push({ type: 'device.driver', description: handle.driver });
    }

    testInfo.annotations.push({ type: 'device.id', description: handle.deviceId });

    debug('connecting to device %s', handle.deviceId);
    const device = await connectDevice({
      platform: handle.platform,
      deviceId: handle.deviceId,
      deviceType: handle.type,
      driverConfig: merged.driver,
      url: merged.url,
      timeout: merged.timeout,
    });
    debug('connected to device %s', handle.deviceId);

    try {
      for (const appPath of toArray(merged.installApps)) {
        const installed = await client.isAppInstalled(handle.allocationId, appPath);
        if (!installed) {
          await device.installApp(appPath);
          await client.recordAppInstalled(handle.allocationId, appPath);
        }
      }

      if (bundleId && autoAppLaunch !== false) {
        try {
          await device.terminateApp(bundleId);
        } catch {
          // app may not be running
        }
        await device.launchApp(bundleId);
      }

      await use(device);
    } finally {
      await device.disconnect();
      await client.release(handle.allocationId);
    }
  },

  screen: async ({ device, video, viewTree }, use, testInfo) => {
    const videoMode = typeof video === 'object' ? video.mode : video;
    const shouldRecord = videoMode === 'on' || videoMode === 'retain-on-failure';
    const videoPath = shouldRecord
      ? join(testInfo.outputDir, `video-${testInfo.testId}.mp4`)
      : '';

    if (shouldRecord) {
      try {
        await mkdir(testInfo.outputDir, { recursive: true });
        await device.startRecording({ output: videoPath });
      } catch {
        // recording may not be supported — continue without it
      }
    }

    device.screen.setStepFn((title, fn, location) => (base.step as any)(title, fn, { location }));

    await use(device.screen);

    if (shouldRecord) {
      try {
        const result = await device.stopRecording();
        const failed = testInfo.status !== testInfo.expectedStatus;
        const shouldAttach = videoMode === 'on' || (videoMode === 'retain-on-failure' && failed);

        if (shouldAttach) {
          await attachVideo(testInfo, result.url, result.output ?? videoPath);
        }

        await unlink(videoPath).catch(() => {});
      } catch (err) {
        debug('video attach failed: %o', err);
      }
    }

    if (testInfo.status !== testInfo.expectedStatus) {
      try {
        const screenshot = await device.screen.screenshot();
        await testInfo.attach('screenshot-on-failure', { body: screenshot, contentType: 'image/png' });
      } catch {
        // device may be disconnected
      }
      if (viewTree === 'on-failure') {
        try {
          const tree = await device.screen.viewTree();
          await testInfo.attach('view-tree-on-failure', {
            body: Buffer.from(JSON.stringify(tree, null, 2)),
            contentType: 'application/json',
          });
        } catch {
          // device may be disconnected
        }
      }
    }
  },
});

export { expect };
