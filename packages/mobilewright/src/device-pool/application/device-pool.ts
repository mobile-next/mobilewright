import { DeviceSlot } from '../domain/device-slot.js';
import { Allocation } from '../domain/allocation.js';
import { NoDeviceAvailableError } from './ports.js';
import type {
  AllocationCriteria,
  AllocationHandle,
  DeviceAllocator,
} from './ports.js';

export interface DevicePoolOptions {
  allocator: DeviceAllocator;
  maxSlots: number;
  /** Per-allocation timeout in ms. Default 600_000 (10 min). */
  allocationTimeoutMs?: number;
}

interface Waiter {
  criteria: AllocationCriteria;
  resolve: (handle: AllocationHandle) => void;
  reject: (err: Error) => void;
}

export class DevicePool {
  private readonly allocator: DeviceAllocator;
  private readonly maxSlots: number;
  private readonly allocationTimeoutMs: number;
  private readonly slots: DeviceSlot[] = [];
  private readonly allocations = new Map<string, Allocation>();
  private readonly waiters: Waiter[] = [];
  private readonly inFlightWaiters = new Set<Waiter>();
  private isShutdown = false;

  constructor(options: DevicePoolOptions) {
    this.allocator = options.allocator;
    this.maxSlots = options.maxSlots;
    this.allocationTimeoutMs = options.allocationTimeoutMs ?? 600_000;
  }

  allocate(criteria: AllocationCriteria): Promise<AllocationHandle> {
    if (this.isShutdown) {
      return Promise.reject(new Error('device pool is shut down'));
    }
    return new Promise<AllocationHandle>((resolve, reject) => {
      this.waiters.push({ criteria, resolve, reject });
      this.pump();
    });
  }

  async shutdown(): Promise<void> {
    this.isShutdown = true;

    const drained = this.waiters.splice(0);
    for (const waiter of drained) {
      waiter.reject(new Error('device pool shutdown'));
    }

    for (const waiter of this.inFlightWaiters) {
      waiter.reject(new Error('device pool shutdown'));
    }
    this.inFlightWaiters.clear();

    const releases: Promise<void>[] = [];
    for (const slot of this.slots) {
      if (slot.state !== 'allocating' && slot.deviceId !== undefined) {
        releases.push(this.allocator.release(slot.deviceId).catch(() => {}));
      }
    }
    await Promise.all(releases);
    this.slots.length = 0;
    this.allocations.clear();
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

  recordAppInstalled(allocationId: string, bundleId: string): void {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) {
      throw new Error(`unknown allocationId: ${allocationId}`);
    }
    this.slots[allocation.slotIndex].recordAppInstalled(bundleId);
  }

  isAppInstalled(allocationId: string, bundleId: string): boolean {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) {
      throw new Error(`unknown allocationId: ${allocationId}`);
    }
    return this.slots[allocation.slotIndex].isAppInstalled(bundleId);
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
    this.inFlightWaiters.add(waiter);

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), this.allocationTimeoutMs);

    const allocatePromise = this.allocator.allocate(
      waiter.criteria,
      this.takenDeviceIds(),
      abortController.signal,
    );
    allocatePromise.then(
      (result) => {
        clearTimeout(timer);
        if (!this.inFlightWaiters.delete(waiter)) {
          // Shutdown already rejected this waiter; just discard the device.
          this.allocator.release(result.deviceId).catch(() => {});
          return;
        }
        slot.markAvailable(result.deviceId, result.platform);
        this.waiters.unshift(waiter);
        this.pump();
      },
      (err: Error) => {
        clearTimeout(timer);
        if (!this.inFlightWaiters.delete(waiter)) {
          // Shutdown already rejected this waiter.
          return;
        }
        this.slots.splice(slotIndex, 1);
        if (abortController.signal.aborted) {
          waiter.reject(new Error(`device allocation timed out after ${this.allocationTimeoutMs}ms`));
          this.pump();
          return;
        }
        // NoDeviceAvailableError is a temporary condition: all matching devices
        // are currently taken. Re-queue the waiter so it is served when an
        // existing slot releases its device.
        if (err instanceof NoDeviceAvailableError) {
          this.waiters.push(waiter);
          // Only pump if a free slot appeared concurrently while we were allocating.
          const hasFreeSlot = this.findFreeSlot(waiter.criteria) !== -1;
          if (hasFreeSlot) {
            this.pump();
          }
          return;
        }
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
