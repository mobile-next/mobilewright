import { test, expect } from '@playwright/test';
import { defineConfig } from './config.js';

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
