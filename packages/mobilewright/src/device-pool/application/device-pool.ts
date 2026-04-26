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

export class DevicePool {
  private readonly allocator: DeviceAllocator;
  private readonly maxSlots: number;
  private readonly slots: DeviceSlot[] = [];
  private readonly allocations = new Map<string, Allocation>();

  constructor(options: DevicePoolOptions) {
    this.allocator = options.allocator;
    this.maxSlots = options.maxSlots;
  }

  async allocate(criteria: AllocationCriteria): Promise<AllocationHandle> {
    const slotIndex = await this.acquireSlot(criteria);
    const slot = this.slots[slotIndex];
    const deviceId = slot.deviceId;
    const platform = slot.platform;
    if (deviceId === undefined || platform === undefined) {
      throw new Error('internal: slot missing deviceId/platform');
    }

    const allocation = Allocation.create({ deviceId, platform, slotIndex });
    slot.claim(allocation.allocationId);
    this.allocations.set(allocation.allocationId, allocation);

    return {
      allocationId: allocation.allocationId,
      deviceId: allocation.deviceId,
      platform: allocation.platform,
    };
  }

  async release(allocationId: string): Promise<void> {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) {
      return;
    }
    this.allocations.delete(allocationId);
    this.slots[allocation.slotIndex].release();
  }

  private async acquireSlot(criteria: AllocationCriteria): Promise<number> {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.state === 'available' && slotMatches(slot, criteria)) {
        return i;
      }
    }
    if (this.slots.length < this.maxSlots) {
      const newSlot = new DeviceSlot();
      this.slots.push(newSlot);
      const slotIndex = this.slots.length - 1;
      const result = await this.allocator.allocate(criteria, this.takenDeviceIds());
      newSlot.markAvailable(result.deviceId, result.platform);
      return slotIndex;
    }
    throw new Error('no free slot and pool at max capacity (queueing not yet implemented)');
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
