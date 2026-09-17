import { test, expect } from '@playwright/test';
import { isTelemetryDisabled } from './telemetry.js';

test('telemetry is enabled when no opt-out variable is set', () => {
  expect(isTelemetryDisabled({})).toBe(false);
});

test('MOBILEWRIGHT_DISABLE_TELEMETRY disables telemetry for any value', () => {
  for (const value of ['1', 'true', '0']) {
    expect(isTelemetryDisabled({ MOBILEWRIGHT_DISABLE_TELEMETRY: value })).toBe(true);
  }
});

test('DO_NOT_TRACK disables telemetry', () => {
  for (const value of ['1', 'true', 'TRUE', 'yes']) {
    expect(isTelemetryDisabled({ DO_NOT_TRACK: value })).toBe(true);
  }
});

test('DO_NOT_TRACK set to 0, false or empty keeps telemetry enabled', () => {
  for (const value of ['0', 'false', '']) {
    expect(isTelemetryDisabled({ DO_NOT_TRACK: value })).toBe(false);
  }
});
