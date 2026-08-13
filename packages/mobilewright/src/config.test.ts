import { isAbsolute } from 'node:path';
import { test, expect } from '@playwright/test';
import type { MobilewrightDriver } from '@mobilewright/protocol';
import { MobileNextDriver } from '@mobilewright/driver-mobilenext';
import { MobilecliDriver } from '@mobilewright/driver-mobilecli';
import { defineConfig, toArray } from './config.js';
import { getActiveDriver } from './driver-registry.js';

type ReporterEntry = [string, unknown?];

const JSON_ENV_VARS = ['PLAYWRIGHT_JSON_OUTPUT_FILE', 'PLAYWRIGHT_JSON_OUTPUT_DIR', 'PLAYWRIGHT_JSON_OUTPUT_NAME'];

/** Clears the Playwright JSON-reporter env vars for the duration of `fn`, restoring them afterward. */
function withoutJsonEnvVars<T>(fn: () => T): T {
  const saved = JSON_ENV_VARS.map((name) => [name, process.env[name]] as const);
  for (const name of JSON_ENV_VARS) {
    delete process.env[name];
  }
  try {
    return fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

/** Sets the given env vars for the duration of `fn`, restoring the previous values afterward. */
function withEnvVars<T>(vars: Record<string, string>, fn: () => T): T {
  const saved = Object.keys(vars).map((name) => [name, process.env[name]] as const);
  for (const [name, value] of Object.entries(vars)) {
    process.env[name] = value;
  }
  try {
    return fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

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

test('defineConfig with project use.deviceId is preserved', () => {
  const config = defineConfig({
    projects: [{ name: 'android', use: { deviceId: 'emulator-5554' } }],
  });
  expect(config.projects![0].use!.deviceId).toBe('emulator-5554');
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

// ─── Observer reporter injection ───────────────────────────────────

test('defineConfig registers the configured driver as the active driver', () => {
  const driver = new MobilecliDriver();
  defineConfig({ driver });
  expect(getActiveDriver()).toBe(driver);
});

test('defineConfig leaves reporter untouched for a driver without an observer', () => {
  const config = defineConfig({ driver: new MobilecliDriver() });
  expect(config.reporter).toBeUndefined();
});

test('defineConfig converts a legacy {type, ...} driver config object into a driver instance', () => {
  const legacyDriver = { type: 'mobilenext', apiKey: 'key' } as unknown as MobilewrightDriver;

  const config = withoutJsonEnvVars(() => defineConfig({ driver: legacyDriver }));

  expect(config.driver).toBeInstanceOf(MobileNextDriver);
  expect(getActiveDriver()).toBe(config.driver);
  // The converted instance carries an observer, so the shim gets injected too.
  const reporters = config.reporter as ReporterEntry[];
  expect(String(reporters[reporters.length - 1]![0])).toMatch(/observer-reporter\.(js|ts)$/);
});

test('defineConfig converts a legacy mobilecli driver config object into a MobilecliDriver', () => {
  const legacyDriver = { type: 'mobilecli' } as unknown as MobilewrightDriver;

  const config = defineConfig({ driver: legacyDriver });

  expect(config.driver).toBeInstanceOf(MobilecliDriver);
});

test('defineConfig rejects an unknown legacy driver type with a clear message', () => {
  const legacyDriver = { type: 'appium' } as unknown as MobilewrightDriver;

  expect(() => defineConfig({ driver: legacyDriver })).toThrow(/unknown driver type "appium"/);
});

test('defineConfig leaves reporter untouched when no driver is configured', () => {
  const config = defineConfig({});
  expect(config.reporter).toBeUndefined();
});

test('defineConfig injects list, a tmp json reporter, and the observer shim for a driver with an observer and no user reporters', () => {
  const config = withoutJsonEnvVars(() => defineConfig({ driver: new MobileNextDriver({ apiKey: 'key' }) }));
  const reporters = config.reporter as ReporterEntry[];

  expect(reporters[0]![0]).toBe('list');

  const jsonEntries = reporters.filter(([name]) => name === 'json');
  expect(jsonEntries.length).toBe(1);
  const jsonOptions = jsonEntries[0]![1] as { outputFile: string };
  expect(jsonOptions.outputFile).toMatch(/mobilewright-results-.*\.json$/);

  const shimEntry = reporters[reporters.length - 1]!;
  expect(String(shimEntry[0])).toMatch(/observer-reporter\.(js|ts)$/);
  const shimOptions = shimEntry[1] as { jsonResultsPath: string };
  expect(shimOptions.jsonResultsPath).toBe(jsonOptions.outputFile);
});

test('defineConfig reuses an absolute user json reporter outputFile and injects no second json reporter', () => {
  const config = withoutJsonEnvVars(() =>
    defineConfig({
      driver: new MobileNextDriver({ apiKey: 'key' }),
      reporter: [['json', { outputFile: '/tmp/x.json' }]],
    }),
  );
  const reporters = config.reporter as ReporterEntry[];

  const jsonEntries = reporters.filter(([name]) => name === 'json');
  expect(jsonEntries.length).toBe(1);

  const shimEntry = reporters[reporters.length - 1]!;
  const shimOptions = shimEntry[1] as { jsonResultsPath: string; cleanupJsonResults: boolean };
  expect(shimOptions.jsonResultsPath).toBe('/tmp/x.json');
  expect(shimOptions.cleanupJsonResults).toBe(false);
});

test('defineConfig does not reuse a relative user json outputFile and appends its own tmp json reporter', () => {
  // Playwright resolves a relative outputFile against the config directory,
  // which defineConfig cannot know — reusing it would read the wrong path.
  const config = withoutJsonEnvVars(() =>
    defineConfig({
      driver: new MobileNextDriver({ apiKey: 'key' }),
      reporter: [['json', { outputFile: 'results.json' }]],
    }),
  );
  const reporters = config.reporter as ReporterEntry[];

  const jsonEntries = reporters.filter(([name]) => name === 'json');
  expect(jsonEntries.length).toBe(2);
  expect(jsonEntries[0]![1]).toEqual({ outputFile: 'results.json' });

  const shimEntry = reporters[reporters.length - 1]!;
  const shimOptions = shimEntry[1] as { jsonResultsPath: string; cleanupJsonResults: boolean };
  expect(isAbsolute(shimOptions.jsonResultsPath)).toBe(true);
  expect(shimOptions.jsonResultsPath).not.toBe('results.json');
  expect(shimOptions.cleanupJsonResults).toBe(true);
});

test('defineConfig uses PLAYWRIGHT_JSON_OUTPUT_FILE when the user json reporter has no outputFile', () => {
  const config = withEnvVars({ PLAYWRIGHT_JSON_OUTPUT_FILE: '/tmp/env-results.json' }, () =>
    defineConfig({
      driver: new MobileNextDriver({ apiKey: 'key' }),
      reporter: [['json']],
    }),
  );
  const reporters = config.reporter as ReporterEntry[];

  const jsonEntries = reporters.filter(([name]) => name === 'json');
  expect(jsonEntries.length).toBe(1);

  const shimEntry = reporters[reporters.length - 1]!;
  const shimOptions = shimEntry[1] as { jsonResultsPath: string };
  expect(shimOptions.jsonResultsPath).toBe('/tmp/env-results.json');
});

test('defineConfig uses PLAYWRIGHT_JSON_OUTPUT_DIR and _NAME when the user json reporter has no outputFile', () => {
  const config = withEnvVars(
    { PLAYWRIGHT_JSON_OUTPUT_DIR: '/tmp/reports', PLAYWRIGHT_JSON_OUTPUT_NAME: 'out.json' },
    () =>
      defineConfig({
        driver: new MobileNextDriver({ apiKey: 'key' }),
        reporter: [['json']],
      }),
  );
  const reporters = config.reporter as ReporterEntry[];

  const jsonEntries = reporters.filter(([name]) => name === 'json');
  expect(jsonEntries.length).toBe(1);

  const shimEntry = reporters[reporters.length - 1]!;
  const shimOptions = shimEntry[1] as { jsonResultsPath: string };
  expect(shimOptions.jsonResultsPath).toBe('/tmp/reports/out.json');
});

test('defineConfig appends a tmp json reporter alongside an untouched stdout json entry when no env vars are set', () => {
  const config = withoutJsonEnvVars(() =>
    defineConfig({
      driver: new MobileNextDriver({ apiKey: 'key' }),
      reporter: [['json']],
    }),
  );
  const reporters = config.reporter as ReporterEntry[];

  const jsonEntries = reporters.filter(([name]) => name === 'json');
  expect(jsonEntries.length).toBe(2);
  expect(jsonEntries[0]![1]).toBeUndefined();
  const injectedOptions = jsonEntries[1]![1] as { outputFile: string };
  expect(injectedOptions.outputFile).toMatch(/mobilewright-results-/);
});

test('defineConfig preserves the user reporter list ahead of the injected entries', () => {
  const config = withoutJsonEnvVars(() =>
    defineConfig({
      driver: new MobileNextDriver({ apiKey: 'key' }),
      reporter: [['html'], ['list']],
    }),
  );
  const names = (config.reporter as ReporterEntry[]).map(([name]) => name);
  expect(names[0]).toBe('html');
  expect(names[1]).toBe('list');
});

test('defineConfig normalizes a string reporter to array form before injecting', () => {
  const config = withoutJsonEnvVars(() =>
    defineConfig({
      driver: new MobileNextDriver({ apiKey: 'key' }),
      reporter: 'html',
    }),
  );
  const names = (config.reporter as ReporterEntry[]).map(([name]) => name);
  expect(names).toContain('html');
});

test('defineConfig sets captureGitInfo commit:true when injecting the observer reporter', () => {
  const config = defineConfig({ driver: new MobileNextDriver({ apiKey: 'key' }) });
  expect(config.captureGitInfo).toEqual({ commit: true });
});

test('defineConfig preserves the user explicit captureGitInfo values when injecting', () => {
  const config = defineConfig({
    driver: new MobileNextDriver({ apiKey: 'key' }),
    captureGitInfo: { commit: false, diff: true },
  });
  expect(config.captureGitInfo).toEqual({ commit: false, diff: true });
});
