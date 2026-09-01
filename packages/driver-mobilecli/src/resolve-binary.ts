import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';

interface PlatformBinary {
  packageName: string;
  binaryName: string;
}

/**
 * Map a platform/arch pair to the @mobilenext platform package that ships
 * the mobilecli binary, and the binary's file name inside that package.
 */
export function getPlatformBinary(platform: string, arch: string): PlatformBinary {
  let name: string;
  switch (`${platform}-${arch}`) {
    case 'darwin-arm64':
      name = 'mobilecli-darwin-arm64';
      break;
    case 'darwin-x64':
      name = 'mobilecli-darwin-amd64';
      break;
    case 'linux-arm64':
      name = 'mobilecli-linux-arm64';
      break;
    case 'linux-x64':
      name = 'mobilecli-linux-amd64';
      break;
    case 'win32-arm64':
      name = 'mobilecli-windows-arm64';
      break;
    case 'win32-x64':
      name = 'mobilecli-windows-amd64';
      break;
    default:
      throw new Error(`Unsupported platform: ${platform}-${arch}`);
  }

  return {
    packageName: `@mobilenext/${name}`,
    binaryName: platform === 'win32' ? `${name}.exe` : name,
  };
}

/**
 * Resolve the mobilecli binary using Node's module resolution so it works
 * from npx caches, global installs, and local node_modules alike. The binary
 * ships in a per-platform optionalDependency of mobilecli, so it is resolved
 * from mobilecli's own location.
 *
 * @param explicitPath Use this path directly instead of resolving one.
 */
export function resolveMobilecliBinary(explicitPath?: string): string {
  if (explicitPath) {
    return explicitPath;
  }

  const { packageName, binaryName } = getPlatformBinary(process.platform, process.arch);
  const _require = createRequire(import.meta.url);
  const mobilecliPkg = _require.resolve('mobilecli/package.json');
  const requireFromMobilecli = createRequire(mobilecliPkg);

  let platformPkg: string;
  try {
    platformPkg = requireFromMobilecli.resolve(`${packageName}/package.json`);
  } catch {
    throw new Error(`Failed to find ${packageName}. Please reinstall mobilecli.`);
  }

  return join(dirname(platformPkg), binaryName);
}
