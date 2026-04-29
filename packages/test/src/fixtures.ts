import { test as base, type TestInfo } from '@playwright/test';
import { createWriteStream } from 'node:fs';
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
  platform: 'ios' | 'android' | undefined;
  deviceName: RegExp | undefined;
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
  bundleId: [async ({}, use) => {
    const config = await loadConfig();
    await use(config.bundleId);
  }, { option: true }],

  platform: [undefined, { option: true }],
  deviceName: [undefined, { option: true }],

  device: async ({ platform, deviceName, bundleId }, use) => {
    const config = await loadConfig();
    const merged = {
      ...config,
      ...(platform && { platform }),
      ...(deviceName && { deviceName }),
    };
    if (merged.platform !== 'ios' && merged.platform !== 'android') {
      throw new Error(`Unsupported platform: "${merged.platform}". Must be "ios" or "android".`);
    }

    const client = getClient();
    const handle = await client.allocate({
      platform: merged.platform,
      deviceNamePattern: merged.deviceName?.source,
      deviceId: merged.deviceId,
    });

    const device = await connectDevice({
      platform: handle.platform,
      deviceId: handle.deviceId,
      driverConfig: merged.driver,
      url: merged.url,
      timeout: merged.timeout,
    });

    try {
      for (const appPath of toArray(merged.installApps)) {
        const installed = await client.isAppInstalled(handle.allocationId, appPath);
        if (!installed) {
          await device.installApp(appPath);
          await client.recordAppInstalled(handle.allocationId, appPath);
        }
      }

      if (bundleId) {
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

  screen: async ({ device, video }, use, testInfo) => {
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
    }
  },
});

export { expect };
