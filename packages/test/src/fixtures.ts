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
  type AllocationCriteria,
  type AllocationHandle,
} from 'mobilewright';
import { expect, setSoftFailureHandler, setDefaultStepFn } from '@mobilewright/core';
import type { Device, Screen, StepFn } from '@mobilewright/core';
import {
  assertValidZipFile,
  mergeDeviceConfig,
  assertReinstallAppConfig,
  prepareApp,
  assertSupportedPlatform,
  annotationsForDevice,
  connectOptionsFor,
  allocationTimeoutFor,
  videoPlan,
  parseViewTreeOption,
} from './fixture-helpers.js';

const debug = createDebug('mw:test:fixtures');

function createStepFn(): StepFn {
  return (title, fn, location) => (base.step as any)(title, fn, { location });
}

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
  reinstallApp: boolean | undefined;
  platform: 'ios' | 'android' | undefined;
  deviceId: string | undefined;
  deviceName: RegExp | undefined;
  deviceType: 'simulator' | 'emulator' | 'real' | undefined;
  osVersion: string | undefined;
  installApps: string | string[] | undefined;
  viewTree: 'on-failure' | 'off';
  device: Device;
  expectStepReporting: void;
};

async function allocateWithinTimeout(client: DevicePoolClient, criteria: AllocationCriteria, timeoutMs: number): Promise<AllocationHandle> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await client.allocate(criteria, controller.signal);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`device allocation timed out after ${timeoutMs}ms (use.allocationTimeout)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

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

  reinstallApp: [async ({}, use, testInfo) => {
    const config = await loadConfig(process.cwd(), testInfo.config.configFile);
    await use(config.reinstallApp);
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

  // Auto fixture, independent of `device`: every test gets step reporting for plain-value
  // expect() assertions (expect(x).toBe(y)), and it's torn down when THIS test ends, so the
  // module-level defaultStepFn never survives past its test (e.g. into an afterAll running
  // after the last test's device already disconnected, where calling test.step() would fail).
  expectStepReporting: [async ({}, use) => {
    setDefaultStepFn(createStepFn());
    try {
      await use();
    } finally {
      setDefaultStepFn(null);
    }
  }, { auto: true }],

  // Setup runs outside the test timeout (timeout: 0): each stage carries its own bound instead —
  // allocationTimeout for queue + provisioning, installTimeout, appLaunchTimeout. A cloud queue
  // can hold a worker for many minutes, and that wait must not eat the test body's budget.
  device: [async ({ platform, deviceId, deviceName, deviceType, osVersion, bundleId, autoAppLaunch, reinstallApp, installApps }, use, testInfo) => {
    const config = await loadConfig(process.cwd(), testInfo.config.configFile);
    const merged = mergeDeviceConfig(config, { platform, deviceId, deviceName, deviceType, osVersion, installApps }, testInfo.project.name);
    const supportedPlatform = assertSupportedPlatform(merged.platform);

    const appPreparation = { bundleId, autoAppLaunch, reinstallApp: reinstallApp ?? merged.use?.reinstallApp, installApps: toArray(merged.installApps) };
    assertReinstallAppConfig(appPreparation);
    for (const appPath of appPreparation.installApps) {
      assertValidZipFile(appPath);
    }

    const client = getClient();
    debug('allocating device (platform=%s)', supportedPlatform);
    const handle = await allocateWithinTimeout(client, {
      platform: supportedPlatform,
      deviceNamePattern: merged.deviceName?.source,
      deviceId: merged.deviceId,
      deviceType: merged.deviceType,
      osVersion: merged.osVersion,
    }, allocationTimeoutFor(merged));
    debug('allocated device %s', handle.deviceId);

    testInfo.annotations.push(...annotationsForDevice(handle));

    debug('connecting to device %s', handle.deviceId);
    const device = await connectDevice(connectOptionsFor(handle, merged));
    debug('connected to device %s', handle.deviceId);

    try {
      await prepareApp(device, {
        isInstalled: (appPath) => client.isAppInstalled(handle.allocationId, appPath),
        recordInstalled: (appPath) => client.recordAppInstalled(handle.allocationId, appPath),
      }, appPreparation);

      device.setStepFn(createStepFn());

      await use(device);
    } finally {
      await device.disconnect();
      await client.release(handle.allocationId);
    }
  }, { timeout: 0 }],

  screen: async ({ device, video, viewTree }, use, testInfo) => {
    // device is null when its setup was aborted (e.g. test timed out while allocating) and an afterEach still requests screen
    if (!device) {
      throw new Error('device is not available, its setup did not complete (did the test time out while allocating?)');
    }

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
