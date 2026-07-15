import { expect, test } from '@playwright/test';
import type { AppInfo, ViewNode } from '@mobilewright/protocol';
import { SauceLabsDriver, waitForActiveSession } from './driver.js';
import type { TouchPoint } from './device-control-socket.js';

// ─── Fake helpers ────────────────────────────────────────────────────────────

interface TouchCall {
  action: 'd' | 'm' | 'u';
  points: TouchPoint[];
  cw: number;
  ch: number;
  orientation: 0 | 1;
}

function createFakeIoSocket() {
  const touchCalls: TouchCall[] = [];
  const keyCalls: string[] = [];
  let capturing = false;
  let frames: { frame: Buffer; ts: number }[] = [];
  let captureEndTs = 0;

  return {
    touchCalls,
    keyCalls,
    setFramesToReturn(f: { frame: Buffer; ts: number }[]) { frames = f; },
    setCaptureEndTs(ts: number) { captureEndTs = ts; },
    sendTouch(action: 'd' | 'm' | 'u', points: TouchPoint[], cw: number, ch: number, orientation: 0 | 1) {
      touchCalls.push({ action, points, cw, ch, orientation });
    },
    sendKey(key: string) { keyCalls.push(key); },
    startFrameCapture() { capturing = true; },
    stopFrameCapture() { const f = frames; capturing = false; return f; },
    getCaptureEndTs() { return captureEndTs; },
    connect: async () => {},
    disconnect: async () => {},
    get isCapturing() { return capturing; },
  };
}

interface RestCall { method: string; args: unknown[] }

function createFakeRest(responses: Record<string, unknown> = {}) {
  const calls: RestCall[] = [];
  const rest = new Proxy({} as Record<string, (...args: unknown[]) => Promise<unknown>>, {
    get(_, method: string) {
      return async (...args: unknown[]) => {
        calls.push({ method, args });
        const val = responses[method];
        if (val instanceof Error) throw val;
        return val;
      };
    },
  });
  return { rest, calls };
}

interface WdaCall { method: string; args: unknown[] }

function createFakeWda(responses: Record<string, unknown> = {}) {
  const calls: WdaCall[] = [];
  return {
    calls,
    close: async () => {
    },
    getSource: async (): Promise<ViewNode[]> => {
      calls.push({ method: 'getSource', args: [] });
      return (responses['getSource'] as ViewNode[]) ?? [];
    },
    getActiveAppInfo: async (): Promise<AppInfo> => {
      calls.push({ method: 'getActiveAppInfo', args: [] });
      return (responses['getActiveAppInfo'] as AppInfo) ?? { bundleId: '' };
    },
    listApps: async (): Promise<AppInfo[]> => {
      calls.push({ method: 'listApps', args: [] });
      return (responses['listApps'] as AppInfo[]) ?? [];
    },
    terminateApp: async (bundleId: string) => {
      calls.push({ method: 'terminateApp', args: [bundleId] });
    },
    pressButton: async (name: string) => {
      calls.push({ method: 'pressButton', args: [name] });
    },
  };
}

type Platform = 'ios' | 'android';

interface SessionOptions {
  platform?: Platform;
  resolutionWidth?: number;
  resolutionHeight?: number;
  pixelsPerPoint?: number;
  currentOrientation?: 'PORTRAIT' | 'LANDSCAPE';
  restResponses?: Record<string, unknown>;
  wdaResponses?: Record<string, unknown>;
  ownsSession?: boolean;
}

/**
 * Creates a SauceLabsDriver with a pre-injected fake session — no real
 * WebSocket or HTTP server needed. Mirrors the pattern from driver-mobilecli.
 */
function createDriverWithSession(opts: SessionOptions = {}) {
  const platform: Platform = opts.platform ?? 'ios';
  const driver = new SauceLabsDriver({ username: 'alice', accessKey: 'secret' });

  const ioSocket = createFakeIoSocket();
  const wda = platform === 'ios' ? createFakeWda(opts.wdaResponses ?? {}) : null;

  (driver as any).session = {
    sauceSessionId: 'sess-123',
    ownsSession: opts.ownsSession ?? true,
    platform,
    deviceId: 'iPhone_15_real',
    resolutionWidth: opts.resolutionWidth ?? 1170,
    resolutionHeight: opts.resolutionHeight ?? 2532,
    pixelsPerPoint: opts.pixelsPerPoint ?? 3,
    currentOrientation: opts.currentOrientation ?? 'PORTRAIT',
    ioSocket,
    companionSocket: { onOrientationFinish: () => {}, disconnect: async () => {} },
    wdaClient: wda,
  };

  const { rest, calls: restCalls } = createFakeRest(opts.restResponses ?? {});
  (driver as any).makeRest = () => rest;

  return { driver, ioSocket, wda, restCalls };
}

