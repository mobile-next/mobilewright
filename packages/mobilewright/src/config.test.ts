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

test('defineConfig injects upload reporter by default when testResult is set without uploadReport', () => {
  const config = defineConfig({
    driver: {
      type: 'mobilenext',
      apiKey: 'test-key',
      testResult: {},
    },
  });
  const reporters = config.reporter as Array<[string, unknown]>;
  expect(Array.isArray(reporters)).toBe(true);
  const paths = reporters.map((r) => r[0]);
  expect(paths.some((p) => String(p).includes('mobilenext-upload'))).toBe(true);
});

test('defineConfig injects upload reporter when mobilenext driver has uploadReport on', () => {
  const config = defineConfig({
    driver: {
      type: 'mobilenext',
      apiKey: 'test-key',
      testResult: { uploadReport: 'on' },
    },
  });
  const reporters = config.reporter as Array<[string, unknown]>;
  expect(Array.isArray(reporters)).toBe(true);
  const paths = reporters.map((r) => r[0]);
  expect(paths.some((p) => String(p).includes('mobilenext-upload'))).toBe(true);
});

test('defineConfig injects json reporter alongside upload reporter', () => {
  const config = defineConfig({
    driver: {
      type: 'mobilenext',
      apiKey: 'key',
      testResult: { uploadReport: 'on-failure' },
    },
  });
  const reporters = config.reporter as Array<[string, unknown]>;
  const jsonEntry = reporters.find((r) => r[0] === 'json');
  expect(jsonEntry).toBeDefined();
  const opts = jsonEntry![1] as { outputFile: string };
  expect(opts.outputFile).toMatch(/mobilewright-results/);
});

test('defineConfig does not inject upload reporter when uploadReport is off', () => {
  const config = defineConfig({
    driver: {
      type: 'mobilenext',
      apiKey: 'key',
      testResult: { uploadReport: 'off' },
    },
  });
  if (Array.isArray(config.reporter)) {
    const paths = config.reporter.map((r) => (Array.isArray(r) ? r[0] : r));
    expect(paths.some((p) => String(p).includes('mobilenext-upload'))).toBe(false);
  } else {
    expect(config.reporter).toBeUndefined();
  }
});

test('defineConfig does not inject upload reporter when testResult is absent', () => {
  const config = defineConfig({ driver: { type: 'mobilenext', apiKey: 'key' } });
  expect(config.reporter).toBeUndefined();
});

test('defineConfig does not inject upload reporter for mobilecli driver', () => {
  const config = defineConfig({ driver: { type: 'mobilecli' } });
  expect(config.reporter).toBeUndefined();
});

test('defineConfig preserves existing array reporters when injecting', () => {
  const config = defineConfig({
    driver: { type: 'mobilenext', apiKey: 'key', testResult: { uploadReport: 'on' } },
    reporter: [['html'], ['list']],
  });
  const reporters = config.reporter as Array<[string, unknown]>;
  const names = reporters.map((r) => r[0]);
  expect(names).toContain('html');
  expect(names).toContain('list');
  expect(names.some((n) => String(n).includes('mobilenext-upload'))).toBe(true);
});

test('defineConfig normalizes string reporter to array form before injecting', () => {
  const config = defineConfig({
    driver: { type: 'mobilenext', apiKey: 'key', testResult: { uploadReport: 'on' } },
    reporter: 'html',
  });
  const reporters = config.reporter as Array<[string, unknown]>;
  expect(Array.isArray(reporters)).toBe(true);
  const names = reporters.map((r) => r[0]);
  expect(names).toContain('html');
  expect(names.some((n) => String(n).includes('mobilenext-upload'))).toBe(true);
});

test('defineConfig preserves use.actionTimeout', () => {
  const config = defineConfig({ use: { actionTimeout: 10_000 } });
  expect(config.use?.actionTimeout).toBe(10_000);
});

test('defineConfig preserves use.appLaunchTimeout', () => {
  const config = defineConfig({ use: { appLaunchTimeout: 45_000 } });
  expect(config.use?.appLaunchTimeout).toBe(45_000);
});

test('defineConfig preserves use.installTimeout', () => {
  const config = defineConfig({ use: { installTimeout: 60_000 } });
  expect(config.use?.installTimeout).toBe(60_000);
});

test('defineConfig preserves expect.timeout', () => {
  const config = defineConfig({ expect: { timeout: 8_000 } });
  expect(config.expect?.timeout).toBe(8_000);
});

test('defineConfig preserves globalTimeout', () => {
  const config = defineConfig({ globalTimeout: 3_600_000 });
  expect(config.globalTimeout).toBe(3_600_000);
});

test('defineConfig preserves driver.mobilenext.allocationTimeout', () => {
  const config = defineConfig({
    driver: { type: 'mobilenext', apiKey: 'key', allocationTimeout: 900_000 },
  });
  const driver = config.driver as import('./config.js').DriverConfigMobileNext;
  expect(driver.allocationTimeout).toBe(900_000);
});

test('defineConfig preserves driver.mobilenext.uploadTimeout', () => {
  const config = defineConfig({
    driver: {
      type: 'mobilenext',
      apiKey: 'key',
      testResult: { uploadReport: 'on' },
      uploadTimeout: 120_000,
    },
  });
  const driver = config.driver as import('./config.js').DriverConfigMobileNext;
  expect(driver.uploadTimeout).toBe(120_000);
});

test('defineConfig passes uploadTimeout to upload reporter options', () => {
  const config = defineConfig({
    driver: {
      type: 'mobilenext',
      apiKey: 'key',
      testResult: { uploadReport: 'on' },
      uploadTimeout: 90_000,
    },
  });
  const reporters = config.reporter as Array<[string, unknown]>;
  const uploadEntry = reporters.find(([path]) => String(path).includes('mobilenext-upload'));
  expect(uploadEntry).toBeDefined();
  const opts = uploadEntry![1] as { uploadTimeout: number };
  expect(opts.uploadTimeout).toBe(90_000);
});

test('defineConfig sets captureGitInfo when mobilenext driver is configured with testResult', () => {
  const config = defineConfig({
    driver: { type: 'mobilenext', apiKey: 'key', testResult: { uploadReport: 'on' } },
  });
  expect(config.captureGitInfo).toEqual({ commit: true });
});

test('defineConfig does not set captureGitInfo when testResult is absent', () => {
  const config = defineConfig({ driver: { type: 'mobilenext', apiKey: 'key' } });
  expect(config.captureGitInfo).toBeUndefined();
});

test('defineConfig accepts mobilenext driver with testResult config', () => {
  const config = defineConfig({
    driver: {
      type: 'mobilenext',
      apiKey: 'test-key',
      testResult: {
        uploadReport: 'on',
        name: 'My Suite',
        tags: ['ci', 'nightly'],
        environment: 'staging',
      },
    },
  });
  const driver = config.driver as import('./config.js').DriverConfigMobileNext;
  expect(driver.testResult?.uploadReport).toBe('on');
  expect(driver.testResult?.name).toBe('My Suite');
  expect(driver.testResult?.tags).toEqual(['ci', 'nightly']);
  expect(driver.testResult?.environment).toBe('staging');
});
