import { test, expect } from '@playwright/test';
import { DevicePool } from '../application/device-pool.js';
import { DevicePoolHttpServer } from './http-server.js';
import { HttpDevicePoolClient } from './http-client.js';
import type { AllocateResult, DeviceAllocator } from '../application/ports.js';

function makeAllocator(devices: AllocateResult[]): DeviceAllocator {
  let i = 0;
  return {
    async allocate() { return devices[i++ % devices.length]; },
    async release() {},
  };
}

interface ServerHandle {
  url: string;
  client: HttpDevicePoolClient;
  stop: () => Promise<void>;
}

async function startServerAndClient(pool: DevicePool): Promise<ServerHandle> {
  const server = new DevicePoolHttpServer({ pool });
  const port = await server.listen();
  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    client: new HttpDevicePoolClient({ baseUrl: url }),
    stop: () => server.close(),
  };
}

test('client.allocate returns a handle from the server', async () => {
  const pool = new DevicePool({
    allocator: makeAllocator([{ deviceId: 'd1', platform: 'ios' }]),
    maxSlots: 1,
  });
  const { client, stop } = await startServerAndClient(pool);
  try {
    const handle = await client.allocate({ platform: 'ios' });
    expect(handle.deviceId).toBe('d1');
    expect(handle.allocationId).toMatch(/^alloc-/);
    await client.release(handle.allocationId);
  } finally {
    await stop();
  }
});

test('client.release frees the device for a subsequent allocate', async () => {
  const pool = new DevicePool({
    allocator: makeAllocator([{ deviceId: 'd1', platform: 'ios' }]),
    maxSlots: 1,
  });
  const { client, stop } = await startServerAndClient(pool);
  try {
    const first = await client.allocate({ platform: 'ios' });
    await client.release(first.allocationId);

    const second = await client.allocate({ platform: 'ios' });
    expect(second.deviceId).toBe('d1');
    await client.release(second.allocationId);
  } finally {
    await stop();
  }
});

test('install-tracking round-trip via client', async () => {
  const pool = new DevicePool({
    allocator: makeAllocator([{ deviceId: 'd1', platform: 'ios' }]),
    maxSlots: 1,
  });
  const { client, stop } = await startServerAndClient(pool);
  try {
    const handle = await client.allocate({ platform: 'ios' });
    expect(await client.hasInstalled(handle.allocationId, 'a.ipa')).toBe(false);
    await client.recordInstalled(handle.allocationId, 'a.ipa');
    expect(await client.hasInstalled(handle.allocationId, 'a.ipa')).toBe(true);
    await client.release(handle.allocationId);
  } finally {
    await stop();
  }
});