// ─── Constructor ─────────────────────────────────────────────────────────────

test.describe('SauceLabsDriver constructor', () => {
  test('reads credentials from SAUCE_USERNAME and SAUCE_ACCESS_KEY env vars', () => {
    const orig = { u: process.env['SAUCE_USERNAME'], k: process.env['SAUCE_ACCESS_KEY'] };
    process.env['SAUCE_USERNAME'] = 'env-user';
    process.env['SAUCE_ACCESS_KEY'] = 'env-key';
    try {
      expect(() => new SauceLabsDriver()).not.toThrow();
    } finally {
      if (orig.u === undefined) delete process.env['SAUCE_USERNAME']; else process.env['SAUCE_USERNAME'] = orig.u;
      if (orig.k === undefined) delete process.env['SAUCE_ACCESS_KEY']; else process.env['SAUCE_ACCESS_KEY'] = orig.k;
    }
  });

  test('explicit options take precedence over env vars', () => {
    const orig = { u: process.env['SAUCE_USERNAME'], k: process.env['SAUCE_ACCESS_KEY'] };
    process.env['SAUCE_USERNAME'] = 'env-user';
    process.env['SAUCE_ACCESS_KEY'] = 'env-key';
    try {
      const driver = new SauceLabsDriver({ username: 'opt-user', accessKey: 'opt-key' });
      expect((driver as any).username).toBe('opt-user');
    } finally {
      if (orig.u === undefined) delete process.env['SAUCE_USERNAME']; else process.env['SAUCE_USERNAME'] = orig.u;
      if (orig.k === undefined) delete process.env['SAUCE_ACCESS_KEY']; else process.env['SAUCE_ACCESS_KEY'] = orig.k;
    }
  });

  test('throws with helpful message when username is missing', () => {
    const orig = process.env['SAUCE_USERNAME'];
    delete process.env['SAUCE_USERNAME'];
    try {
      expect(() => new SauceLabsDriver({ accessKey: 'k' })).toThrow('SAUCE_USERNAME');
    } finally {
      if (orig !== undefined) process.env['SAUCE_USERNAME'] = orig;
    }
  });

  test('throws with helpful message when accessKey is missing', () => {
    const orig = process.env['SAUCE_ACCESS_KEY'];
    delete process.env['SAUCE_ACCESS_KEY'];
    try {
      expect(() => new SauceLabsDriver({ username: 'u' })).toThrow('SAUCE_ACCESS_KEY');
    } finally {
      if (orig !== undefined) process.env['SAUCE_ACCESS_KEY'] = orig;
    }
  });
});

// ─── Session guard ────────────────────────────────────────────────────────────

test('screenshot() throws "No active session" when connect() was never called', async () => {
  const driver = new SauceLabsDriver({ username: 'u', accessKey: 'k' });
  await expect(driver.screenshot()).rejects.toThrow('No active session');
});

// ─── Screen ───────────────────────────────────────────────────────────────────

test.describe('SauceLabsDriver.getScreenSize()', () => {
  test('divides resolution by pixelsPerPoint (scale)', async () => {
    const { driver } = createDriverWithSession({ resolutionWidth: 1170, resolutionHeight: 2532, pixelsPerPoint: 3 });
    const size = await driver.getScreenSize();
    expect(size).toEqual({ width: 390, height: 844, scale: 3 });
  });

  test('swaps width and height in landscape orientation', async () => {
    const { driver } = createDriverWithSession({
      resolutionWidth: 1170,
      resolutionHeight: 2532,
      pixelsPerPoint: 3,
      currentOrientation: 'LANDSCAPE',
    });
    const size = await driver.getScreenSize();
    expect(size).toEqual({ width: 844, height: 390, scale: 3 });
  });

  test('uses scale 1 when pixelsPerPoint is 0', async () => {
    const { driver } = createDriverWithSession({ resolutionWidth: 1080, resolutionHeight: 1920, pixelsPerPoint: 0 });
    const size = await driver.getScreenSize();
    expect(size.scale).toBe(1);
    expect(size.width).toBe(1080);
  });
});

test.describe('SauceLabsDriver.getOrientation()', () => {
  test('returns portrait when session orientation is PORTRAIT', async () => {
    const { driver } = createDriverWithSession({ currentOrientation: 'PORTRAIT' });
    expect(await driver.getOrientation()).toBe('portrait');
  });

  test('returns landscape when session orientation is LANDSCAPE', async () => {
    const { driver } = createDriverWithSession({ currentOrientation: 'LANDSCAPE' });
    expect(await driver.getOrientation()).toBe('landscape');
  });
});

