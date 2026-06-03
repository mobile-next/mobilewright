import { test, expect } from '@playwright/test';
import type { HardwareButton } from './index.js';

const allHardwareButtons: HardwareButton[] = [
  'HOME',
  'BACK',
  'POWER',
  'VOLUME_UP',
  'VOLUME_DOWN',
  'ENTER',
  'DPAD_UP',
  'DPAD_DOWN',
  'DPAD_LEFT',
  'DPAD_RIGHT',
  'DPAD_CENTER',
  'APP_SWITCH',
  'LOCK',
];

test.describe('HardwareButton', () => {
  test('is exported from mobilewright-core', () => {
    const button: HardwareButton = 'HOME';
    expect(button).toBe('HOME');
  });

  test('includes LOCK for iOS lock screen', () => {
    const lockButton: HardwareButton = 'LOCK';
    expect(lockButton).toBe('LOCK');
  });

  test('covers all expected hardware buttons', () => {
    expect(allHardwareButtons).toContain('HOME');
    expect(allHardwareButtons).toContain('BACK');
    expect(allHardwareButtons).toContain('POWER');
    expect(allHardwareButtons).toContain('VOLUME_UP');
    expect(allHardwareButtons).toContain('VOLUME_DOWN');
    expect(allHardwareButtons).toContain('LOCK');
  });
});
