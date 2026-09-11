import { test as base, type TestInfo } from '@playwright/test';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import createDebug from 'debug';
import {
  createDevicePoolClient,
  connectDevice,
  loadConfig,
  toArray,
  type DevicePoolClient,
} from 'mobilewright';
import { expect, setSoftFailureHandler } from '@mobilewright/core';
import type { Device, Screen } from '@mobilewright/core';
import {
  assertValidZipFile,
  mergeDeviceConfig,
  assertSupportedPlatform,
  annotationsForDevice,
  connectOptionsFor,
  videoPlan,
  parseViewTreeOption,
} from './fixture-helpers.js';

const debug = createDebug('mw:test:fixtures');

// same private Playwright API its own expect.soft goes through
interface SoftFailureReporter {
  _failWithError(error: Error): void;
}

// expect.soft(): mark the test failed and record the error, but keep running.
setSoftFailureHandler((error) => {
  (base.info() as unknown as SoftFailureReporter)._failWithError(error);
});

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
  deviceId: string | undefined;
  deviceName: RegExp | undefined;
  deviceType: 'simulator' | 'emulator' | 'real' | undefined;
  osVersion: string | undefined;
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
  deviceId: [undefined, { option: true }],
  deviceName: [undefined, { option: true }],
  deviceType: [undefined, { option: true }],
  osVersion: [undefined, { option: true }],
  installApps: [undefined, { option: true }],

  viewTree: [async ({}, use, testInfo) => {
    const config = await loadConfig(process.cwd(), testInfo.config.configFile);
    await use(parseViewTreeOption(config.viewTree));
  }, { option: true }],

  device: async ({ platform, deviceId, deviceName, deviceType, osVersion, bundleId, autoAppLaunch, installApps }, use, testInfo) => {
    const config = await loadConfig(process.cwd(), testInfo.config.configFile);
    const merged = mergeDeviceConfig(config, { platform, deviceId, deviceName, deviceType, osVersion, installApps }, testInfo.project.name);
    const supportedPlatform = assertSupportedPlatform(merged.platform);

    for (const appPath of toArray(merged.installApps)) {
      assertValidZipFile(appPath);
    }

    const client = getClient();
    debug('allocating device (platform=%s)', supportedPlatform);
    const handle = await client.allocate({
      platform: supportedPlatform,
      deviceNamePattern: merged.deviceName?.source,
      deviceId: merged.deviceId,
      deviceType: merged.deviceType,
      osVersion: merged.osVersion,
    });
    debug('allocated device %s', handle.deviceId);

    testInfo.annotations.push(...annotationsForDevice(handle));

    debug('connecting to device %s', handle.deviceId);
    const device = await connectDevice(connectOptionsFor(handle, merged));
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

      device.setStepFn((title, fn, location) => (base.step as any)(title, fn, { location }));

      await use(device);
    } finally {
      await device.disconnect();
      await client.release(handle.allocationId);
    }
  },

  screen: async ({ device, video, viewTree }, use, testInfo) => {
    const plan = videoPlan(video, testInfo.outputDir, testInfo.testId);
    const videoPath = plan.path;

    if (plan.shouldRecord) {
      try {
        await mkdir(testInfo.outputDir, { recursive: true });
        await device.startRecording({ output: videoPath });
      } catch {
        // recording may not be supported — continue without it
      }
    }

    await use(device.screen);

    if (plan.shouldRecord) {
      try {
        const result = await device.stopRecording();
        const failed = testInfo.status !== testInfo.expectedStatus;

        if (plan.shouldAttach(failed)) {
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
