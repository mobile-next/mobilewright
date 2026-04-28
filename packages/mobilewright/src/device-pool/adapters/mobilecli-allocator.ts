import type { DeviceInfo, Platform } from '@mobilewright/protocol';
import { NoDeviceAvailableError } from '../application/ports.js';
import type { AllocationCriteria, AllocateResult, DeviceAllocator } from '../application/ports.js';

interface ListDevicesOpts {
  platform?: Platform;
}

interface ListDevicesDriver {
  listDevices(opts?: ListDevicesOpts): Promise<DeviceInfo[]>;
}

export interface MobilecliAllocatorOptions {
  driver: ListDevicesDriver;
}

export class MobilecliAllocator implements DeviceAllocator {
  private readonly driver: ListDevicesDriver;

  constructor(options: MobilecliAllocatorOptions) {
    this.driver = options.driver;
  }

  async allocate(
    criteria: AllocationCriteria,
    takenDeviceIds: ReadonlySet<string>,
  ): Promise<AllocateResult> {
    const devices = await this.driver.listDevices(
      criteria.platform ? { platform: criteria.platform } : undefined,
    );

    const namePattern = criteria.deviceNamePattern
      ? new RegExp(criteria.deviceNamePattern)
      : undefined;

    const match = devices
      .filter((d) => d.state === 'online')
      .filter((d) => !takenDeviceIds.has(d.id))
      .filter((d) => !criteria.deviceId || d.id === criteria.deviceId)
      .filter((d) => !namePattern || namePattern.test(d.name))
      .at(0);

    if (!match) {
      throw new NoDeviceAvailableError(
        `no online device available matching criteria ${JSON.stringify(criteria)}`,
      );
    }
    return { deviceId: match.id, platform: match.platform };
  }

  async release(_deviceId: string): Promise<void> {
    // mobilecli devices are local; nothing to release.
  }
}
