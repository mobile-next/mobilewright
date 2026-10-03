import { test, expect } from '@playwright/test';
import { MobileNextDriver } from './driver.js';

const INSECURE_URL = 'http://localhost:1234';

function withApiKeyEnv(value: string, fn: () => void): void {
  const previous = process.env.MOBILENEXT_API_KEY;
  process.env.MOBILENEXT_API_KEY = value;
  try {
    fn();
  } finally {
    if (previous === undefined) {
      delete process.env.MOBILENEXT_API_KEY;
    } else {
      process.env.MOBILENEXT_API_KEY = previous;
    }
  }
}

// The https guard only fires when an api key is in effect, so it tells us which key was picked.
test('falls back to MOBILENEXT_API_KEY when apiKey is not provided', () => {
  withApiKeyEnv('mob_from_env', () => {
    expect(() => new MobileNextDriver({ apiUrl: INSECURE_URL })).toThrow(/must use https/);
  });
});

test('refuses to send the api key over an insecure websocket url', async () => {
  const driver = new MobileNextDriver({ apiKey: 'mob_key', testResult: { uploadReport: 'off' } });
  await expect(driver.connect({ platform: 'ios', deviceId: 'abc', url: 'ws://localhost:1234/ws' })).rejects.toThrow(/must use wss/);
});

test('explicit apiKey overrides MOBILENEXT_API_KEY', () => {
  withApiKeyEnv('mob_from_env', () => {
    expect(() => new MobileNextDriver({ apiKey: '', apiUrl: INSECURE_URL, testResult: { uploadReport: 'off' } })).not.toThrow();
  });
});

test('a failed connection does not leak the api key into the error message', async () => {
  const SECRET = 'mnxt_SUPER_SECRET_KEY_123';
  const driver = new MobileNextDriver({ apiKey: SECRET, testResult: { uploadReport: 'off' } });
  let error: Error | undefined;
  try {
    await driver.connect({ platform: 'android', deviceId: 'abc', url: 'wss://127.0.0.1:1/ws', timeout: 1_000 });
  } catch (e) {
    error = e as Error;
  }
  expect(error).toBeDefined();
  expect(error!.message).not.toContain(SECRET);
  expect(error!.message).toContain('token=***');
});
