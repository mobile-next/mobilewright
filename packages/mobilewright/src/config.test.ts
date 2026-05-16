import { test, expect } from '@playwright/test';
import { defineConfig, toArray } from './config.js';

test('defineConfig injects globalSetup pointing at device-pool/setup.js', () => {
  const config = defineConfig({});
  expect(typeof config.globalSetup).toBe('string');
  expect(config.globalSetup as string).toMatch(/device-pool[\/\\]setup\.(js|ts)$/);
});

test('defineConfig composes user globalSetup before the user expects', () => {
  const config = defineConfig({ globalSetup: '/custom/setup.js' });
  const setups = Array.isArray(config.globalSetup) ? config.globalSetup : [config.globalSetup];
  expect(setups[0]).toMatch(/device-pool[\/\\]setup\.(js|ts)$/);
  expect(setups).toContain('/custom/setup.js');
});

test('defineConfig defaults workers to 1', () => {
  const config = defineConfig({});
  expect(config.workers).toBe(1);
});

test('defineConfig respects user-provided workers', () => {
  const config = defineConfig({ workers: 4 });
  expect(config.workers).toBe(4);
});

test('defineConfig preserves top-level installApps as a string', () => {
  const config = defineConfig({ installApps: 'app.apk' });
  expect(config.installApps).toBe('app.apk');
});

test('defineConfig preserves top-level installApps as an array', () => {
  const config = defineConfig({ installApps: ['app.apk', 'other.apk'] });
  expect(config.installApps).toEqual(['app.apk', 'other.apk']);
});

test('defineConfig with project use.installApps is preserved', () => {
  const config = defineConfig({
    projects: [{ name: 'android', use: { installApps: 'per-project.apk' } }],
  });
  expect(config.projects![0].use!.installApps).toBe('per-project.apk');
});

test('toArray returns empty array for undefined', () => {
  expect(toArray(undefined)).toEqual([]);
});

test('toArray wraps a single string into an array', () => {
  expect(toArray('app.apk')).toEqual(['app.apk']);
});

test('toArray returns the array unchanged when already an array', () => {
  expect(toArray(['app.apk', 'other.apk'])).toEqual(['app.apk', 'other.apk']);
});
