import { test, expect } from '@playwright/test';
import { Allocation } from './allocation.js';

test('Allocation carries id, deviceId, platform, and slotIndex', () => {
  const allocation = new Allocation({
    allocationId: 'alloc-1',
    deviceId: 'device-1',
    platform: 'ios',
    slotIndex: 3,
  });

  expect(allocation.allocationId).toBe('alloc-1');
  expect(allocation.deviceId).toBe('device-1');
  expect(allocation.platform).toBe('ios');
  expect(allocation.slotIndex).toBe(3);
});

test('Allocation generates a fresh id when one is not provided', () => {
  const a = Allocation.create({ deviceId: 'd', platform: 'ios', slotIndex: 0 });
  const b = Allocation.create({ deviceId: 'd', platform: 'ios', slotIndex: 0 });
  expect(a.allocationId).toMatch(/^alloc-/);
  expect(a.allocationId).not.toBe(b.allocationId);
});
