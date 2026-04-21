import { writeFileSync, unlinkSync, existsSync, statSync } from 'node:fs';
import { test, expect } from '@mobilewright/test';

test.use({ platform: 'ios' });

// ─── Connection ──────────────────────────────────────────────

test('should connect and have a valid screen', async ({ device }) => {
  const size = await device.driver.getScreenSize();
  expect(size.width).toBeGreaterThan(0);
  expect(size.height).toBeGreaterThan(0);
});

// ─── Screen info ─────────────────────────────────────────────

test('should get orientation', async ({ device }) => {
  const orientation = await device.getOrientation();
  expect(orientation).toMatch(/^(portrait|landscape)$/);
});

// ─── Screenshot ──────────────────────────────────────────────

test('should take a screenshot', async ({ screen }) => {
  const screenshot = await screen.screenshot();
  expect(screenshot).toBeInstanceOf(Buffer);
  expect(screenshot.length).toBeGreaterThan(1000);
});

test('should save screenshot to file', async ({ screen }) => {
  const screenshotPath = `/tmp/mobilewright-e2e-${Date.now()}.png`;
  try {
    const buffer = await screen.screenshot();
    writeFileSync(screenshotPath, buffer);
    verifyFileExists(screenshotPath);
    verifyFileSize(screenshotPath, 1000);
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

test('should press HOME button', async ({ screen }) => {
  await screen.pressButton('HOME');
});

// ─── Apps ───────────────────────────────────────────────────

test('should list installed apps', async ({ device }) => {
  const apps = await device.listApps();
  expect(apps.length).toBeGreaterThan(0);
  expect(apps[0].bundleId).toBeTruthy();
});

test('should get foreground app', async ({ device }) => {
  const app = await device.getForegroundApp();
  expect(app.bundleId).toBeTruthy();
});

test('should launch and terminate Settings app', async ({ device }) => {
  await device.launchApp('com.apple.Preferences');
  await wait(3000);

  const foreground = await device.getForegroundApp();
  expect(foreground.bundleId).toBe('com.apple.Preferences');

  await device.terminateApp('com.apple.Preferences');
  await wait(2000);
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
