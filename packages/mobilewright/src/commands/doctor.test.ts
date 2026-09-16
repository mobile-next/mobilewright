import { test, expect } from '@playwright/test';
import { isSupportedNodeVersion } from './doctor.js';

test('accepts node 22.12 and newer', () => {
  expect(isSupportedNodeVersion('v22.12.0')).toBe(true);
  expect(isSupportedNodeVersion('v22.23.2')).toBe(true);
  expect(isSupportedNodeVersion('v24.21.0')).toBe(true);
});

test('rejects node older than 22.12', () => {
  expect(isSupportedNodeVersion('v22.11.0')).toBe(false);
  expect(isSupportedNodeVersion('v20.19.0')).toBe(false);
  expect(isSupportedNodeVersion('')).toBe(false);
});