test.describe('SauceLabsDriver.setOrientation()', () => {
  test('calls applySettings with LANDSCAPE for landscape', async () => {
    const { driver, restCalls } = createDriverWithSession();
    await driver.setOrientation('landscape');

    const call = restCalls.find((c) => c.method === 'applySettings');
    expect(call?.args[1]).toMatchObject({ orientation: 'LANDSCAPE' });
  });

  test('calls applySettings with PORTRAIT for portrait', async () => {
    const { driver, restCalls } = createDriverWithSession({ currentOrientation: 'LANDSCAPE' });
    await driver.setOrientation('portrait');

    const call = restCalls.find((c) => c.method === 'applySettings');
    expect(call?.args[1]).toMatchObject({ orientation: 'PORTRAIT' });
  });
});

test.describe('SauceLabsDriver.screenshot()', () => {
  test('returns the Buffer from takeScreenshot', async () => {
    const buf = Buffer.from([137, 80, 78, 71]);
    const { driver } = createDriverWithSession({ restResponses: { takeScreenshot: buf } });
    const result = await driver.screenshot();
    expect(result).toBe(buf);
  });
});

// ─── Input ───────────────────────────────────────────────────────────────────

test.describe('SauceLabsDriver.tap()', () => {
  test('sends touch down then touch up at same coordinates', async () => {
    const { driver, ioSocket } = createDriverWithSession({ platform: 'android' });
    await driver.tap(540, 960);

    expect(ioSocket.touchCalls).toHaveLength(2);
    expect(ioSocket.touchCalls[0].action).toBe('d');
    expect(ioSocket.touchCalls[1].action).toBe('u');
    expect(ioSocket.touchCalls[0].points[0]).toMatchObject({ x: 540, y: 960, index: 0 });
    expect(ioSocket.touchCalls[1].points[0]).toMatchObject({ x: 540, y: 960, index: 0 });
  });

  test('uses portrait canvas dimensions in portrait orientation', async () => {
    const { driver, ioSocket } = createDriverWithSession({
      resolutionWidth: 1080,
      resolutionHeight: 1920,
      pixelsPerPoint: 1,
      currentOrientation: 'PORTRAIT',
    });
    await driver.tap(0, 0);

    expect(ioSocket.touchCalls[0].cw).toBe(1080);
    expect(ioSocket.touchCalls[0].ch).toBe(1920);
    expect(ioSocket.touchCalls[0].orientation).toBe(0);
  });

  test('swaps canvas dimensions and sets orientation flag in landscape', async () => {
    const { driver, ioSocket } = createDriverWithSession({
      resolutionWidth: 1080,
      resolutionHeight: 1920,
      pixelsPerPoint: 1,
      currentOrientation: 'LANDSCAPE',
    });
    await driver.tap(0, 0);

    expect(ioSocket.touchCalls[0].cw).toBe(1920);
    expect(ioSocket.touchCalls[0].ch).toBe(1080);
    expect(ioSocket.touchCalls[0].orientation).toBe(1);
  });

  test('on iOS, scales pixel resolution down to points by pixelsPerPoint (WDA bounds are point-space)', async () => {
    const { driver, ioSocket } = createDriverWithSession({
      platform: 'ios',
      resolutionWidth: 1170,
      resolutionHeight: 2532,
      pixelsPerPoint: 3,
      currentOrientation: 'PORTRAIT',
    });
    await driver.tap(195, 768);

    expect(ioSocket.touchCalls[0].cw).toBe(390);
    expect(ioSocket.touchCalls[0].ch).toBe(844);
    // x/y themselves are passed through unchanged — they already come in as points.
    expect(ioSocket.touchCalls[0].points[0]).toMatchObject({ x: 195, y: 768 });
  });

  test('on Android, does not scale canvas dimensions even if pixelsPerPoint is not 1 (uiautomator bounds are already pixel-space)', async () => {
    const { driver, ioSocket } = createDriverWithSession({
      platform: 'android',
      resolutionWidth: 1080,
      resolutionHeight: 2400,
      pixelsPerPoint: 2.75,
      currentOrientation: 'PORTRAIT',
    });
    await driver.tap(540, 1200);

    expect(ioSocket.touchCalls[0].cw).toBe(1080);
    expect(ioSocket.touchCalls[0].ch).toBe(2400);
  });
});

