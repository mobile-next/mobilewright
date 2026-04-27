import { test as base } from '@playwright/test';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ios, android, loadConfig } from 'mobilewright';
import { expect, Tracer } from '@mobilewright/core';
import type { Device, Screen } from '@mobilewright/core';

type TraceMode = 'on' | 'off' | 'retain-on-failure' | 'on-first-retry';

type MobilewrightTestFixtures = {
  screen: Screen;
  bundleId: string | undefined;
};

type MobilewrightWorkerFixtures = {
  platform: 'ios' | 'android' | undefined;
  deviceName: RegExp | undefined;
  device: Device;
};

export const test = base.extend<MobilewrightTestFixtures, MobilewrightWorkerFixtures>({
  bundleId: [async ({}, use) => {
    const config = await loadConfig();
    await use(config.bundleId);
  }, { option: true }],
  platform: [undefined, { option: true, scope: 'worker' }],
  deviceName: [undefined, { option: true, scope: 'worker' }],

  device: [async ({ platform, deviceName }, use) => {
    const config = await loadConfig();
    const merged = {
      ...config,
      ...(platform && { platform }),
      ...(deviceName && { deviceName }),
    };

    if (merged.platform && merged.platform !== 'ios' && merged.platform !== 'android') {
      throw new Error(`Unsupported platform: "${merged.platform}". Must be "ios" or "android".`);
    }

    const launcher = merged.platform === 'android' ? android : ios;
    const device = await launcher.launch(merged);
    await use(device);
    await device.close();
  }, { scope: 'worker' }],

  screen: async ({ device, video }, use, testInfo) => {
    // ── Video recording ──────────────────────────────────────
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
        // Recording may not be supported — continue without it
      }
    }

    // ── Tracing ──────────────────────────────────────────────
    const config = await loadConfig();
    const traceMode: TraceMode = config.trace ?? 'off';
    const shouldTrace = traceMode === 'on'
      || traceMode === 'retain-on-failure'
      || (traceMode === 'on-first-retry' && testInfo.retry === 1);

    let tracer: Tracer | null = null;
    if (shouldTrace) {
      tracer = new Tracer();
      device.setTracer(tracer);
    }

    await use(device.screen);

    // ── Teardown: tracing ────────────────────────────────────
    if (tracer) {
      const failed = testInfo.status !== testInfo.expectedStatus;
      const shouldSaveTrace = traceMode === 'on'
        || (traceMode === 'retain-on-failure' && failed)
        || (traceMode === 'on-first-retry' && testInfo.retry === 1);

      if (shouldSaveTrace) {
        try {
          await mkdir(testInfo.outputDir, { recursive: true });
          const tracePath = join(testInfo.outputDir, 'trace.zip');
          await tracer.save(tracePath);
          await testInfo.attach('trace', { path: tracePath, contentType: 'application/zip' });
        } catch {
          // Best effort
        }
      }
    }

    // ── Teardown: video ──────────────────────────────────────
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
        // Best effort — recording may have failed to start
      }
    }

    if (testInfo.status !== testInfo.expectedStatus) {
      try {
        const screenshot = await device.screen.screenshot();
        await testInfo.attach('screenshot-on-failure', { body: screenshot, contentType: 'image/png' });
      } catch {
        // Device may be disconnected
      }
    }
  },
});

export { expect };
