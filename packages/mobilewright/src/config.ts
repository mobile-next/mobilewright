import { access } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import type { MobilewrightDriver } from '@mobilewright/protocol';
import { MobilecliDriver } from '@mobilewright/driver-mobilecli';
import { MobileNextDriver, type MobileNextDriverOptions } from '@mobilewright/driver-mobilenext';
import { setActiveDriver } from './driver-registry.js';

const _require = createRequire(import.meta.url);

type ReporterEntry = [string] | [string, unknown];

/** Pre-0.0.53 driver config shape: `{ type: 'mobilenext' | 'mobilecli', ...options }`. */
type LegacyDriverConfig = { type: string } & Record<string, unknown>;

// ─── Project ──────────────────────────────────────────────────────

export interface MobilewrightUseOptions {
  /** Platform for this project. */
  platform?: 'ios' | 'android';
  /** Specific device identifier (local drivers only). Overrides the top-level deviceId for this project. */
  deviceId?: string;
  /** Regex to match device name. */
  deviceName?: RegExp;
  /** Restrict to simulators, emulators, or real devices. */
  deviceType?: 'simulator' | 'emulator' | 'real';
  /** OS version constraint, e.g. "17" (any 17.x), "26.0" (exactly 26.0) or ">=17 <19". */
  osVersion?: string;
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

export interface MobilewrightConfig {
  // ── Mobile-specific ─────────────────────────────────────────
  /** Default platform. */
  platform?: 'ios' | 'android';
  /** Specific device identifier (local drivers only). */
  deviceId?: string;
  /** Regex to match device name (e.g. /iPhone 17/). */
  deviceName?: RegExp;
  /** Restrict to simulators, emulators, or real devices. */
  deviceType?: 'simulator' | 'emulator' | 'real';
  /** OS version constraint, e.g. "17" (any 17.x), "26.0" (exactly 26.0) or ">=17 <19". */
  osVersion?: string;
  /** Default app bundle ID. */
  bundleId?: string;
  /** App paths (APK/IPA) to install on the device before launching. */
  installApps?: string | string[];
  /** Automatically launch the app after connecting. Default: true. */
  autoAppLaunch?: boolean;
  /** Attach the accessibility tree as JSON to the test report. 'on-failure' attaches on test failure, 'off' disables. Default: 'off'. */
  viewTree?: 'on-failure' | 'off';
  /** Driver instance to use, e.g. `new MobileNextDriver({ apiKey })`. Default: `new MobilecliDriver()`. */
  driver?: MobilewrightDriver;

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

/** Normalizes `MobilewrightConfig['reporter']` into Playwright's array-of-tuples shape. */
function normalizeReporters(reporter: MobilewrightConfig['reporter']): ReporterEntry[] {
  if (!reporter) {
    return [];
  }
  if (typeof reporter === 'string') {
    return [[reporter]];
  }
  return reporter;
}

/**
 * Mirrors Playwright's own resolution of the JSON reporter's output file from
 * env vars, for a `json` reporter entry that has no explicit `outputFile`:
 * `PLAYWRIGHT_JSON_OUTPUT_FILE`, else `PLAYWRIGHT_JSON_OUTPUT_DIR` /
 * `PLAYWRIGHT_JSON_OUTPUT_NAME` (dir defaults to cwd). Returns undefined when
 * none are set, meaning Playwright would write to stdout instead of a file.
 */
function resolvePlaywrightJsonEnvPath(): string | undefined {
  const explicitFile = process.env['PLAYWRIGHT_JSON_OUTPUT_FILE'];
  if (explicitFile) {
    return resolve(process.cwd(), explicitFile);
  }
  const name = process.env['PLAYWRIGHT_JSON_OUTPUT_NAME'];
  if (!name) {
    return undefined;
  }
  const dir = process.env['PLAYWRIGHT_JSON_OUTPUT_DIR'] ?? '.';
  return resolve(process.cwd(), dir, name);
}

/**
 * Injects the observer shim reporter (and, when needed, a `json` reporter to
 * feed it) into `config.reporter` — only when the configured driver exposes
 * a `TestObserver`. See the JSON-path merge rules in
 * docs/superpowers/specs/2026-08-13-driver-test-observer-design.md.
 */
function injectObserverReporter(config: MobilewrightConfig): MobilewrightConfig {
  if (!config.driver?.observer) {
    return config;
  }

  const userReporters = normalizeReporters(config.reporter);
  const jsonEntry = userReporters.find(([name]) => name === 'json');

  let jsonResultsPath: string | undefined;
  if (jsonEntry) {
    const jsonOptions = jsonEntry[1] as { outputFile?: string } | undefined;
    const userOutputFile = jsonOptions?.outputFile;
    if (userOutputFile === undefined) {
      jsonResultsPath = resolvePlaywrightJsonEnvPath();
    } else if (isAbsolute(userOutputFile)) {
      jsonResultsPath = userOutputFile;
    }
    // A relative outputFile is resolved by Playwright against the config
    // directory, which is unknowable here — fall through and write our own
    // copy instead of guessing.
  }

  let injectedJson: ReporterEntry | undefined;
  let cleanupJsonResults = false;
  if (jsonResultsPath === undefined) {
    // mkdtemp creates the directory with 0o700 — the report stays private on
    // shared machines. The shim removes it after the run.
    jsonResultsPath = join(mkdtempSync(join(tmpdir(), 'mobilewright-results-')), 'results.json');
    injectedJson = ['json', { outputFile: jsonResultsPath }];
    cleanupJsonResults = true;
  }

  const baseReporters: ReporterEntry[] = userReporters.length > 0 ? userReporters : [['list']];
  const shimEntry: ReporterEntry = [
    _require.resolve('./observer-reporter.js'),
    { jsonResultsPath, cleanupJsonResults },
  ];

  return {
    ...config,
    captureGitInfo: { commit: true, ...config.captureGitInfo },
    reporter: [...baseReporters, ...(injectedJson ? [injectedJson] : []), shimEntry],
  };
}

function isDriverInstance(driver: unknown): driver is MobilewrightDriver {
  return typeof (driver as MobilewrightDriver | undefined)?.allocate === 'function';
}

/** Converts a legacy `{ type, ... }` driver config object into a driver instance, with a deprecation warning. */
function resolveLegacyDriver(legacy: LegacyDriverConfig): MobilewrightDriver {
  const { type, ...options } = legacy;
  console.warn(
    `[mobilewright] Deprecated: \`driver: { type: '${type}', ... }\` config objects will stop working in a future release — ` +
    'pass a driver instance instead, e.g. `new MobileNextDriver({ apiKey })`.',
  );
  switch (type) {
    case 'mobilenext':
    case 'mobile-use':
      return new MobileNextDriver(options as MobileNextDriverOptions);
    case 'mobilecli':
      return new MobilecliDriver(options);
    default:
      throw new Error(
        `defineConfig: unknown driver type "${type}". Pass a driver instance instead, e.g. \`new MobileNextDriver({ apiKey })\`.`,
      );
  }
}

/** Type-safe config helper for mobilewright.config.ts files. */
export function defineConfig(config: MobilewrightConfig): MobilewrightConfig {
  let driver = config.driver;
  if (driver && !isDriverInstance(driver)) {
    driver = resolveLegacyDriver(driver as unknown as LegacyDriverConfig);
  }
  setActiveDriver(driver);

  const ourSetup = _require.resolve('./device-pool/setup.js');
  const ourTeardown = _require.resolve('./device-pool/teardown.js');
  const userSetups = toArray(config.globalSetup);
  const userTeardowns = toArray(config.globalTeardown);

  const base: MobilewrightConfig = {
    workers: 1,
    ...config,
    ...(driver && { driver }),
    globalSetup: userSetups.length > 0 ? [ourSetup, ...userSetups] : ourSetup,
    globalTeardown: userTeardowns.length > 0 ? [...userTeardowns, ourTeardown] : ourTeardown,
  };

  return injectObserverReporter(base);
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
