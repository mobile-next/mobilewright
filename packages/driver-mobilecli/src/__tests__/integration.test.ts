/**
 * Integration test that connects to a real mobilecli server.
 *
 * Requires:
 *   - mobilecli server running on localhost:12000
 *   - A booted iOS simulator or Android emulator
 *   - MOBILEWRIGHT_INTEGRATION=1 environment variable
 *   - MOBILEWRIGHT_DEVICE_ID=<udid> environment variable
 */
import { test, expect } from '@playwright/test';
import { MobilecliDriver } from '../driver.js';

const INTEGRATION = process.env['MOBILEWRIGHT_INTEGRATION'] === '1';
const DEVICE_ID = process.env['MOBILEWRIGHT_DEVICE_ID'] ?? '';

test.describe('mobilecli integration', () => {
  test.skip(!INTEGRATION, 'Requires MOBILEWRIGHT_INTEGRATION=1');

  test('connects, dumps UI hierarchy, and takes a screenshot', async () => {
    const driver = new MobilecliDriver();

    const session = await driver.connect({
      deviceId: DEVICE_ID,
    });

    expect(session.platform).toMatch(/^(ios|android)$/);

    // Dump view hierarchy
    const hierarchy = await driver.getViewHierarchy();
    expect(hierarchy.length).toBeGreaterThan(0);
    expect(hierarchy[0].type).toBeTruthy();

    // Take screenshot
    const screenshot = await driver.screenshot();
    expect(screenshot).toBeInstanceOf(Buffer);
    expect(screenshot.length).toBeGreaterThan(100);

    // Get orientation
    const orientation = await driver.getOrientation();
    expect(orientation).toMatch(/^(portrait|landscape)$/);

    await driver.disconnect();
  });
});
