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
  // The fleet API requires exactly one platform filter, so a missing platform is a caller error —
  // fail loudly instead of silently constraining every allocation to iOS.
  if (!criteria.platform) {
    throw new Error('MobileNextAllocator requires a platform ("ios" or "android") to allocate a device');
  }
  // The fleet filter DSL has no exact-device selector (only platform/type/name/version), so a
  // pinned deviceId cannot be honored. Reject it rather than silently allocating a different
  // device — deviceId is for local drivers; select a cloud device by deviceName instead.
  if (criteria.deviceId) {
    throw new Error(
      `MobileNextAllocator cannot pin a specific deviceId ("${criteria.deviceId}"): the fleet does not support exact-device selection. Remove deviceId or filter by deviceName.`,
    );
  }
  const filters: DeviceFilter[] = [
    { attribute: 'platform', operator: 'EQUALS', value: criteria.platform },
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

  // takenDeviceIds is unused: the fleet allocates a fresh device server-side per call and the
  // filter DSL has no "exclude id" operator, so the pool's local set is both redundant and
  // inexpressible here. signal is threaded through so a pool shutdown or allocation timeout
  // cancels an in-flight provisioning wait.
  async allocate(
    criteria: AllocationCriteria,
    takenDeviceIds: ReadonlySet<string>,
    signal?: AbortSignal,
  ): Promise<AllocateResult> {
    const filters = buildFilters(criteria);
    const sessionId = await this.getSession();
    debug('allocating device (session=%s, filters=%o)', sessionId, filters);

    const device = await this.client.allocateDevice(sessionId, filters, signal);
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
  // On failure, clear the cache so a later allocate() can retry instead of inheriting the rejection.
  private getSession(): Promise<string> {
    if (!this.sessionPromise) {
      this.sessionPromise = this.client.createSession().catch((err: unknown) => {
        this.sessionPromise = null;
        throw err;
      });
    }
    return this.sessionPromise;
  }
}
