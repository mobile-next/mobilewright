import { test, expect } from '@playwright/test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertValidZipFile,
  mergeDeviceConfig,
  assertSupportedPlatform,
  annotationsForDevice,
  connectOptionsFor,
  videoPlan,
  parseViewTreeOption,
} from './fixture-helpers.js';

function writeTempFile(name: string, bytes: Buffer): string {
  const path = join(mkdtempSync(join(tmpdir(), 'mw-fixture-')), name);
  writeFileSync(path, bytes);
  return path;
}

test.describe('assertValidZipFile', () => {
  test('accepts a file starting with the ZIP magic bytes', () => {
    const path = writeTempFile('app.apk', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]));
    expect(() => assertValidZipFile(path)).not.toThrow();
  });

  test('rejects a file that is not a ZIP and names the path', () => {
    const path = writeTempFile('app.apk', Buffer.from('not a zip at all'));
    expect(() => assertValidZipFile(path)).toThrow(`"${path}" is not a valid ZIP file`);
  });
});

test.describe('mergeDeviceConfig', () => {
  const config = { platform: 'ios' as const, deviceId: 'cfg-device', use: { actionTimeout: 1 }, projects: [{ name: 'android', use: { actionTimeout: 2 } }] };

  test('fixture options override config values', () => {
    const merged = mergeDeviceConfig(config, { platform: 'android', deviceId: 'opt-device' }, 'ios');
    expect(merged.platform).toBe('android');
    expect(merged.deviceId).toBe('opt-device');
  });

  test('undefined fixture options leave config values alone', () => {
    const merged = mergeDeviceConfig(config, { platform: undefined, deviceId: undefined }, 'ios');
    expect(merged.platform).toBe('ios');
    expect(merged.deviceId).toBe('cfg-device');
  });

  test('an empty deviceId option still overrides the config deviceId', () => {
    const merged = mergeDeviceConfig(config, { deviceId: '' }, 'ios');
    expect(merged.deviceId).toBe('');
  });

  test('project use settings win over top-level use settings', () => {
    const merged = mergeDeviceConfig(config, {}, 'android');
    expect(merged.use?.actionTimeout).toBe(2);
  });

  test('an unknown project falls back to top-level use settings', () => {
    const merged = mergeDeviceConfig(config, {}, 'nope');
    expect(merged.use?.actionTimeout).toBe(1);
  });
});

test.describe('assertSupportedPlatform', () => {
  test('accepts ios and android', () => {
    expect(assertSupportedPlatform('ios')).toBe('ios');
    expect(assertSupportedPlatform('android')).toBe('android');
  });

  test('rejects anything else, including a missing platform', () => {
    expect(() => assertSupportedPlatform(undefined)).toThrow('Unsupported platform: "undefined"');
    expect(() => assertSupportedPlatform('web')).toThrow('Must be "ios" or "android"');
  });
});

test.describe('annotationsForDevice', () => {
  test('always records platform and id', () => {
    expect(annotationsForDevice({ deviceId: 'd1', platform: 'ios' })).toEqual([
      { type: 'device.platform', description: 'ios' },
      { type: 'device.id', description: 'd1' },
    ]);
  });

  test('records every optional field when present, id last', () => {
    const annotations = annotationsForDevice({
      deviceId: 'd1', platform: 'android', type: 'emulator', osVersion: '14', model: 'Pixel', driver: 'mobilecli',
    });
    expect(annotations.map(a => a.type)).toEqual([
      'device.type', 'device.platform', 'device.osVersion', 'device.model', 'device.driver', 'device.id',
    ]);
    expect(annotations.find(a => a.type === 'device.model')?.description).toBe('Pixel');
  });
});

test.describe('connectOptionsFor', () => {
  test('maps allocation handle and merged config onto connectDevice options', () => {
    const options = connectOptionsFor(
      { deviceId: 'd1', platform: 'ios', type: 'simulator' },
      { driver: 'drv' as any, timeout: 5, use: { actionTimeout: 1, appLaunchTimeout: 2, installTimeout: 3, animations: 'off' }, expect: { timeout: 4 } },
    );
    expect(options).toEqual({
      platform: 'ios',
      deviceId: 'd1',
      deviceType: 'simulator',
      driver: 'drv',
      timeout: 5,
      actionTimeout: 1,
      expectTimeout: 4,
      appLaunchTimeout: 2,
      installTimeout: 3,
      deviceSettings: { animations: 'off' },
    });
  });
});

test.describe('videoPlan', () => {
  const outputDir = '/out';
  const testId = 'abc';

  test('does not record when video is off or unset', () => {
    expect(videoPlan('off', outputDir, testId).shouldRecord).toBe(false);
    expect(videoPlan(undefined, outputDir, testId).shouldRecord).toBe(false);
  });

  test('records and always attaches when video is on', () => {
    const plan = videoPlan('on', outputDir, testId);
    expect(plan.shouldRecord).toBe(true);
    expect(plan.path).toBe(join('/out', 'video-abc.mp4'));
    expect(plan.shouldAttach(false)).toBe(true);
    expect(plan.shouldAttach(true)).toBe(true);
  });

  test('records but only attaches on failure for retain-on-failure', () => {
    const plan = videoPlan('retain-on-failure', outputDir, testId);
    expect(plan.shouldRecord).toBe(true);
    expect(plan.shouldAttach(false)).toBe(false);
    expect(plan.shouldAttach(true)).toBe(true);
  });

  test('reads the mode from the object form', () => {
    expect(videoPlan({ mode: 'on', size: { width: 1, height: 1 } }, outputDir, testId).shouldRecord).toBe(true);
  });
});

test.describe('parseViewTreeOption', () => {
  test('defaults to off', () => {
    expect(parseViewTreeOption(undefined)).toBe('off');
  });

  test('accepts on-failure', () => {
    expect(parseViewTreeOption('on-failure')).toBe('on-failure');
  });

  test('rejects any other value', () => {
    expect(() => parseViewTreeOption('always')).toThrow('Invalid viewTree value: "always"');
  });
});
