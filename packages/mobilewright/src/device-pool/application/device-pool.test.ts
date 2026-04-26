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

test('a second concurrent allocate when no free slot triggers parallel allocation', async () => {
  let calls = 0;
  const allocator: DeviceAllocator = {
    async allocate(): Promise<AllocateResult> {
      calls++;
      return { deviceId: `d${calls}`, platform: 'ios' };
    },
    async release() {},
  };
  const pool = new DevicePool({ allocator, maxSlots: 2 });

  const [a, b] = await Promise.all([
    pool.allocate({ platform: 'ios' }),
    pool.allocate({ platform: 'ios' }),
  ]);

  const ids = [a.deviceId, b.deviceId].sort();
  expect(ids).toEqual(['d1', 'd2']);
  expect(calls).toBe(2);
});

test('waiter resolves when an existing allocated slot is released', async () => {
  const allocator = makeAllocator([{ deviceId: 'd1', platform: 'ios' }]);
  const pool = new DevicePool({ allocator, maxSlots: 1 });

  const first = await pool.allocate({ platform: 'ios' });

  let secondHandle: { deviceId: string } | undefined;
  const secondPromise = pool.allocate({ platform: 'ios' }).then((h) => { secondHandle = h; });

  await Promise.resolve();
  expect(secondHandle).toBeUndefined();

  await pool.release(first.allocationId);
  await secondPromise;

  expect(secondHandle?.deviceId).toBe('d1');
});

test('allocation failure rejects the requesting waiter and drops the slot', async () => {
  let attempts = 0;
  const allocator: DeviceAllocator = {
    async allocate() {
      attempts++;
      if (attempts === 1) {
        throw new Error('boom');
      }
      return { deviceId: `d${attempts}`, platform: 'ios' };
    },
    async release() {},
  };
  const pool = new DevicePool({ allocator, maxSlots: 2 });

  await expect(pool.allocate({ platform: 'ios' })).rejects.toThrow('boom');

  const handle = await pool.allocate({ platform: 'ios' });
  expect(handle.deviceId).toBe('d2');
});

test('FIFO order across multiple waiters', async () => {
  const allocator = makeAllocator([{ deviceId: 'd1', platform: 'ios' }]);
  const pool = new DevicePool({ allocator, maxSlots: 1 });

  const first = await pool.allocate({ platform: 'ios' });

  const order: string[] = [];
  const w1 = pool.allocate({ platform: 'ios' }).then((h) => order.push(`w1:${h.allocationId}`));
  const w2 = pool.allocate({ platform: 'ios' }).then((h) => order.push(`w2:${h.allocationId}`));

  await pool.release(first.allocationId);
  await w1;
  const firstWaiterAllocId = order[0].split(':')[1];
  await pool.release(firstWaiterAllocId);
  await w2;

  expect(order.length).toBe(2);
  expect(order[0]).toMatch(/^w1:/);
  expect(order[1]).toMatch(/^w2:/);
});

test('hasInstalled is false until recordInstalled is called', async () => {
  const allocator = makeAllocator([{ deviceId: 'd1', platform: 'ios' }]);
  const pool = new DevicePool({ allocator, maxSlots: 1 });
  const handle = await pool.allocate({ platform: 'ios' });

  expect(pool.hasInstalled(handle.allocationId, 'app.ipa')).toBe(false);
  pool.recordInstalled(handle.allocationId, 'app.ipa');
  expect(pool.hasInstalled(handle.allocationId, 'app.ipa')).toBe(true);
});

test('install tracking persists across releases of the same slot', async () => {
  const allocator = makeAllocator([{ deviceId: 'd1', platform: 'ios' }]);
  const pool = new DevicePool({ allocator, maxSlots: 1 });
  const first = await pool.allocate({ platform: 'ios' });
  pool.recordInstalled(first.allocationId, 'app.ipa');

  await pool.release(first.allocationId);
  const second = await pool.allocate({ platform: 'ios' });

  expect(pool.hasInstalled(second.allocationId, 'app.ipa')).toBe(true);
});

test('allocation that exceeds allocationTimeoutMs rejects with timeout error', async () => {
  const allocator: DeviceAllocator = {
    async allocate(_c, _t, signal) {
      return new Promise<AllocateResult>((_, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    },
    async release() {},
  };
  const pool = new DevicePool({ allocator, maxSlots: 1, allocationTimeoutMs: 50 });

  await expect(pool.allocate({ platform: 'ios' })).rejects.toThrow(/timed out/i);
});
