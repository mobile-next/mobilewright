import { MobileUseDriver } from '@mobilewright/driver-mobile-use';
import type { MobileUseDriverOptions } from '@mobilewright/driver-mobile-use';
import type { AllocationCriteria, AllocateResult, DeviceAllocator } from '../application/ports.js';

export interface MobileUseAllocatorOptions {
  driverOptions: MobileUseDriverOptions;
}

export class MobileUseAllocator implements DeviceAllocator {
  private readonly driverOptions: MobileUseDriverOptions;
  private readonly activeDrivers = new Map<string, MobileUseDriver>();

  constructor(options: MobileUseAllocatorOptions) {
    this.driverOptions = options.driverOptions;
  }

  async allocate(criteria: AllocationCriteria): Promise<AllocateResult> {
    const driver = new MobileUseDriver(this.driverOptions);
    const session = await driver.connect({
      platform: criteria.platform ?? 'ios',
      deviceName: criteria.deviceNamePattern ? new RegExp(criteria.deviceNamePattern) : undefined,
      deviceId: criteria.deviceId,
    });
    this.activeDrivers.set(session.deviceId, driver);
    return { deviceId: session.deviceId, platform: session.platform };
  }

  async release(deviceId: string): Promise<void> {
    const driver = this.activeDrivers.get(deviceId);
    if (driver) {
      this.activeDrivers.delete(deviceId);
      await driver.disconnect();
    }
  }
}