test.describe('SauceLabsDriver.doubleTap()', () => {
  test('sends two complete tap sequences', async () => {
    const { driver, ioSocket } = createDriverWithSession();
    await driver.doubleTap(200, 300);

    const actions = ioSocket.touchCalls.map((c) => c.action);
    expect(actions).toEqual(['d', 'u', 'd', 'u']);
  });

  test('all touches are at the given coordinates', async () => {
    const { driver, ioSocket } = createDriverWithSession();
    await driver.doubleTap(200, 300);

    for (const call of ioSocket.touchCalls) {
      expect(call.points[0]).toMatchObject({ x: 200, y: 300 });
    }
  });
});

test.describe('SauceLabsDriver.longPress()', () => {
  test('sends touch down followed by touch up', async () => {
    const { driver, ioSocket } = createDriverWithSession();
    await driver.longPress(100, 200, 10); // short duration for test speed

    const actions = ioSocket.touchCalls.map((c) => c.action);
    expect(actions[0]).toBe('d');
    expect(actions[actions.length - 1]).toBe('u');
  });
});

test.describe('SauceLabsDriver.clearText()', () => {
  test('sends select-all (a) then Backspace', async () => {
    const { driver, ioSocket } = createDriverWithSession();
    await driver.clearText();

    expect(ioSocket.keyCalls).toEqual(['a', 'Backspace']);
  });
});

test.describe('SauceLabsDriver.typeText()', () => {
  test('sends each ASCII character as a tt/ key event', async () => {
    const { driver, ioSocket } = createDriverWithSession();
    await driver.typeText('hi');

    expect(ioSocket.keyCalls).toEqual(['h', 'i']);
  });

  test('sends Space key for space character', async () => {
    const { driver, ioSocket } = createDriverWithSession();
    await driver.typeText(' ');

    expect(ioSocket.keyCalls).toEqual(['Space']);
  });

  test('calls executeShellCommand for non-ASCII text on Android', async () => {
    const { driver, restCalls } = createDriverWithSession({ platform: 'android' });
    await driver.typeText('こんにちは');

    const shellCall = restCalls.find((c) => c.method === 'executeShellCommand');
    expect(shellCall).toBeDefined();
    expect((shellCall!.args[1] as string)).toContain('input text');
  });

  test('does not call executeShellCommand for ASCII text on Android', async () => {
    const { driver, restCalls } = createDriverWithSession({ platform: 'android' });
    await driver.typeText('hello');

    const shellCall = restCalls.find((c) => c.method === 'executeShellCommand');
    expect(shellCall).toBeUndefined();
  });
});

test.describe('SauceLabsDriver.pressKeys()', () => {
  test('sends each key as a tt/ event in order', async () => {
    const { driver, ioSocket } = createDriverWithSession();
    await driver.pressKeys(['Enter', 'Tab']);

    expect(ioSocket.keyCalls).toEqual(['Enter', 'Tab']);
  });
});

// ─── pressButton ─────────────────────────────────────────────────────────────

test.describe('SauceLabsDriver.pressButton()', () => {
  test('HOME sends tt/Sauce_Home_Key on iOS', async () => {
    const { driver, ioSocket } = createDriverWithSession({ platform: 'ios' });
    await driver.pressButton('HOME');
    expect(ioSocket.keyCalls).toContain('Sauce_Home_Key');
  });

  test('HOME sends tt/Sauce_Home_Key on Android', async () => {
    const { driver, ioSocket } = createDriverWithSession({ platform: 'android' });
    await driver.pressButton('HOME');
    expect(ioSocket.keyCalls).toContain('Sauce_Home_Key');
  });

  test('BACK sends tt/Sauce_Back_Key', async () => {
    const { driver, ioSocket } = createDriverWithSession({ platform: 'android' });
    await driver.pressButton('BACK');
    expect(ioSocket.keyCalls).toContain('Sauce_Back_Key');
  });

  test('APP_SWITCH sends tt/Sauce_Menu_Key', async () => {
    const { driver, ioSocket } = createDriverWithSession({ platform: 'android' });
    await driver.pressButton('APP_SWITCH');
    expect(ioSocket.keyCalls).toContain('Sauce_Menu_Key');
  });

  test('VOLUME_UP on Android calls executeShellCommand with keyevent 24', async () => {
    const { driver, restCalls } = createDriverWithSession({ platform: 'android' });
    await driver.pressButton('VOLUME_UP');

    const call = restCalls.find((c) => c.method === 'executeShellCommand');
    expect(call?.args[1]).toContain('keyevent 24');
  });

  test('POWER on Android calls executeShellCommand with keyevent 26', async () => {
    const { driver, restCalls } = createDriverWithSession({ platform: 'android' });
    await driver.pressButton('POWER');

    const call = restCalls.find((c) => c.method === 'executeShellCommand');
    expect(call?.args[1]).toContain('keyevent 26');
  });

  test('VOLUME_DOWN on Android calls executeShellCommand with keyevent 25', async () => {
    const { driver, restCalls } = createDriverWithSession({ platform: 'android' });
    await driver.pressButton('VOLUME_DOWN');

    const call = restCalls.find((c) => c.method === 'executeShellCommand');
    expect(call?.args[1]).toContain('keyevent 25');
  });

  test('VOLUME_UP on iOS goes directly to WDA pressButton', async () => {
    const { driver, wda } = createDriverWithSession({ platform: 'ios' });
    await driver.pressButton('VOLUME_UP');

    expect(wda!.calls.find((c) => c.method === 'pressButton')?.args[0]).toBe('volumeUp');
  });
});

