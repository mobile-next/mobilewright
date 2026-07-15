import { DEFAULT_URL, MobilecliDriver } from '@mobilewright/driver-mobilecli';
import { ensureMobilecliReachable } from '../server.js';
import { MobilecliAllocator } from './adapters/mobilecli-allocator.js';
import { MobileNextAllocator } from './adapters/mobilenext-allocator.js';
import { SauceLabsAllocator } from './adapters/saucelabs-allocator.js';
import type { MobilewrightConfig, DriverConfigMobileNext, DriverConfigSauceLabs } from '../config.js';
import type { DeviceAllocator } from './application/ports.js';

export interface AllocatorResult {
  allocator: DeviceAllocator;
  serverProcess?: { kill: () => void };
}

export async function createAllocator(config: MobilewrightConfig): Promise<AllocatorResult> {
  const driverType = config.driver?.type ?? 'mobilecli';

  if (driverType === 'mobilecli') {
    const url = config.url ?? DEFAULT_URL;
    const ensured = await ensureMobilecliReachable(url, { autoStart: config.autoStart ?? true });
    const allocator = new MobilecliAllocator({ driver: new MobilecliDriver({ url }) });
    return { allocator, serverProcess: ensured.serverProcess ?? undefined };
  }

  if (driverType === 'mobilenext' || driverType === 'mobile-use') {
    const mobileNextConfig = config.driver as DriverConfigMobileNext;
    const allocator = new MobileNextAllocator({
      apiKey: mobileNextConfig.apiKey ?? '',
      allocationTimeout: mobileNextConfig.allocationTimeout,
    });
    return { allocator };
  }

  if (driverType === 'saucelabs') {
    const slConfig = config.driver as DriverConfigSauceLabs;
    const allocator = new SauceLabsAllocator({
      driverOptions: {
        username: slConfig.username,
        accessKey: slConfig.accessKey,
        region: slConfig.region,
        allocationTimeout: slConfig.allocationTimeout,
        sessionDuration: slConfig.sessionDuration,
        iosWdaBundleId: slConfig.iosWdaBundleId,
      },
    });
    return { allocator };
  }

  throw new Error(`Unsupported driver type: "${driverType}". Supported types: "mobilecli", "mobilenext", "saucelabs".`);
}
