import { access } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { MobileNextTestResultConfig } from '@mobilewright/driver-mobilenext';

export type { MobileNextTestResultConfig };

const _require = createRequire(import.meta.url);

// ─── Project ──────────────────────────────────────────────────────

export interface MobilewrightUseOptions {
  /** Platform for this project. */
  platform?: 'ios' | 'android';
  /** Regex to match device name. */
  deviceName?: RegExp;
  /** App bundle ID for this project. */
  bundleId?: string;
  /** App paths (APK/IPA) to install for this project. Overrides top-level installApps. */
  installApps?: string | string[];
  /** System animations on the device: 'on' or 'off'. If omitted, the device is left unchanged. */
  animations?: 'on' | 'off';
  /** Default timeout for locator actions (tap, fill, etc.) in ms. Default: 5000. */
  actionTimeout?: number;
  /** Timeout waiting for the app to reach foreground after launch, in ms. Default: 20000. */
  appLaunchTimeout?: number;
  /** Timeout for app installation (installApps) in ms. Default: none. */
  installTimeout?: number;
}

export interface MobilewrightExpectConfig {
  /** Default timeout for assertions (toBeVisible, toHaveText, etc.) in ms. Default: 5000. */
  timeout?: number;
}

export interface MobilewrightProjectConfig {
  /** Project name — visible in reports and used with --project filter. */
  name: string;
  /** Per-project mobile fixture overrides (platform, device, bundleId). */
  use?: MobilewrightUseOptions;
  /** Test timeout in milliseconds (overrides top-level). */
  timeout?: number;
  /** Directory to search for tests (overrides top-level). */
  testDir?: string;
  /** Glob patterns for test files (overrides top-level). */
  testMatch?: string | RegExp | Array<string | RegExp>;
  /** Glob patterns for files to skip (overrides top-level). */
  testIgnore?: string | RegExp | Array<string | RegExp>;
  /** Output directory for artifacts (overrides top-level). */
  outputDir?: string;
  /** Maximum retries (overrides top-level). */
  retries?: number;
  /** Filter to only run tests matching this pattern. */
  grep?: RegExp | Array<RegExp>;
  /** Filter to skip tests matching this pattern. */
  grepInvert?: RegExp | Array<RegExp>;
  /** Projects that must run before this one. */
  dependencies?: string[];
}

// ─── Config ───────────────────────────────────────────────────────

export interface DriverConfigMobilecli {
  type: 'mobilecli';
}

export interface DriverConfigMobileNext {
  type: 'mobilenext' | 'mobile-use';
  region?: string;
  apiKey?: string;
  testResult?: MobileNextTestResultConfig;
  /** Timeout waiting for a cloud device to be allocated from the pool, in ms. Default: 300000 (5 min). */
  allocationTimeout?: number;
  /** Timeout for uploading test results to mobilenext.ai, in ms. Default: none. */
  uploadTimeout?: number;
}

export type DriverConfig = DriverConfigMobilecli | DriverConfigMobileNext;

export interface MobilewrightConfig {
  // ── Mobile-specific ─────────────────────────────────────────
  /** Default platform. */
  platform?: 'ios' | 'android';
  /** Specific device identifier (local drivers only). */
  deviceId?: string;
  /** Regex to match device name (e.g. /iPhone 17/). */
  deviceName?: RegExp;
  /** Default app bundle ID. */
  bundleId?: string;
  /** App paths (APK/IPA) to install on the device before launching. */
  installApps?: string | string[];
  /** Automatically launch the app after connecting. Default: true. */
  autoAppLaunch?: boolean;
  /** Attach the accessibility tree as JSON to the test report. 'on-failure' attaches on test failure, 'off' disables. Default: 'off'. */
  viewTree?: 'on-failure' | 'off';
  /** mobilecli server URL (use for remote servers). */
  url?: string;
  /** Path to mobilecli binary (if not on PATH). */
  mobilecliPath?: string;
  /** Auto-start mobilecli server if not running. Default: true. */
  autoStart?: boolean;
  /** Driver to use. Default: { type: 'mobilecli' }. */
  driver?: DriverConfig;

