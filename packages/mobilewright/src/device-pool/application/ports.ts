import type { Platform } from '@mobilewright/protocol';

export interface AllocationCriteria {
  platform?: Platform;
  /** Serialized regex source — `RegExp.prototype.source`. The allocator reconstructs `new RegExp(...)`. */
  deviceNamePattern?: string;
  deviceId?: string;
}

export interface AllocateResult {
  deviceId: string;
  platform: Platform;
}

/**
 * Driver-specific allocator. Implementations are at the outer adapter layer.
 * `takenDeviceIds` lets the allocator avoid handing out devices the pool already has.
 */
export interface DeviceAllocator {
  allocate(
    criteria: AllocationCriteria,
    takenDeviceIds: ReadonlySet<string>,
    signal?: AbortSignal,
  ): Promise<AllocateResult>;

  /** Called at pool shutdown for every slot in `available` or `allocated` state. */
  release(deviceId: string): Promise<void>;
}

export interface AllocationHandle {
  allocationId: string;
  deviceId: string;
  platform: Platform;
}

/**
 * Port consumed by the test fixture. The HTTP adapter is one implementation.
 */
export interface DevicePoolClient {
  allocate(criteria: AllocationCriteria): Promise<AllocationHandle>;
  release(allocationId: string): Promise<void>;
  hasInstalled(allocationId: string, bundleId: string): Promise<boolean>;
  recordInstalled(allocationId: string, bundleId: string): Promise<void>;
}
