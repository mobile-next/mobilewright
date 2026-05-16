import { DEFAULT_URL, MobilecliDriver } from '@mobilewright/driver-mobilecli';
import { ensureMobilecliReachable } from '../server.js';
import { MobilecliAllocator } from './adapters/mobilecli-allocator.js';
import { MobileUseAllocator } from './adapters/mobile-use-allocator.js';
import type { MobilewrightConfig, DriverConfigMobileUse } from '../config.js';
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

  if (driverType === 'mobile-use') {
    const mobileUseConfig = config.driver as DriverConfigMobileUse;
    const allocator = new MobileUseAllocator({
      driverOptions: {
        region: mobileUseConfig.region,
        apiKey: mobileUseConfig.apiKey,
      },
    });
    return { allocator };
  }

  throw new Error(`Unsupported driver type: "${driverType}". Supported types: "mobilecli", "mobile-use".`);
}
