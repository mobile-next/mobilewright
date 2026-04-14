import { access } from 'node:fs/promises';
import { join } from 'node:path';

// ─── Project ──────────────────────────────────────────────────────

export interface MobilewrightUseOptions {
  /** Platform for this project. */
  platform?: 'ios' | 'android';
  /** Device ID for this project. */
  deviceId?: string;
  /** Regex to match device name. */
  deviceName?: RegExp;
  /** App bundle ID for this project. */
  bundleId?: string;
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
  /** Default device ID. */
  deviceId?: string;
  /** Regex to match device name (e.g. /iPhone 17/). */
  deviceName?: RegExp;
  /** Default app bundle ID. */
  bundleId?: string;
  /** mobilecli server URL (use for remote servers). */
  url?: string;
  /** Path to mobilecli binary (if not on PATH). */
  mobilecliPath?: string;
  /** Auto-start mobilecli server if not running. Default: true. */
  autoStart?: boolean;

  // ── Test runner ─────────────────────────────────────────────
  /** Directory to search for test files. Default: config file directory. */
  testDir?: string;
  /** Glob patterns for test files. Default: **\/*.{test,spec}.{js,ts,mjs} */
  testMatch?: string | RegExp | Array<string | RegExp>;
  /** Glob patterns for files to skip during test discovery. */
  testIgnore?: string | RegExp | Array<string | RegExp>;
  /** Output directory for test artifacts. Default: test-results. */
  outputDir?: string;
  /** Global timeout for tests (ms). */
  timeout?: number;
  /** Global timeout for locators (ms). */
  actionTimeout?: number;
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
  globalSetup?: string;
  /** Global teardown file — runs once after all tests. */
  globalTeardown?: string;
  /** Multi-device / multi-platform project matrix. */
  projects?: MobilewrightProjectConfig[];
}

/** Type-safe config helper for mobilewright.config.ts files. */
export function defineConfig(config: MobilewrightConfig): MobilewrightConfig {
  return config;
}

const CONFIG_FILES = [
  'mobilewright.config.ts',
  'mobilewright.config.js',
  'mobilewright.config.mjs',
];

/**
 * Load mobilewright config from the project root.
 * Returns empty config if no config file found.
 */
export async function loadConfig(
  cwd: string = process.cwd(),
): Promise<MobilewrightConfig> {
  for (const name of CONFIG_FILES) {
    const fullPath = join(cwd, name);
    try {
      await access(fullPath);
      const mod = await import(fullPath);
      return (mod.default ?? mod) as MobilewrightConfig;
    } catch {
      continue;
    }
  }
  return {};
}
