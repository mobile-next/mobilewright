import createDebug from 'debug';
import { MobileNextDriver } from '@mobilewright/driver-mobilenext';
import type { MobileNextDriverOptions } from '@mobilewright/driver-mobilenext';
import type { AllocationCriteria, AllocateResult, DeviceAllocator } from '../application/ports.js';

const debug = createDebug('mw:device-pool:mobilenext');

export interface MobileNextAllocatorOptions {
  driverOptions: MobileNextDriverOptions;
}

export class MobileNextAllocator implements DeviceAllocator {
  private readonly driverOptions: MobileNextDriverOptions;
  private readonly activeDrivers = new Map<string, MobileNextDriver>();

  constructor(options: MobileNextAllocatorOptions) {
    this.driverOptions = options.driverOptions;
  }

  async allocate(criteria: AllocationCriteria): Promise<AllocateResult> {
    debug('allocating device (criteria=%o)', criteria);
    const driver = new MobileNextDriver(this.driverOptions);
    const session = await driver.connect({
      platform: criteria.platform ?? 'ios',
      deviceName: criteria.deviceNamePattern ? new RegExp(criteria.deviceNamePattern) : undefined,
      deviceId: criteria.deviceId,
    });
    this.activeDrivers.set(session.deviceId, driver);
    debug('allocated device %s (platform=%s)', session.deviceId, session.platform);
    const info = driver.deviceInfo;
    return { deviceId: session.deviceId, platform: session.platform, driver: 'mobilenext', model: info?.model, osVersion: info?.osVersion, type: info?.type };
  }

  async release(deviceId: string): Promise<void> {
    debug('releasing device %s', deviceId);
    const driver = this.activeDrivers.get(deviceId);
    if (driver) {
      this.activeDrivers.delete(deviceId);
      await driver.disconnect();
      debug('released device %s', deviceId);
    }
  }
}
