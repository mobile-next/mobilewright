import { test, expect } from '@playwright/test';
import { DevicePool } from './device-pool.js';
import { NoDeviceAvailableError } from './ports.js';
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

test('NoDeviceAvailableError re-queues the waiter to be served on next release', async () => {
  // Simulates 3 workers competing for 2 devices.
  // Workers 0 and 1 allocate. Worker 2 gets NoDeviceAvailableError from the
  // allocator. It should re-queue and be served when worker 0 releases.
  let counter = 0;
  const devices = ['sim-a', 'sim-b'];
  const allocator: DeviceAllocator = {
    async allocate(_c, takenDeviceIds): Promise<AllocateResult> {
      const available = devices.filter(id => !takenDeviceIds.has(id));
      if (available.length === 0) {
        throw new NoDeviceAvailableError('no device available');
      }
      const deviceId = available[counter++ % available.length];
      return { deviceId, platform: 'ios' };
    },
    async release() {},
  };
  const pool = new DevicePool({ allocator, maxSlots: 3 });

  const w0 = await pool.allocate({ platform: 'ios' });
  const w1 = await pool.allocate({ platform: 'ios' });

  // w2 should block because both devices are taken.
  let w2Handle: { deviceId: string } | undefined;
  const w2Promise = pool.allocate({ platform: 'ios' }).then(h => { w2Handle = h; });

  await Promise.resolve();
  expect(w2Handle).toBeUndefined();

  // Releasing w0 should unblock w2.
  await pool.release(w0.allocationId);
  await w2Promise;

  expect(w2Handle?.deviceId).toBe('sim-a');
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

test('isAppInstalled is false until recordAppInstalled is called', async () => {
  const allocator = makeAllocator([{ deviceId: 'd1', platform: 'ios' }]);
  const pool = new DevicePool({ allocator, maxSlots: 1 });
  const handle = await pool.allocate({ platform: 'ios' });

  expect(pool.isAppInstalled(handle.allocationId, 'app.ipa')).toBe(false);
  pool.recordAppInstalled(handle.allocationId, 'app.ipa');
  expect(pool.isAppInstalled(handle.allocationId, 'app.ipa')).toBe(true);
});

test('install tracking persists across releases of the same slot', async () => {
  const allocator = makeAllocator([{ deviceId: 'd1', platform: 'ios' }]);
  const pool = new DevicePool({ allocator, maxSlots: 1 });
  const first = await pool.allocate({ platform: 'ios' });
  pool.recordAppInstalled(first.allocationId, 'app.ipa');

  await pool.release(first.allocationId);
  const second = await pool.allocate({ platform: 'ios' });

  expect(pool.isAppInstalled(second.allocationId, 'app.ipa')).toBe(true);
});

test('shutdown calls allocator.release for every available slot', async () => {
  const released: string[] = [];
  let counter = 0;
  const allocator: DeviceAllocator = {
    async allocate(): Promise<AllocateResult> {
      counter++;
      return { deviceId: `d${counter}`, platform: 'ios' };
    },
    async release(deviceId: string) { released.push(deviceId); },
  };
  const pool = new DevicePool({ allocator, maxSlots: 2 });

  const a = await pool.allocate({ platform: 'ios' });
  const b = await pool.allocate({ platform: 'ios' });
  await pool.release(a.allocationId);

  await pool.shutdown();

  expect(released.sort()).toEqual([a.deviceId, b.deviceId].sort());
});

test('shutdown rejects in-flight waiters', async () => {
  const allocator: DeviceAllocator = {
    async allocate() {
      return new Promise<AllocateResult>(() => {});
    },
    async release() {},
  };
  const pool = new DevicePool({ allocator, maxSlots: 1 });

  const promise = pool.allocate({ platform: 'ios' });
  await Promise.resolve();
  await pool.shutdown();

  await expect(promise).rejects.toThrow(/shutdown/i);
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
