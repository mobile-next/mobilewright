import { DeviceSlot } from '../domain/device-slot.js';
import { Allocation } from '../domain/allocation.js';
import type {
  AllocationCriteria,
  AllocationHandle,
  DeviceAllocator,
} from './ports.js';

export interface DevicePoolOptions {
  allocator: DeviceAllocator;
  maxSlots: number;
}

interface Waiter {
  criteria: AllocationCriteria;
  resolve: (handle: AllocationHandle) => void;
  reject: (err: Error) => void;
}

export class DevicePool {
  private readonly allocator: DeviceAllocator;
  private readonly maxSlots: number;
  private readonly slots: DeviceSlot[] = [];
  private readonly allocations = new Map<string, Allocation>();
  private readonly waiters: Waiter[] = [];

  constructor(options: DevicePoolOptions) {
    this.allocator = options.allocator;
    this.maxSlots = options.maxSlots;
  }

  allocate(criteria: AllocationCriteria): Promise<AllocationHandle> {
    return new Promise<AllocationHandle>((resolve, reject) => {
      this.waiters.push({ criteria, resolve, reject });
      this.pump();
    });
  }

  async release(allocationId: string): Promise<void> {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) {
      return;
    }
    this.allocations.delete(allocationId);
    this.slots[allocation.slotIndex].release();
    this.pump();
  }

  private pump(): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters[0];
      const slotIndex = this.findFreeSlot(waiter.criteria);
      if (slotIndex !== -1) {
        this.waiters.shift();
        this.grantSlot(slotIndex, waiter);
        continue;
      }
      if (this.slots.length < this.maxSlots) {
        this.waiters.shift();
        this.startAllocationForWaiter(waiter);
        continue;
      }
      return;
    }
  }

  private findFreeSlot(criteria: AllocationCriteria): number {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.state === 'available' && slotMatches(slot, criteria)) {
        return i;
      }
    }
    return -1;
  }

  private grantSlot(slotIndex: number, waiter: Waiter): void {
    const slot = this.slots[slotIndex];
    const deviceId = slot.deviceId;
    const platform = slot.platform;
    if (deviceId === undefined || platform === undefined) {
      waiter.reject(new Error('internal: slot missing deviceId/platform'));
      return;
    }
    const allocation = Allocation.create({ deviceId, platform, slotIndex });
    slot.claim(allocation.allocationId);
    this.allocations.set(allocation.allocationId, allocation);
    waiter.resolve({
      allocationId: allocation.allocationId,
      deviceId: allocation.deviceId,
      platform: allocation.platform,
    });
  }

  private startAllocationForWaiter(waiter: Waiter): void {
    const slot = new DeviceSlot();
    this.slots.push(slot);
    const slotIndex = this.slots.length - 1;
    const allocatePromise = this.allocator.allocate(waiter.criteria, this.takenDeviceIds());
    allocatePromise.then(
      (result) => {
        slot.markAvailable(result.deviceId, result.platform);
        this.waiters.unshift(waiter);
        this.pump();
      },
      (err: Error) => {
        this.slots.splice(slotIndex, 1);
        waiter.reject(err);
        this.pump();
      },
    );
  }

  private takenDeviceIds(): Set<string> {
    const ids = new Set<string>();
    for (const slot of this.slots) {
      if (slot.deviceId !== undefined) {
        ids.add(slot.deviceId);
      }
    }
    return ids;
  }
}

function slotMatches(slot: DeviceSlot, criteria: AllocationCriteria): boolean {
  if (criteria.platform && slot.platform !== criteria.platform) {
    return false;
  }
  if (criteria.deviceId && slot.deviceId !== criteria.deviceId) {
    return false;
  }
  return true;
}