// ─── Apps ────────────────────────────────────────────────────────────────────

test.describe('SauceLabsDriver.launchApp()', () => {
  test('sends bundleId for iOS', async () => {
    const { driver, restCalls } = createDriverWithSession({ platform: 'ios' });
    await driver.launchApp('com.example.App');

    const call = restCalls.find((c) => c.method === 'launchApp');
    expect(call?.args[1]).toMatchObject({ bundleId: 'com.example.App' });
    expect((call?.args[1] as Record<string, unknown>)['packageName']).toBeUndefined();
  });

  test('sends packageName for Android', async () => {
    const { driver, restCalls } = createDriverWithSession({ platform: 'android' });
    await driver.launchApp('com.example.app');

    const call = restCalls.find((c) => c.method === 'launchApp');
    expect(call?.args[1]).toMatchObject({ packageName: 'com.example.app' });
  });

  test('includes activityName for Android when activity option is provided', async () => {
    const { driver, restCalls } = createDriverWithSession({ platform: 'android' });
    await driver.launchApp('com.example.app', { activity: '.MainActivity' });

    const call = restCalls.find((c) => c.method === 'launchApp');
    expect(call?.args[1]).toMatchObject({ activityName: '.MainActivity' });
  });

  test('omits activityName when no activity option is provided', async () => {
    const { driver, restCalls } = createDriverWithSession({ platform: 'android' });
    await driver.launchApp('com.example.app');

    const call = restCalls.find((c) => c.method === 'launchApp');
    expect((call?.args[1] as Record<string, unknown>)['activityName']).toBeUndefined();
  });
});

test.describe('SauceLabsDriver.terminateApp()', () => {
  test('calls executeShellCommand with am force-stop on Android', async () => {
    const { driver, restCalls } = createDriverWithSession({ platform: 'android' });
    await driver.terminateApp('com.example.app');

    const call = restCalls.find((c) => c.method === 'executeShellCommand');
    expect(call?.args[1]).toBe('am force-stop com.example.app');
  });

  test('calls WDA terminateApp on iOS', async () => {
    const { driver, wda } = createDriverWithSession({ platform: 'ios' });
    await driver.terminateApp('com.example.App');

    expect(wda!.calls.find((c) => c.method === 'terminateApp')?.args[0]).toBe('com.example.App');
  });
});

test.describe('SauceLabsDriver.installApp()', () => {
  test('uploads file to storage then calls installApp REST', async () => {
    const { driver, restCalls } = createDriverWithSession({
      restResponses: {
        uploadToStorage: 'storage:uuid-abc',
        installApp: { status: 'FINISHED' },
      },
    });
    await driver.installApp('/path/to/app.apk');

    const uploadCall = restCalls.find((c) => c.method === 'uploadToStorage');
    expect(uploadCall?.args[0]).toBe('/path/to/app.apk');

    const installCall = restCalls.find((c) => c.method === 'installApp');
    expect(installCall?.args[1]).toBe('storage:uuid-abc');
  });
});

test.describe('SauceLabsDriver.uninstallApp()', () => {
  test('sends bundleId for iOS', async () => {
    const { driver, restCalls } = createDriverWithSession({ platform: 'ios' });
    await driver.uninstallApp('com.example.App');

    const call = restCalls.find((c) => c.method === 'uninstallApp');
    expect(call?.args[1]).toMatchObject({ bundleId: 'com.example.App' });
  });

  test('sends packageName for Android', async () => {
    const { driver, restCalls } = createDriverWithSession({ platform: 'android' });
    await driver.uninstallApp('com.example.app');

    const call = restCalls.find((c) => c.method === 'uninstallApp');
    expect(call?.args[1]).toMatchObject({ packageName: 'com.example.app' });
  });
});

