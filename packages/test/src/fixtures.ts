import { test as base } from '@playwright/test';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createDevicePoolClient,
  connectDevice,
  loadConfig,
} from 'mobilewright';
import { expect } from '@mobilewright/core';
import type { Device, Screen } from '@mobilewright/core';

type MobilewrightTestFixtures = {
  screen: Screen;
  bundleId: string | undefined;
  platform: 'ios' | 'android' | undefined;
  deviceName: RegExp | undefined;
  device: Device;
};

const client = createDevicePoolClient();

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
      const appsToInstall = merged.installApps
        ? (Array.isArray(merged.installApps) ? merged.installApps : [merged.installApps])
        : [];
      for (const appPath of appsToInstall) {
        const installed = await client.hasInstalled(handle.allocationId, appPath);
        if (!installed) {
          await device.installApp(appPath);
          await client.recordInstalled(handle.allocationId, appPath);
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
        await device.stopRecording();
        const failed = testInfo.status !== testInfo.expectedStatus;
        const shouldAttach = videoMode === 'on' || (videoMode === 'retain-on-failure' && failed);

        if (shouldAttach) {
          const videoBuffer = await readFile(videoPath);
          await testInfo.attach('video', { body: videoBuffer, contentType: 'video/mp4' });
        }

        await unlink(videoPath).catch(() => {});
      } catch {
        // best effort — recording may have failed to start
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
