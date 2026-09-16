import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { DevicePool } from '../application/device-pool.js';
import { DevicePoolHttpServer } from './http-server.js';
import { HttpDevicePoolClient } from './http-client.js';
import type { DeviceAllocator } from '@mobilewright/protocol';
import type { AllocatedDevice } from '../application/ports.js';

function makeDriver(devices: AllocatedDevice[]): DeviceAllocator {
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
    driver: makeDriver([{ deviceId: 'd1', platform: 'ios' }]),
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
    driver: makeDriver([{ deviceId: 'd1', platform: 'ios' }]),
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
    driver: makeDriver([{ deviceId: 'd1', platform: 'ios' }]),
    maxSlots: 1,
  });
  const { client, stop } = await startServerAndClient(pool);
  try {
    const handle = await client.allocate({ platform: 'ios' });
    expect(await client.isAppInstalled(handle.allocationId, 'a.ipa')).toBe(false);
    await client.recordAppInstalled(handle.allocationId, 'a.ipa');
    expect(await client.isAppInstalled(handle.allocationId, 'a.ipa')).toBe(true);
    await client.release(handle.allocationId);
  } finally {
    await stop();
  }
});

test('client.allocate rejects when its signal aborts while the pool is still waiting', async () => {
  const neverAllocates: DeviceAllocator = { allocate: () => new Promise(() => {}), async release() {} };
  const pool = new DevicePool({ driver: neverAllocates, maxSlots: 1 });
  const { client, stop } = await startServerAndClient(pool);
  try {
    const controller = new AbortController();
    const pending = client.allocate({ platform: 'ios' }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/);
  } finally {
    await stop();
  }
});

test('client.release rejects instead of hanging when the coordinator never answers', async () => {
  const silentServer = createServer(() => { /* never responds */ });
  await new Promise<void>((resolve) => silentServer.listen(0, '127.0.0.1', resolve));
  const { port } = silentServer.address() as { port: number };
  const client = new HttpDevicePoolClient({ baseUrl: `http://127.0.0.1:${port}`, requestTimeout: 100 });
  try {
    await expect(client.release('alloc-1')).rejects.toThrow(/timed out/);
  } finally {
    silentServer.close();
  }
});
