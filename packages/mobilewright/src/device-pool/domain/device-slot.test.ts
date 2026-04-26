import { test, expect } from '@playwright/test';
import { DeviceSlot, DeviceSlotStateError } from './device-slot.js';

test('a new slot starts in the allocating state', () => {
  const slot = new DeviceSlot();
  expect(slot.state).toBe('allocating');
});

test('an allocating slot becomes available after markAvailable', () => {
  const slot = new DeviceSlot();
  slot.markAvailable('device-1', 'ios');
  expect(slot.state).toBe('available');
  expect(slot.deviceId).toBe('device-1');
  expect(slot.platform).toBe('ios');
});

test('an available slot becomes allocated after claim', () => {
  const slot = new DeviceSlot();
  slot.markAvailable('device-1', 'ios');
  slot.claim('alloc-1');
  expect(slot.state).toBe('allocated');
  expect(slot.allocationId).toBe('alloc-1');
});

test('an allocated slot becomes available after release', () => {
  const slot = new DeviceSlot();
  slot.markAvailable('device-1', 'ios');
  slot.claim('alloc-1');
  slot.release();
  expect(slot.state).toBe('available');
  expect(slot.allocationId).toBeUndefined();
});

test('claiming an already-allocated slot throws DeviceSlotStateError', () => {
  const slot = new DeviceSlot();
  slot.markAvailable('device-1', 'ios');
  slot.claim('alloc-1');
  expect(() => slot.claim('alloc-2')).toThrow(DeviceSlotStateError);
});

test('markAvailable on an allocated slot throws', () => {
  const slot = new DeviceSlot();
  slot.markAvailable('device-1', 'ios');
  slot.claim('alloc-1');
  expect(() => slot.markAvailable('device-2', 'ios')).toThrow(DeviceSlotStateError);
});

test('release on an available slot throws', () => {
  const slot = new DeviceSlot();
  slot.markAvailable('device-1', 'ios');
  expect(() => slot.release()).toThrow(DeviceSlotStateError);
});

test('recordInstalled tracks installed bundleIds', () => {
  const slot = new DeviceSlot();
  slot.markAvailable('device-1', 'ios');
  expect(slot.hasInstalled('com.example')).toBe(false);
  slot.recordInstalled('com.example');
  expect(slot.hasInstalled('com.example')).toBe(true);
});