test.describe('SauceLabsDriver.listApps()', () => {
  test('parses pm list packages output on Android', async () => {
    const { driver } = createDriverWithSession({
      platform: 'android',
      restResponses: { executeShellCommand: 'package:com.example.one\npackage:com.example.two\n' },
    });
    const apps = await driver.listApps();

    expect(apps).toEqual([
      { bundleId: 'com.example.one' },
      { bundleId: 'com.example.two' },
    ]);
  });

  test('ignores non-package lines in pm output', async () => {
    const { driver } = createDriverWithSession({
      platform: 'android',
      restResponses: { executeShellCommand: 'WARNING: linker\npackage:com.example.app\n' },
    });
    const apps = await driver.listApps();
    expect(apps).toHaveLength(1);
    expect(apps[0].bundleId).toBe('com.example.app');
  });

  test('delegates to WDA on iOS', async () => {
    const wdaApps = [{ bundleId: 'com.apple.Music' }];
    const { driver, wda } = createDriverWithSession({
      platform: 'ios',
      wdaResponses: { listApps: wdaApps },
    });
    const apps = await driver.listApps();

    expect(wda!.calls.find((c) => c.method === 'listApps')).toBeDefined();
    expect(apps).toEqual(wdaApps);
  });
});

test.describe('SauceLabsDriver.getForegroundApp()', () => {
  test('parses mResumedActivity from dumpsys output on Android', async () => {
    const { driver } = createDriverWithSession({
      platform: 'android',
      restResponses: {
        executeShellCommand: '  mResumedActivity: ActivityRecord{abc12 u0 com.example.app/.MainActivity t42}\n',
      },
    });
    const app = await driver.getForegroundApp();
    expect(app.bundleId).toBe('com.example.app');
  });

  test('returns empty bundleId when mResumedActivity line is absent', async () => {
    const { driver } = createDriverWithSession({
      platform: 'android',
      restResponses: { executeShellCommand: 'no matching line here\n' },
    });
    const app = await driver.getForegroundApp();
    expect(app.bundleId).toBe('');
  });

  test('delegates to WDA on iOS', async () => {
    const { driver, wda } = createDriverWithSession({
      platform: 'ios',
      wdaResponses: { getActiveAppInfo: { bundleId: 'com.apple.Maps', name: 'Maps' } },
    });
    const app = await driver.getForegroundApp();

    expect(wda!.calls.find((c) => c.method === 'getActiveAppInfo')).toBeDefined();
    expect(app.bundleId).toBe('com.apple.Maps');
  });
});

test.describe('SauceLabsDriver.openUrl()', () => {
  test('calls REST openUrl with the given URL', async () => {
    const { driver, restCalls } = createDriverWithSession();
    await driver.openUrl('https://example.com');

    const call = restCalls.find((c) => c.method === 'openUrl');
    expect(call?.args[1]).toBe('https://example.com');
  });
});

// ─── Device settings ─────────────────────────────────────────────────────────

test.describe('SauceLabsDriver.applyDeviceSettings()', () => {
  test('calls applySettings with animations=false for { animations: off } on Android', async () => {
    const { driver, restCalls } = createDriverWithSession({ platform: 'android' });
    await driver.applyDeviceSettings({ animations: 'off' });

    const call = restCalls.find((c) => c.method === 'applySettings');
    expect(call?.args[1]).toMatchObject({ animations: false });
  });

  test('calls applySettings with animations=true for { animations: on } on Android', async () => {
    const { driver, restCalls } = createDriverWithSession({ platform: 'android' });
    await driver.applyDeviceSettings({ animations: 'on' });

    const call = restCalls.find((c) => c.method === 'applySettings');
    expect(call?.args[1]).toMatchObject({ animations: true });
  });

  test('does not call applySettings for animations on iOS', async () => {
    const { driver, restCalls } = createDriverWithSession({ platform: 'ios' });
    await driver.applyDeviceSettings({ animations: 'off' });

    const call = restCalls.find((c) => c.method === 'applySettings');
    expect(call).toBeUndefined();
  });
});

// ─── Disconnect ──────────────────────────────────────────────────────────────

test.describe('SauceLabsDriver.disconnect()', () => {
  test('deletes the Sauce Labs session when this driver created it', async () => {
    const { driver, restCalls } = createDriverWithSession({ ownsSession: true });
    await driver.disconnect();

    const call = restCalls.find((c) => c.method === 'deleteSession');
    expect(call?.args[0]).toBe('sess-123');
  });

  test('leaves the Sauce Labs session alive when this driver only attached to it', async () => {
    const { driver, restCalls } = createDriverWithSession({ ownsSession: false });
    await driver.disconnect();

    const call = restCalls.find((c) => c.method === 'deleteSession');
    expect(call).toBeUndefined();
  });

  test('still closes local sockets and WDA when not owning the session', async () => {
    const { driver, ioSocket, wda } = createDriverWithSession({ ownsSession: false, platform: 'ios' });
    let ioClosed = false;
    ioSocket.disconnect = async () => { ioClosed = true; };
    let wdaClosed = false;
    wda!.close = async () => { wdaClosed = true; };

    await driver.disconnect();

    expect(ioClosed).toBe(true);
    expect(wdaClosed).toBe(true);
  });
});

