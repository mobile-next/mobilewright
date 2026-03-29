import { access } from 'node:fs/promises';
import { join } from 'node:path';

export interface MobilewrightConfig {
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
  /** Global timeout for locators (ms). */
  timeout?: number;
  /** Auto-start mobilecli server if not running. Default: true. */
  autoStart?: boolean;
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
