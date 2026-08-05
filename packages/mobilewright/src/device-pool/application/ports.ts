import type { AllocatedDevice, AllocationCriteria, DeviceType, Platform } from '@mobilewright/protocol';

export { NoDeviceAvailableError } from '@mobilewright/protocol';
export type { AllocatedDevice, AllocationCriteria };

export interface AllocationHandle {
  allocationId: string;
  deviceId: string;
  platform: Platform;
  driver?: string;
  model?: string;
  osVersion?: string;
  type?: DeviceType;
}

/**
 * Port consumed by the test fixture. The HTTP adapter is one implementation.
 */
export interface DevicePoolClient {
  allocate(criteria: AllocationCriteria): Promise<AllocationHandle>;
  release(allocationId: string): Promise<void>;
  isAppInstalled(allocationId: string, bundleId: string): Promise<boolean>;
  recordAppInstalled(allocationId: string, bundleId: string): Promise<void>;
}