  // ── Test runner ─────────────────────────────────────────────
  /** Directory to search for test files. Default: config file directory. */
  testDir?: string;
  /** Glob patterns for test files. Default: **\/*.{test,spec}.{js,ts,mjs} */
  testMatch?: string | RegExp | Array<string | RegExp>;
  /** Glob patterns for files to skip during test discovery. */
  testIgnore?: string | RegExp | Array<string | RegExp>;
  /** Output directory for test artifacts. Default: test-results. */
  outputDir?: string;
  /** Per-test timeout in ms. */
  timeout?: number;
  /** Hard cap on the entire test suite run in ms. */
  globalTimeout?: number;
  /** Per-action defaults (timeouts, etc.) applied to all tests. */
  use?: MobilewrightUseOptions;
  /** Default options for expect() assertions. */
  expect?: MobilewrightExpectConfig;
  /** Maximum retry count for flaky tests. */
  retries?: number;
  /** Number of concurrent workers. */
  workers?: number | string;
  /** Run all tests in parallel. Default: false. */
  fullyParallel?: boolean;
  /** Fail the test run if test.only is present. Useful for CI. */
  forbidOnly?: boolean;
  /** Reporter to use. */
  reporter?: 'list' | 'html' | 'json' | 'junit' | Array<[string] | [string, unknown]>;
  /** Global setup file — runs once before all tests. */
  globalSetup?: string | string[];
  /** Global teardown file — runs once after all tests. */
  globalTeardown?: string | string[];
  /** Multi-device / multi-platform project matrix. */
  projects?: MobilewrightProjectConfig[];

  /** Capture git commit info and store it in report metadata. */
  captureGitInfo?: { commit?: boolean; diff?: boolean };
}

export function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function normalizeReporters(
  reporter: MobilewrightConfig['reporter'],
): Array<[string] | [string, unknown]> {
  if (!reporter) {
    return [];
  }
  if (typeof reporter === 'string') {
    return [[reporter]];
  }
  return reporter;
}

function injectUploadReporter(config: MobilewrightConfig): MobilewrightConfig {
  const driver = config.driver;
  if (!driver || (driver.type !== 'mobilenext' && driver.type !== 'mobile-use')) {
    return config;
  }
  const mobileNextDriver = driver as DriverConfigMobileNext;
  const testResult = mobileNextDriver.testResult;
  if (testResult?.uploadReport === 'off') {
    return config;
  }

  const jsonResultsPath = join(
    os.tmpdir(),
    `mobilewright-results-${randomUUID()}.json`,
  );
  const uploadReporterPath = _require.resolve('@mobilewright/driver-mobilenext/reporter');
  const reporters = normalizeReporters(config.reporter);

  return {
    ...config,
    captureGitInfo: { commit: true },
    reporter: [
      ...reporters,
      ['json', { outputFile: jsonResultsPath }],
      [uploadReporterPath, {
        apiKey: mobileNextDriver.apiKey ?? '',
        jsonResultsPath,
        testResult: mobileNextDriver.testResult ?? {},
        uploadTimeout: mobileNextDriver.uploadTimeout,
      }],
    ],
  };
}

/** Type-safe config helper for mobilewright.config.ts files. */
export function defineConfig(config: MobilewrightConfig): MobilewrightConfig {
  const ourSetup = _require.resolve('./device-pool/setup.js');
  const ourTeardown = _require.resolve('./device-pool/teardown.js');
  const userSetups = toArray(config.globalSetup);
  const userTeardowns = toArray(config.globalTeardown);

  const base: MobilewrightConfig = {
    workers: 1,
    ...config,
    globalSetup: userSetups.length > 0 ? [ourSetup, ...userSetups] : ourSetup,
    globalTeardown: userTeardowns.length > 0 ? [...userTeardowns, ourTeardown] : ourTeardown,
  };

  return injectUploadReporter(base);
}

const CONFIG_FILES = [
  'mobilewright.config.ts',
  'mobilewright.config.js',
  'mobilewright.config.mjs',
];

async function importConfig(fullPath: string): Promise<MobilewrightConfig> {
  const mod = await import(pathToFileURL(fullPath).href);
  let config = mod.default ?? mod;
  // Some loaders (e.g. Playwright's TS transpiler) double-wrap the default export
  if (config && typeof config === 'object' && 'default' in config) {
    config = config.default;
  }
  return config as MobilewrightConfig;
}

/**
 * Load mobilewright config.
 *
 * If `configFile` is provided, that file is loaded directly. Otherwise scans
 * `cwd` for mobilewright.config.{ts,js,mjs}. Returns empty config when nothing
 * is found.
 */
export async function loadConfig(
  cwd: string = process.cwd(),
  configFile?: string,
): Promise<MobilewrightConfig> {
  if (configFile) {
    const fullPath = isAbsolute(configFile) ? configFile : resolve(cwd, configFile);
    return importConfig(fullPath);
  }

  for (const name of CONFIG_FILES) {
    const fullPath = join(cwd, name);
    try {
      await access(fullPath);
      return importConfig(fullPath);
    } catch {
      continue;
    }
  }
  return {};
}
