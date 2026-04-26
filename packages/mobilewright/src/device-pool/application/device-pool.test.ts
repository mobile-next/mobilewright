import { test, expect } from '@playwright/test';
import { DevicePool } from './device-pool.js';
import type { DeviceAllocator, AllocateResult } from './ports.js';

function makeAllocator(devices: AllocateResult[]): DeviceAllocator {
  let i = 0;
  return {
    async allocate() {
      if (i >= devices.length) {
        throw new Error('no more fake devices');
      }
      return devices[i++];
    },
    async release() { /* no-op */ },
  };
}

test('first allocate spins up a slot and returns a handle', async () => {
  const allocator = makeAllocator([{ deviceId: 'd1', platform: 'ios' }]);
  const pool = new DevicePool({ allocator, maxSlots: 2 });

  const handle = await pool.allocate({ platform: 'ios' });

  expect(handle.deviceId).toBe('d1');
  expect(handle.platform).toBe('ios');
  expect(handle.allocationId).toMatch(/^alloc-/);
});

test('a released slot is reused by a subsequent allocate', async () => {
  const allocator = makeAllocator([{ deviceId: 'd1', platform: 'ios' }]);
  const pool = new DevicePool({ allocator, maxSlots: 2 });

  const first = await pool.allocate({ platform: 'ios' });
  await pool.release(first.allocationId);
  const second = await pool.allocate({ platform: 'ios' });

  expect(second.deviceId).toBe('d1');
  expect(second.allocationId).not.toBe(first.allocationId);
});
