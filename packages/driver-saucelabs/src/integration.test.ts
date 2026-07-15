/**
 * Integration test that connects to a real Sauce Labs device.
 *
 * Requires:
 *   - SAUCE_USERNAME environment variable
 *   - SAUCE_ACCESS_KEY environment variable
 *   - SAUCE_INTEGRATION=1 environment variable
 *   - SAUCE_PLATFORM=ios|android (default: ios)
 *   - SAUCE_REGION=us-west-1|eu-central-1|us-east-4 (default: us-west-1)
 */
import { test, expect } from '@playwright/test';
import type { Platform } from '@mobilewright/protocol';
import { SauceLabsDriver } from './driver.js';
import type { Region } from './rest-client.js';

const INTEGRATION = process.env['SAUCE_INTEGRATION'] === '1';
const HAS_CREDENTIALS = Boolean(process.env['SAUCE_USERNAME'] && process.env['SAUCE_ACCESS_KEY']);
const PLATFORM = (process.env['SAUCE_PLATFORM'] ?? 'ios') as Platform;
const REGION = (process.env['SAUCE_REGION'] ?? 'us-west-1') as Region;
const IOS_WDA_STORAGE_REF = process.env['SAUCE_IOS_WDA_STORAGE_REF'];

test.describe('SauceLabsDriver integration', () => {
  test.skip(!INTEGRATION || !HAS_CREDENTIALS, 'Requires SAUCE_INTEGRATION=1, SAUCE_USERNAME, and SAUCE_ACCESS_KEY');
  test.setTimeout(120_000);

  test('connects and returns a session with the correct platform', async () => {
    const driver = new SauceLabsDriver({
      region: REGION,
      ...(IOS_WDA_STORAGE_REF ? { iosWdaStorageRef: IOS_WDA_STORAGE_REF } : {}),
    });

    const session = await driver.connect({ platform: PLATFORM });
    try {
      expect(session.platform).toBe(PLATFORM);
      expect(session.deviceId).toBeTruthy();
    } finally {
      await driver.disconnect();
    }
  });

  test('takes a screenshot and returns a non-empty Buffer', async () => {
    const driver = new SauceLabsDriver({
      region: REGION,
      ...(IOS_WDA_STORAGE_REF ? { iosWdaStorageRef: IOS_WDA_STORAGE_REF } : {}),
    });
    await driver.connect({ platform: PLATFORM });

    try {
      const screenshot = await driver.screenshot();
      expect(screenshot).toBeInstanceOf(Buffer);
      expect(screenshot.length).toBeGreaterThan(100);
    } finally {
      await driver.disconnect();
    }
  });

  test('getScreenSize returns positive dimensions', async () => {
    const driver = new SauceLabsDriver({
      region: REGION,
      ...(IOS_WDA_STORAGE_REF ? { iosWdaStorageRef: IOS_WDA_STORAGE_REF } : {}),
    });
    await driver.connect({ platform: PLATFORM });

    try {
      const size = await driver.getScreenSize();
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
      expect(size.scale).toBeGreaterThanOrEqual(1);
    } finally {
      await driver.disconnect();
    }
  });

  test('getOrientation returns portrait or landscape', async () => {
    const driver = new SauceLabsDriver({
      region: REGION,
      ...(IOS_WDA_STORAGE_REF ? { iosWdaStorageRef: IOS_WDA_STORAGE_REF } : {}),
    });
    await driver.connect({ platform: PLATFORM });

    try {
      const orientation = await driver.getOrientation();
      expect(orientation).toMatch(/^(portrait|landscape)$/);
    } finally {
      await driver.disconnect();
    }
  });

  test('getViewHierarchy returns a non-empty node tree', async () => {
    test.setTimeout(180_000);
    const driver = new SauceLabsDriver({
      region: REGION,
      ...(IOS_WDA_STORAGE_REF ? { iosWdaStorageRef: IOS_WDA_STORAGE_REF } : {}),
    });
    await driver.connect({ platform: PLATFORM });

    try {
      const hierarchy = await driver.getViewHierarchy();
      expect(Array.isArray(hierarchy)).toBe(true);
      expect(hierarchy.length).toBeGreaterThan(0);
      expect(hierarchy[0].type).toBeTruthy();
    } finally {
      await driver.disconnect();
    }
  });

  test('listDevices returns at least one device', async () => {
    const driver = new SauceLabsDriver({
      region: REGION,
      ...(IOS_WDA_STORAGE_REF ? { iosWdaStorageRef: IOS_WDA_STORAGE_REF } : {}),
    });
    await driver.connect({ platform: PLATFORM });

    try {
      const devices = await driver.listDevices();
      expect(devices.length).toBeGreaterThan(0);
      expect(devices[0].id).toBeTruthy();
      expect(devices[0].platform).toMatch(/^(ios|android)$/);
    } finally {
      await driver.disconnect();
    }
  });

  test('tap does not throw', async () => {
    const driver = new SauceLabsDriver({
      region: REGION,
      ...(IOS_WDA_STORAGE_REF ? { iosWdaStorageRef: IOS_WDA_STORAGE_REF } : {}),
    });
    await driver.connect({ platform: PLATFORM });

    try {
      const size = await driver.getScreenSize();
      await expect(driver.tap(size.width / 2, size.height / 2)).resolves.toBeUndefined();
    } finally {
      await driver.disconnect();
    }
  });

  test('pressButton HOME does not throw', async () => {
    const driver = new SauceLabsDriver({
      region: REGION,
      ...(IOS_WDA_STORAGE_REF ? { iosWdaStorageRef: IOS_WDA_STORAGE_REF } : {}),
    });
    await driver.connect({ platform: PLATFORM });

    try {
      await expect(driver.pressButton('HOME')).resolves.toBeUndefined();
    } finally {
      await driver.disconnect();
    }
  });
});
