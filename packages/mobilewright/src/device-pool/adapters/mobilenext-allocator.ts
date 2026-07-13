import createDebug from 'debug';
import { FleetApiClient } from '@mobilewright/driver-mobilenext';
import type { DeviceFilter } from '@mobilewright/driver-mobilenext';
import type { DeviceType, Platform } from '@mobilewright/protocol';
import type { AllocationCriteria, AllocateResult, DeviceAllocator } from '../application/ports.js';

const debug = createDebug('mw:device-pool:mobilenext');

const VALID_DEVICE_TYPES = new Set<string>(['real', 'simulator', 'emulator']);

function toDeviceType(value?: string): DeviceType | undefined {
  return value && VALID_DEVICE_TYPES.has(value) ? (value as DeviceType) : undefined;
}

function buildFilters(criteria: AllocationCriteria): DeviceFilter[] {
  const filters: DeviceFilter[] = [
    { attribute: 'platform', operator: 'EQUALS', value: criteria.platform ?? 'ios' },
  ];
  if (criteria.deviceNamePattern) {
    filters.push({ attribute: 'name', operator: 'CONTAINS', value: criteria.deviceNamePattern });
  }
  return filters;
}

export interface MobileNextAllocatorOptions {
  apiKey: string;
  apiUrl?: string;
  allocationTimeout?: number;
  /** Injected for testing. */
  client?: FleetApiClient;
}

/**
 * Allocates devices through the fleet sessions REST API. One session is created per test run
 * (lazily, on first allocation) and every device allocation lives under it. A device is addressed
 * by its physical serial, which is also the id the RPC driver drives with.
 */
export class MobileNextAllocator implements DeviceAllocator {
  private readonly client: FleetApiClient;
  private sessionPromise: Promise<string> | null = null;
  // serial -> the session it was allocated in, needed to release it later.
  private readonly sessionBySerial = new Map<string, string>();

  constructor(options: MobileNextAllocatorOptions) {
    this.client = options.client ?? new FleetApiClient({
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
      allocationTimeout: options.allocationTimeout,
    });
  }

  async allocate(criteria: AllocationCriteria): Promise<AllocateResult> {
    const sessionId = await this.getSession();
    const filters = buildFilters(criteria);
    debug('allocating device (session=%s, filters=%o)', sessionId, filters);

    const device = await this.client.allocateDevice(sessionId, filters);
    const serial = device.info.serial;
    if (!serial) {
      throw new Error(`Device allocation ${device.id} became in_use without a serial`);
    }
    this.sessionBySerial.set(serial, sessionId);
    debug('allocated device %s (allocation=%s, platform=%s)', serial, device.id, device.info.platform);

    return {
      deviceId: serial,
      platform: device.info.platform === 'android' ? 'android' : ('ios' as Platform),
      driver: 'mobilenext',
      model: device.info.name,
      osVersion: device.info.osVersion,
      type: toDeviceType(device.info.type),
    };
  }

  async release(deviceId: string): Promise<void> {
    const sessionId = this.sessionBySerial.get(deviceId);
    if (!sessionId) {
      return;
    }
    this.sessionBySerial.delete(deviceId);
    debug('releasing device %s (session=%s)', deviceId, sessionId);
    await this.client.releaseDevice(sessionId, deviceId);
    debug('released device %s', deviceId);
  }

  // Cache the promise, not the id, so concurrent first allocations share a single createSession.
  private getSession(): Promise<string> {
    if (!this.sessionPromise) {
      this.sessionPromise = this.client.createSession();
    }
    return this.sessionPromise;
  }
}
