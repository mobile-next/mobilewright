import { unlinkSync, existsSync, statSync } from 'node:fs';
import { test, expect } from '@mobilewright/test';

test.use({ platform: 'ios' });
test.describe.configure({ mode: 'serial' });

// ─── Connection ──────────────────────────────────────────────

test('should connect and have a valid screen', async ({ device }) => {
  const size = await device.driver.getScreenSize();
  expect(size.width).toBeGreaterThan(256);
  expect(size.height).toBeGreaterThan(256);
  expect(size.height).toBeGreaterThan(size.width);
  expect(size.scale).toBeGreaterThanOrEqual(1);
  expect(size.scale).toBeLessThanOrEqual(3);
});

// ─── Screen info ─────────────────────────────────────────────

false && test('should get/set orientation', async ({ device }) => {
  // let's start with portrait
  await device.setOrientation('portrait');
  expect(await device.getOrientation()).toEqual("portrait");

  await device.setOrientation('landscape');
  expect(await device.getOrientation()).toEqual('landscape');

  await device.setOrientation('portrait');
  expect(await device.getOrientation()).toEqual("portrait");
});

// ─── Screenshot ──────────────────────────────────────────────

test('should take a screenshot', async ({ screen }) => {
  const screenshot = await screen.screenshot();
  expect(screenshot).toBeInstanceOf(Buffer);
  expect(screenshot.length).toBeGreaterThan(4096);

  // expect it to be a valid PNG file (starts with PNG signature)
  const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  expect(screenshot.slice(0, 8)).toEqual(pngHeader);
});

test('should save screenshot to file', async ({ screen }) => {
  const screenshotPath = `/tmp/mobilewright-e2e-${Date.now()}.png`;
  try {
    const buffer = await screen.screenshot({path: screenshotPath});
    verifyFileExists(screenshotPath);
    verifyFileSize(screenshotPath, 4096);
  } finally {
    cleanupFile(screenshotPath);
  }
});

// ─── UI hierarchy ───────────────────────────────────────────

test('should find elements on screen', async ({ screen }) => {
  await expect(screen.getByType('StaticText').first()).toBeVisible();
});

// ─── Input ──────────────────────────────────────────────────

test('should tap on screen center', async ({ device, screen }) => {
  const size = await device.driver.getScreenSize();
  const centerX = Math.round(size.width / 2);
  const centerY = Math.round(size.height / 2);
  await screen.tap(centerX, centerY);
});

test('should swipe up', async ({ screen }) => {
  await screen.swipe('up');
});

test('should press HOME button', async ({ device, screen }) => {
  await device.launchApp('com.apple.Preferences');

  const foreground1 = await device.getForegroundApp();
  expect(foreground1.bundleId).toBe('com.apple.Preferences');
 
  await screen.pressButton('HOME');
  await wait(2000);

  const foreground2 = await device.getForegroundApp();
  expect(foreground2.bundleId).toBe('com.apple.springboard');
});

// ─── Apps ───────────────────────────────────────────────────

test('should list installed apps', async ({ device }) => {
  const apps = await device.listApps();
  expect(apps.length).toBeGreaterThan(0);

  const app = apps.find((app) => app.bundleId === 'com.apple.Preferences');
  expect(app).toBeTruthy();
  expect(app!.name).toBe('Settings');
  // TODO: expect(app!.version).toMatch(/^\d+\.\d+(\.\d+)?$/);
});

test('should get foreground app', async ({ device }) => {
  const app = await device.getForegroundApp();
  expect(app.bundleId).toBeTruthy();
});

test('should launch and terminate Settings app', async ({ device }) => {
  await device.terminateApp('com.apple.Preferences');
  await device.launchApp('com.apple.Preferences');

  const foreground = await device.getForegroundApp();
  expect(foreground.bundleId).toBe('com.apple.Preferences');

  await device.terminateApp('com.apple.Preferences');

  // foreground app should be springboard now
  const foreground2 = await device.getForegroundApp();
  expect(foreground2.bundleId).toBe('com.apple.springboard');
});

// ─── Navigation ─────────────────────────────────────────────

test('should tap into Settings > General and verify navigation', async ({ device, screen }) => {
  await device.launchApp('com.apple.Preferences');
  await wait(3000);

  const general = screen.getByLabel('General');
  await expect(general).toBeVisible();
  await general.tap();
  await wait(2000);

  await expect(screen.getByLabel('About')).toBeVisible();

  await screen.pressButton('HOME');
  await wait(1000);
});

// ─── Helpers ────────────────────────────────────────────────────

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function verifyFileExists(path: string): void {
  expect(existsSync(path)).toBe(true);
}

function verifyFileSize(path: string, minBytes: number): void {
  const stats = statSync(path);
  expect(stats.size).toBeGreaterThan(minBytes);
}

function cleanupFile(path: string): void {
  if (existsSync(path)) {
    unlinkSync(path);
  }
}
