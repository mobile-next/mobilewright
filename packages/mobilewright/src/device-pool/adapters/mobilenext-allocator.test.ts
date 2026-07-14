import { test, expect } from '@playwright/test';
import type { FleetApiClient, SessionDevice } from '@mobilewright/driver-mobilenext';
import { MobileNextAllocator } from './mobilenext-allocator.js';

function readyDevice(serial: string): SessionDevice {
  return {
    id: 'alloc-1',
    status: 'in_use',
    info: { platform: 'ios', type: 'real', name: 'iPhone 15', osVersion: '17.0', serial },
    createdAt: '2026-01-01T00:00:00Z',
  };
}

// Builds an allocator over a fake FleetApiClient whose createSession behaviour the test controls.
function allocatorWithSession(createSession: () => Promise<string>): MobileNextAllocator {
  const client = {
    createSession,
    allocateDevice: async () => readyDevice('SERIAL-A'),
    releaseDevice: async () => {},
  } as unknown as FleetApiClient;
  return new MobileNextAllocator({ apiKey: 'mob_test', client });
}

test('allocate throws when no platform is given instead of silently defaulting to iOS', async () => {
  const allocator = allocatorWithSession(async () => 'sess-1');

  await expect(allocator.allocate({}, new Set())).rejects.toThrow(/requires a platform/);
});

test('allocate rejects a pinned deviceId instead of silently allocating a different device', async () => {
  const allocator = allocatorWithSession(async () => 'sess-1');

  await expect(allocator.allocate({ platform: 'ios', deviceId: 'UDID-123' }, new Set())).rejects.toThrow(/cannot pin a specific deviceId/);
});

test('a failed session creation can be retried by a later allocate', async () => {
  let attempts = 0;
  const allocator = allocatorWithSession(async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error('session boom');
    }
    return 'sess-1';
  });

  await expect(allocator.allocate({ platform: 'ios' }, new Set())).rejects.toThrow(/session boom/);

  const result = await allocator.allocate({ platform: 'ios' }, new Set());
  expect(result.deviceId).toBe('SERIAL-A');
  expect(attempts).toBe(2);
});
