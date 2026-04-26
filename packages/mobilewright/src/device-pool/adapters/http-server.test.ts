import { test, expect } from '@playwright/test';
import { request as httpRequest } from 'node:http';
import { DevicePool } from '../application/device-pool.js';
import type { DeviceAllocator, AllocateResult } from '../application/ports.js';
import { DevicePoolHttpServer } from './http-server.js';

function makeAllocator(devices: AllocateResult[]): DeviceAllocator {
  let i = 0;
  return {
    async allocate() {
      return devices[i++ % devices.length];
    },
    async release() {},
  };
}

interface ServerHandle {
  url: string;
  stop: () => Promise<void>;
}

async function startServer(pool: DevicePool): Promise<ServerHandle> {
  const server = new DevicePoolHttpServer({ pool });
  const port = await server.listen();
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => server.close(),
  };
}

function postAllocateAndReadFirstLine(url: string, body: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const req = httpRequest(`${url}/allocate`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let buffer = '';
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx !== -1) {
          resolve(buffer.slice(0, newlineIdx));
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

test('POST /allocate returns a JSON line with allocationId, deviceId, platform', async () => {
  const pool = new DevicePool({
    allocator: makeAllocator([{ deviceId: 'd1', platform: 'ios' }]),
    maxSlots: 1,
  });
  const server = await startServer(pool);
  try {
    const line = await postAllocateAndReadFirstLine(server.url, JSON.stringify({ criteria: { platform: 'ios' } }));
    const parsed = JSON.parse(line);
    expect(parsed.deviceId).toBe('d1');
    expect(parsed.platform).toBe('ios');
    expect(parsed.allocationId).toMatch(/^alloc-/);
  } finally {
    await server.stop();
  }
});

function postReleaseRequest(url: string, allocationId: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const req = httpRequest(`${url}/release`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.write(JSON.stringify({ allocationId }));
    req.end();
  });
}

test('POST /release frees the slot for the next allocate', async () => {
  const pool = new DevicePool({
    allocator: makeAllocator([{ deviceId: 'd1', platform: 'ios' }]),
    maxSlots: 1,
  });
  const server = await startServer(pool);
  try {
    const firstLine = await postAllocateAndReadFirstLine(server.url, JSON.stringify({ criteria: { platform: 'ios' } }));
    const first = JSON.parse(firstLine);

    const status = await postReleaseRequest(server.url, first.allocationId);
    expect(status).toBe(200);

    const secondLine = await postAllocateAndReadFirstLine(server.url, JSON.stringify({ criteria: { platform: 'ios' } }));
    const second = JSON.parse(secondLine);
    expect(second.deviceId).toBe('d1');

    await postReleaseRequest(server.url, second.allocationId);
  } finally {
    await server.stop();
  }
});

test('POST /release with unknown allocationId returns 200 (idempotent)', async () => {
  const pool = new DevicePool({
    allocator: makeAllocator([]),
    maxSlots: 1,
  });
  const server = await startServer(pool);
  try {
    const status = await postReleaseRequest(server.url, 'alloc-unknown');
    expect(status).toBe(200);
  } finally {
    await server.stop();
  }
});
