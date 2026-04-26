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

    for (const device of devices) {
      if (device.state !== 'online') {
        continue;
      }
      if (takenDeviceIds.has(device.id)) {
        continue;
      }
      if (criteria.platform && device.platform !== criteria.platform) {
        continue;
      }
      if (criteria.deviceId && device.id !== criteria.deviceId) {
        continue;
      }
      if (namePattern && !namePattern.test(device.name)) {
        continue;
      }
      return { deviceId: device.id, platform: device.platform };
    }

    throw new NoDeviceAvailableError(
      `no online device available matching criteria ${JSON.stringify(criteria)}`,
    );
  }

  async release(_deviceId: string): Promise<void> {
    // mobilecli devices are local; nothing to release.
  }
}
