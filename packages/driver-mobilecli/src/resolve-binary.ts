import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Walk up from cwd looking for `node_modules/@mobilenext/mobilecli`.
 * Uses cwd instead of import.meta.url so it works when Playwright
 * transpiles the source to CJS.
 */
export function resolveMobilecliBinary(): string {
  let dir = process.cwd();
  while (true) {
    const candidate = join(dir, 'node_modules', '@mobilenext', 'mobilecli');
    if (existsSync(join(candidate, 'package.json'))) {
      const binary = process.platform === 'darwin'
        ? (process.arch === 'arm64' ? 'mobilecli-darwin-arm64' : 'mobilecli-darwin-amd64')
        : process.platform === 'linux'
          ? (process.arch === 'arm64' ? 'mobilecli-linux-arm64' : 'mobilecli-linux-amd64')
          : null;
      if (!binary) throw new Error(`Unsupported platform: ${process.platform}-${process.arch}`);
      return join(candidate, 'bin', binary);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('@mobilenext/mobilecli is not installed');
}
