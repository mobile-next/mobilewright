import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

/**
 * Resolve the mobilecli binary.
 *
 * Resolution order:
 *   1. npm package in node_modules (fastest, version-pinned)
 *   2. `mobilecli` found on PATH via `which` (macOS/Linux) or `where` (Windows)
 *
 * This lets users who installed mobilecli globally (Homebrew, `npm install -g
 * mobilecli`, CI system images, etc.) use mobilewright without also adding
 * mobilecli as a local dependency.
 */
export function resolveMobilecliBinary(): string {
  let binary: string;
  switch (`${process.platform}-${process.arch}`) {
    case 'darwin-arm64':
      binary = 'mobilecli-darwin-arm64';
      break;
    case 'darwin-x64':
      binary = 'mobilecli-darwin-amd64';
      break;
    case 'linux-arm64':
      binary = 'mobilecli-linux-arm64';
      break;
    case 'linux-x64':
      binary = 'mobilecli-linux-amd64';
      break;
    case 'win32-x64':
      binary = 'mobilecli-windows-amd64.exe';
      break;
    default:
      throw new Error(`Unsupported platform: ${process.platform}-${process.arch}`);
  }

  // 1. Try npm package resolution first.
  try {
    const _require = createRequire(import.meta.url);
    const pkgJson = _require.resolve('mobilecli/package.json');
    return join(dirname(pkgJson), 'bin', binary);
  } catch {
    // Package not in local node_modules — fall through to PATH lookup.
  }

  // 2. Fall back to finding `mobilecli` on the system PATH.
  try {
    const cmd = process.platform === 'win32' ? 'where mobilecli' : 'which mobilecli';
    const pathResult = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    // `where` on Windows can return multiple lines; take the first hit.
    const resolvedPath = pathResult.split(/\r?\n/)[0].trim();
    if (resolvedPath) {
      return resolvedPath;
    }
  } catch {
    // Not on PATH either — fall through to the error below.
  }

  throw new Error(
    'mobilecli not found. Install it with:\n' +
    '  npm install mobilecli\n' +
    'or download it from https://github.com/mobile-next/mobilecli'
  );
}
