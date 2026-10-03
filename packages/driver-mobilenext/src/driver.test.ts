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

// Cloud devices run the same mobilecli agent, whose tap/longpress params are
// Go ints — fractional coordinates are rejected. tap() rounds; the other
// pointer actions must too.
test.describe('pointer coordinates are sent as integers', () => {
  type RecordedCall = { method: string; params: Record<string, unknown> };

  function driverWithRecordingSession(): { driver: MobileNextDriver; calls: RecordedCall[] } {
    const driver = new MobileNextDriver({ apiKey: 'mob_key', testResult: { uploadReport: 'off' } });
    const calls: RecordedCall[] = [];
    (driver as any).session = {
      deviceId: 'cloud-device',
      platform: 'android',
      rpc: {
        call: async (method: string, params: Record<string, unknown>) => { calls.push({ method, params }); return {}; },
        disconnect: async () => {},
      },
    };
    return { driver, calls };
  }

  function sentCoordinates(calls: RecordedCall[]): Array<{ x: unknown; y: unknown }> {
    return calls.map(({ params }) => ({ x: params.x, y: params.y }));
  }

  test('doubleTap() rounds fractional coordinates for both taps', async () => {
    const { driver, calls } = driverWithRecordingSession();
    await driver.doubleTap(10.4, 20.6);
    expect(calls.map((c) => c.method)).toEqual(['device.io.tap', 'device.io.tap']);
    expect(sentCoordinates(calls)).toEqual([{ x: 10, y: 21 }, { x: 10, y: 21 }]);
  });

  test('longPress() rounds fractional coordinates', async () => {
    const { driver, calls } = driverWithRecordingSession();
    await driver.longPress(10.4, 20.6, 300);
    expect(calls[0].method).toBe('device.io.longpress');
    expect(sentCoordinates(calls)).toEqual([{ x: 10, y: 21 }]);
    expect(calls[0].params.duration).toBe(300);
  });
});