// ─── Device list ─────────────────────────────────────────────────────────────

test.describe('SauceLabsDriver.listDevices()', () => {
  const descriptors = [
    { id: 'iPhone_15_real', name: 'iPhone 15', os: 'IOS', osVersion: '17.0' },
    { id: 'Samsung_S24_real', name: 'Samsung S24', os: 'ANDROID', osVersion: '14' },
  ];
  const statusResp = {
    devices: [
      { descriptor: 'iPhone_15_real', isPrivateDevice: false, state: 'AVAILABLE' },
      { descriptor: 'Samsung_S24_real', isPrivateDevice: false, state: 'IN_USE' },
    ],
  };

  test('returns merged descriptor + status list', async () => {
    const { driver } = createDriverWithSession({
      restResponses: { listDevices: descriptors, listDeviceStatus: statusResp },
    });
    const devices = await driver.listDevices();

    expect(devices).toHaveLength(2);
    expect(devices[0].id).toBe('iPhone_15_real');
    expect(devices[0].platform).toBe('ios');
    expect(devices[0].state).toBe('online');
    expect(devices[1].state).toBe('offline');
  });

  test('maps IN_USE device state to offline', async () => {
    const { driver } = createDriverWithSession({
      restResponses: { listDevices: descriptors, listDeviceStatus: statusResp },
    });
    const devices = await driver.listDevices();
    expect(devices.find((d) => d.id === 'Samsung_S24_real')?.state).toBe('offline');
  });

  test('filters by platform when opts.platform is set', async () => {
    const { driver } = createDriverWithSession({
      restResponses: { listDevices: descriptors, listDeviceStatus: statusResp },
    });
    const devices = await driver.listDevices({ platform: 'ios' });

    expect(devices.every((d) => d.platform === 'ios')).toBe(true);
    expect(devices).toHaveLength(1);
  });

  test('filters by state when opts.state is set', async () => {
    const { driver } = createDriverWithSession({
      restResponses: { listDevices: descriptors, listDeviceStatus: statusResp },
    });
    const devices = await driver.listDevices({ state: 'online' });

    expect(devices.every((d) => d.state === 'online')).toBe(true);
  });
});

// ─── Recording ───────────────────────────────────────────────────────────────

test.describe('SauceLabsDriver startRecording / stopRecording', () => {
  test('startRecording calls startFrameCapture on the socket', async () => {
    const { driver, ioSocket } = createDriverWithSession();
    await driver.startRecording({ output: '/tmp/out.mp4' });
    expect(ioSocket.isCapturing).toBe(true);
  });

  test('stopRecording returns { output, duration: 0 } when no frames were captured', async () => {
    const { driver } = createDriverWithSession();
    await driver.startRecording({ output: '/tmp/out.mp4' });
    const result = await driver.stopRecording();

    expect(result.output).toBe('/tmp/out.mp4');
    expect(result.duration).toBe(0);
  });

  test('stopRecording throws when called without prior startRecording', async () => {
    const { driver } = createDriverWithSession();
    await expect(driver.stopRecording()).rejects.toThrow('startRecording');
  });
});

// ─── View hierarchy ───────────────────────────────────────────────────────────

test.describe('SauceLabsDriver.getViewHierarchy()', () => {
  test('calls executeShellCommand with uiautomator dump on Android', async () => {
    const { driver, restCalls } = createDriverWithSession({
      platform: 'android',
      restResponses: { executeShellCommand: '<?xml version="1.0"?><hierarchy />' },
    });
    await driver.getViewHierarchy();

    const call = restCalls.find((c) => c.method === 'executeShellCommand');
    expect((call?.args[1] as string)).toContain('uiautomator dump');
  });

  test('parses uiautomator XML into ViewNode array on Android', async () => {
    const xml = `<?xml version="1.0"?>
<hierarchy>
  <node class="android.widget.FrameLayout" bounds="[0,0][1080,1920]" enabled="true" />
</hierarchy>`;
    const { driver } = createDriverWithSession({
      platform: 'android',
      restResponses: { executeShellCommand: xml },
    });
    const nodes = await driver.getViewHierarchy();

    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes[0].type).toBe('hierarchy');
  });

  test('delegates to WDA getSource on iOS', async () => {
    const wdaNodes: ViewNode[] = [{ type: 'XCUIElementTypeWindow', isVisible: true, isEnabled: true, bounds: { x: 0, y: 0, width: 390, height: 844 }, children: [] }];
    const { driver, wda } = createDriverWithSession({
      platform: 'ios',
      wdaResponses: { getSource: wdaNodes },
    });
    const nodes = await driver.getViewHierarchy();

    expect(wda!.calls.find((c) => c.method === 'getSource')).toBeDefined();
    expect(nodes).toEqual(wdaNodes);
  });
});

