import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';

/**
 * Resolve the mobilecli binary using Node's module resolution so it works
 * from npx caches, global installs, and local node_modules alike.
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

  const _require = createRequire(import.meta.url);
  const pkgJson = _require.resolve('mobilecli/package.json');
  return join(dirname(pkgJson), 'bin', binary);
}
