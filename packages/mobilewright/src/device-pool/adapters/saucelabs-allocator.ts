import createDebug from 'debug';
import { SauceLabsDriver } from '@mobilewright/driver-saucelabs';
import type { SauceLabsDriverOptions } from '@mobilewright/driver-saucelabs';
import type { AllocationCriteria, AllocateResult, DeviceAllocator } from '../application/ports.js';

const debug = createDebug('mw:device-pool:saucelabs');

export interface SauceLabsAllocatorOptions {
  driverOptions: SauceLabsDriverOptions;
}

export class SauceLabsAllocator implements DeviceAllocator {
  private readonly driverOptions: SauceLabsDriverOptions;
  private readonly sessionsByDeviceId = new Map<string, string>();

  constructor(options: SauceLabsAllocatorOptions) {
    this.driverOptions = options.driverOptions;
  }

  // Reserves the device via a session-only allocation so the worker that
  // actually runs the test can attach to this same session
  async allocate(criteria: AllocationCriteria): Promise<AllocateResult> {
    debug('allocating device (criteria=%o)', criteria);
    const platform = criteria.platform ?? 'android';
    const { sessionId, deviceId } = await SauceLabsDriver.allocateSession(this.driverOptions, {
      platform,
      deviceName: criteria.deviceNamePattern ? new RegExp(criteria.deviceNamePattern) : undefined,
    });
    this.sessionsByDeviceId.set(deviceId, sessionId);
    debug('allocated device %s (session=%s)', deviceId, sessionId);
    return { deviceId, platform, driver: 'saucelabs', sessionId };
  }

  async release(deviceId: string): Promise<void> {
    const sessionId = this.sessionsByDeviceId.get(deviceId);
    if (sessionId) {
      debug('releasing device %s (session=%s)', deviceId, sessionId);
      await SauceLabsDriver.releaseSession(this.driverOptions, sessionId);
      this.sessionsByDeviceId.delete(deviceId);
      debug('released device %s', deviceId);
    }
  }
}