// ─── waitForActive ────────────────────────────────────────────────────────────

test.describe('waitForActiveSession()', () => {
  function fakeRestReturning(states: Array<{ state: string; links?: Record<string, string> }>) {
    let i = 0;
    return {
      getSession: async (_id: string) => {
        const entry = states[Math.min(i++, states.length - 1)];
        return { id: 'sess-1', state: entry.state, links: entry.links };
      },
    };
  }

  test('returns session when state is ACTIVE and links are present', async () => {
    // Override setTimeout so the test does not actually sleep 5s.
    const origTimeout = globalThis.setTimeout;
    (globalThis as any).setTimeout = (fn: () => void, _ms?: number) => origTimeout(fn, 0);
    try {
      const rest = fakeRestReturning([
        { state: 'ACTIVE', links: { ioWebsocketUrl: 'wss://io', eventsWebsocketUrl: 'wss://ev' } },
      ]);
      const session = await waitForActiveSession(rest as any, 'sess-1', 60_000);
      expect(session.state).toBe('ACTIVE');
    } finally {
      (globalThis as any).setTimeout = origTimeout;
    }
  });

  test('keeps polling when ACTIVE but links are missing', async () => {
    const origTimeout = globalThis.setTimeout;
    (globalThis as any).setTimeout = (fn: () => void, _ms?: number) => origTimeout(fn, 0);
    try {
      const rest = fakeRestReturning([
        { state: 'ACTIVE' },
        { state: 'ACTIVE' },
        { state: 'ACTIVE', links: { ioWebsocketUrl: 'wss://io', eventsWebsocketUrl: 'wss://ev' } },
      ]);
      const session = await waitForActiveSession(rest as any, 'sess-1', 60_000);
      expect(session.links?.ioWebsocketUrl).toBe('wss://io');
    } finally {
      (globalThis as any).setTimeout = origTimeout;
    }
  });

  test('throws immediately on ERRORED state', async () => {
    const origTimeout = globalThis.setTimeout;
    (globalThis as any).setTimeout = (fn: () => void, _ms?: number) => origTimeout(fn, 0);
    try {
      const rest = fakeRestReturning([{ state: 'ERRORED' }]);
      await expect(waitForActiveSession(rest as any, 'sess-1', 60_000)).rejects.toThrow('ERRORED');
    } finally {
      (globalThis as any).setTimeout = origTimeout;
    }
  });

  test('throws immediately on CLOSED state', async () => {
    const origTimeout = globalThis.setTimeout;
    (globalThis as any).setTimeout = (fn: () => void, _ms?: number) => origTimeout(fn, 0);
    try {
      const rest = fakeRestReturning([{ state: 'CLOSED' }]);
      await expect(waitForActiveSession(rest as any, 'sess-1', 60_000)).rejects.toThrow('CLOSED');
    } finally {
      (globalThis as any).setTimeout = origTimeout;
    }
  });

  test('throws timeout error when deadline is exceeded', async () => {
    const origTimeout = globalThis.setTimeout;
    (globalThis as any).setTimeout = (fn: () => void, _ms?: number) => origTimeout(fn, 0);
    try {
      const rest = fakeRestReturning([{ state: 'PENDING' }]);
      // zero-length timeout → deadline already passed
      await expect(waitForActiveSession(rest as any, 'sess-1', 0)).rejects.toThrow('Timed out');
    } finally {
      (globalThis as any).setTimeout = origTimeout;
    }
  });
});

// ─── swipe ────────────────────────────────────────────────────────────────────

test.describe('SauceLabsDriver.swipe()', () => {
  test('sends touch down, move sequence, then touch up', async () => {
    const { driver, ioSocket } = createDriverWithSession({
      resolutionWidth: 1080,
      resolutionHeight: 1920,
      pixelsPerPoint: 1,
    });
    await driver.swipe('up');

    const actions = ioSocket.touchCalls.map((c) => c.action);
    expect(actions[0]).toBe('d');
    expect(actions[actions.length - 1]).toBe('u');
    expect(actions.includes('m')).toBe(true);
  });
});
