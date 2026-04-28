import { test, expect } from '@playwright/test';
import type { DeviceInfo } from '@mobilewright/protocol';
import { MobilecliAllocator } from './mobilecli-allocator.js';
import { NoDeviceAvailableError } from '../application/ports.js';

interface FakeDriver {
  listDevices(opts?: { platform?: string }): Promise<DeviceInfo[]>;
}

function makeFakeDriver(devices: DeviceInfo[]): FakeDriver {
  return {
    async listDevices(): Promise<DeviceInfo[]> {
      return devices;
    },
  };
}

test('allocates the first online device matching platform', async () => {
  const driver = makeFakeDriver([
    { id: 'a', name: 'iPhone 14', platform: 'ios', type: 'simulator', state: 'online' },
    { id: 'b', name: 'iPhone 16', platform: 'ios', type: 'simulator', state: 'online' },
  ]);
  const allocator = new MobilecliAllocator({ driver });

  const result = await allocator.allocate({ platform: 'ios' }, new Set());

  expect(result.deviceId).toBe('a');
  expect(result.platform).toBe('ios');
});

test('skips devices that are already taken', async () => {
  const driver = makeFakeDriver([
    { id: 'a', name: 'iPhone 14', platform: 'ios', type: 'simulator', state: 'online' },
    { id: 'b', name: 'iPhone 16', platform: 'ios', type: 'simulator', state: 'online' },
  ]);
  const allocator = new MobilecliAllocator({ driver });

  const result = await allocator.allocate({ platform: 'ios' }, new Set(['a']));

  expect(result.deviceId).toBe('b');
});

test('filters by deviceNamePattern', async () => {
  const driver = makeFakeDriver([
    { id: 'a', name: 'iPhone 14', platform: 'ios', type: 'simulator', state: 'online' },
    { id: 'b', name: 'iPhone 16', platform: 'ios', type: 'simulator', state: 'online' },
  ]);
  const allocator = new MobilecliAllocator({ driver });

  const result = await allocator.allocate(
    { platform: 'ios', deviceNamePattern: 'iPhone 16' },
    new Set(),
  );

  expect(result.deviceId).toBe('b');
});

test('filters by exact deviceId', async () => {
  const driver = makeFakeDriver([
    { id: 'a', name: 'iPhone 14', platform: 'ios', type: 'simulator', state: 'online' },
    { id: 'b', name: 'iPhone 16', platform: 'ios', type: 'simulator', state: 'online' },
  ]);
  const allocator = new MobilecliAllocator({ driver });

  const result = await allocator.allocate(
    { platform: 'ios', deviceId: 'b' },
    new Set(),
  );

  expect(result.deviceId).toBe('b');
});

test('throws NoDeviceAvailableError when no device matches', async () => {
  const driver = makeFakeDriver([
    { id: 'a', name: 'iPhone 14', platform: 'ios', type: 'simulator', state: 'offline' },
  ]);
  const allocator = new MobilecliAllocator({ driver });

  const err = await allocator.allocate({ platform: 'ios' }, new Set()).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(NoDeviceAvailableError);
});

test('release is a no-op for local devices', async () => {
  const driver = makeFakeDriver([]);
  const allocator = new MobilecliAllocator({ driver });
  await expect(allocator.release('whatever')).resolves.toBeUndefined();
});
