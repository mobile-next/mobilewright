import { test, expect } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Device } from '@mobilewright/core';
import { DeviceManager, type MobilewrightLauncher } from './lib/device-manager.js';
import { createApp } from './index.js';

// ---- minimal HTTP helpers ----

interface HttpResponse {
  status: number
  body: unknown
}

type Headers = Record<string, string>;

function request(method: string, url: string, body: string | null, headers: Headers): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        ...headers,
        ...(body !== null ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}),
      },
    }, res => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode ?? 0, body: data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(new Error(`${method} ${parsed.pathname} timed out`)); });
    if (body !== null) {
      req.write(body);
    }
    req.end();
  });
}

const get = (url: string) => request('GET', url, null, {});
const post = (url: string, body: unknown) => request('POST', url, JSON.stringify(body), { 'Content-Type': 'application/json' });
const postAsForm = (url: string) => request('POST', url, 'x=1', { 'Content-Type': 'application/x-www-form-urlencoded' });

// ---- test server and fake devices ----

interface TestServer {
  base: string
  deviceManager: DeviceManager
  close: () => Promise<void>
}

const NO_DEVICES: MobilewrightLauncher = { devices: async () => [], launch: async () => { throw new Error('no devices'); } };

/** A launcher with one iPhone, sim-1, that launches as `fakeDevice` (a partial Device). */
function iPhoneLauncher(fakeDevice: object = {}): MobilewrightLauncher {
  return {
    devices: async () => [{ id: 'sim-1', name: 'iPhone 15' } as never],
    launch: async () => ({ screen: {}, close: async () => {}, ...fakeDevice }) as unknown as Device,
  };
}

async function serve(deviceManager: DeviceManager): Promise<TestServer> {
  const server = createApp(deviceManager).listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://localhost:${port}`,
    deviceManager,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

function serveWithoutDevice(fakeDevice: object = {}): Promise<TestServer> {
  return serve(new DeviceManager({ ios: iPhoneLauncher(fakeDevice), android: NO_DEVICES }));
}

/** Serves an Inspector already connected to sim-1, which behaves as `fakeDevice`. */
async function serveWithDevice(fakeDevice: object): Promise<TestServer> {
  const server = await serveWithoutDevice(fakeDevice);
  await server.deviceManager.select('sim-1', 'ios');
  return server;
}

/** A device the inspect endpoint can capture: fixed screenshot, empty tree, 390x844 at 3x. */
function inspectableDevice(overrides: { screenshot?: (opts: unknown) => Promise<Buffer>; screenSize?: () => Promise<unknown> } = {}) {
  return {
    screen: {
      screenshot: overrides.screenshot ?? (async () => Buffer.from('jpeg')),
      viewTree: async () => [],
    },
    screenSize: overrides.screenSize ?? (async () => ({ width: 390, height: 844, scale: 3 })),
  };
}

// ---- GET /health ----

test.describe('GET /health', () => {
  let server: TestServer;
  test.beforeAll(async () => { server = await serveWithoutDevice(); });
  test.afterAll(() => server.close());

  test('returns 200 { ok: true }', async () => {
    const { status, body } = await get(`${server.base}/health`);
    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
  });
});

// ---- JSON-only POSTs ----

test.describe('POST requests', () => {
  let server: TestServer;
  test.beforeAll(async () => { server = await serveWithoutDevice(); });
  test.afterAll(() => server.close());

  // A cross-site page can send these without a CORS preflight, so they must never reach a route.
  for (const path of ['/api/devices/select?device=sim-1', '/api/tap', '/api/press-button', '/api/geolocation']) {
    test(`${path} rejects a non-JSON body with 415`, async () => {
      const { status } = await postAsForm(`${server.base}${path}`);
      expect(status).toBe(415);
      expect(server.deviceManager.device).toBeNull();
    });
  }
});

// ---- GET /api/devices ----

test.describe('GET /api/devices', () => {
  let server: TestServer;

  test.beforeAll(async () => {
    server = await serve(new DeviceManager({
      ios: iPhoneLauncher(),
      android: { devices: async () => [{ id: 'emu-1', name: 'Pixel 7' } as never], launch: NO_DEVICES.launch },
    }));
  });
  test.afterAll(() => server.close());

  test('returns combined device list with null activeId', async () => {
    const { status, body } = await get(`${server.base}/api/devices`);
    const b = body as { devices: { id: string }[]; activeId: null };
    expect(status).toBe(200);
    expect(b.devices.map(d => d.id).sort()).toEqual(['emu-1', 'sim-1']);
    expect(b.activeId).toBeNull();
  });
});

// ---- POST /api/devices/select?device= ----

test.describe('POST /api/devices/select', () => {
  let server: TestServer;
  const launchedWith: string[] = [];

  test.beforeAll(async () => {
    const recordingLauncher = (platform: string, id: string, name: string): MobilewrightLauncher => ({
      devices: async () => [{ id, name } as never],
      launch: async ({ deviceId }) => {
        launchedWith.push(`${platform}:${deviceId}`);
        return ({ screen: {}, close: async () => {} }) as unknown as Device;
      },
    });
    server = await serve(new DeviceManager({
      ios: recordingLauncher('ios', 'sim-1', 'iPhone 15'),
      android: recordingLauncher('android', 'Pixel_9a', 'Pixel 9a'),
    }));
  });
  test.afterAll(() => server.close());
  test.beforeEach(() => { launchedWith.length = 0; });

  test('returns 400 when device is missing', async () => {
    const { status } = await post(`${server.base}/api/devices/select`, {});
    expect(status).toBe(400);
  });

  test('returns 404 when device id is unknown', async () => {
    const { status } = await post(`${server.base}/api/devices/select?device=unknown`, {});
    expect(status).toBe(404);
  });

  test('connects with the platform the device is listed under', async () => {
    const { status, body } = await post(`${server.base}/api/devices/select?device=Pixel_9a`, {});
    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
    expect(launchedWith).toEqual(['android:Pixel_9a']);
  });

  test('switches devices while an inspect is running, once it finishes', async () => {
    server.deviceManager.beginInspect();
    const switching = post(`${server.base}/api/devices/select?device=sim-1`, {});
    setTimeout(() => server.deviceManager.endInspect(), 20);
    const { status } = await switching;
    expect(status).toBe(200);
    expect(launchedWith).toEqual(['ios:sim-1']);
  });
});

// ---- GET /api/inspect ----

test.describe('GET /api/inspect — no device selected', () => {
  let server: TestServer;
  test.beforeAll(async () => { server = await serveWithoutDevice(); });
  test.afterAll(() => server.close());

  test('returns 409 when no device is connected', async () => {
    const { status } = await get(`${server.base}/api/inspect`);
    expect(status).toBe(409);
  });
});

test.describe('GET /api/inspect — busy', () => {
  let server: TestServer;
  test.beforeEach(async () => { server = await serveWithDevice(inspectableDevice()); });
  test.afterEach(() => server.close());

  test('returns 503 when inspect is already in flight', async () => {
    server.deviceManager.beginInspect();
    const { status } = await get(`${server.base}/api/inspect`);
    expect(status).toBe(503);
  });
});

test.describe('GET /api/inspect — while switching devices', () => {
  let server: TestServer;
  let finishSwitching: () => void = () => {};

  test.beforeAll(async () => {
    // The first connect is immediate; any later one hangs until finishSwitching() is called.
    let launches = 0;
    server = await serve(new DeviceManager({
      ios: {
        devices: iPhoneLauncher().devices,
        launch: async () => {
          launches++;
          if (launches > 1) {
            await new Promise<void>(resolve => { finishSwitching = resolve; });
          }
          return ({ ...inspectableDevice(), close: async () => {} }) as unknown as Device;
        },
      },
      android: NO_DEVICES,
    }));
    await server.deviceManager.select('sim-1', 'ios');
  });
  test.afterAll(() => server.close());

  test('returns 503, not "disconnected"', async () => {
    // Mid-switch the old device is already closed and the new one is not connected yet.
    const switching = server.deviceManager.select('sim-1', 'ios');

    const { status } = await get(`${server.base}/api/inspect`);

    expect(status).toBe(503);
    finishSwitching();
    await switching;
  });
});

test.describe('GET /api/inspect — screenshot scale', () => {
  let server: TestServer;
  const screenshotOptions: unknown[] = [];

  test.beforeAll(async () => {
    server = await serveWithDevice(inspectableDevice({
      screenshot: async opts => { screenshotOptions.push(opts); return Buffer.from('jpeg'); },
    }));
  });
  test.afterAll(() => server.close());
  test.beforeEach(() => { screenshotOptions.length = 0; });

  for (const scale of ['0', '-1', '1.5', 'half']) {
    test(`returns 400 for scale=${scale}`, async () => {
      const { status } = await get(`${server.base}/api/inspect?scale=${scale}`);
      expect(status).toBe(400);
    });
  }

  test('asks the device for a JPEG screenshot at the requested scale', async () => {
    const { status, body } = await get(`${server.base}/api/inspect?scale=0.5`);
    expect(status).toBe(200);
    expect(screenshotOptions).toEqual([{ format: 'jpeg', quality: 60, scale: 0.5 }]);
    expect((body as { screenshot: string }).screenshot.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  test('takes a full-size screenshot when no scale is given', async () => {
    await get(`${server.base}/api/inspect`);
    expect(screenshotOptions).toEqual([{ format: 'jpeg', quality: 60, scale: 1 }]);
  });

  test('reports the device pixel scale so the page can size its request', async () => {
    const { body } = await get(`${server.base}/api/inspect`);
    expect((body as { screen: unknown }).screen).toEqual({ width: 390, height: 844, scale: 3 });
  });
});

test.describe('GET /api/inspect — etag', () => {
  let server: TestServer;
  const frame = { content: 'first frame' };

  test.beforeAll(async () => {
    server = await serveWithDevice(inspectableDevice({ screenshot: async () => Buffer.from(frame.content) }));
  });
  test.afterAll(() => server.close());

  async function inspectEtag(query = ''): Promise<string> {
    const { body } = await get(`${server.base}/api/inspect${query}`);
    return (body as { etag: string }).etag;
  }

  test('returns an etag with the inspect payload', async () => {
    expect(await inspectEtag()).toMatch(/^[0-9a-f]{40}$/);
  });

  test('returns 304 with no payload when the screen has not changed since the given etag', async () => {
    const etag = await inspectEtag();
    const { status, body } = await get(`${server.base}/api/inspect?etag=${etag}`);
    expect(status).toBe(304);
    expect(body).toBe('');
  });

  test('returns the full payload when the given etag is stale', async () => {
    const { status } = await get(`${server.base}/api/inspect?etag=0000000000000000000000000000000000000000`);
    expect(status).toBe(200);
  });

  test('returns a new etag once the screenshot changes', async () => {
    const before = await inspectEtag();
    frame.content = 'second frame';
    const { status, body } = await get(`${server.base}/api/inspect?etag=${before}`);
    expect(status).toBe(200);
    expect((body as { etag: string }).etag).not.toBe(before);
  });
});

test.describe('GET /api/inspect — screen size', () => {
  let server: TestServer;
  let screenSizeCalls = 0;

  test.beforeAll(async () => {
    server = await serveWithDevice(inspectableDevice({
      screenSize: async () => { screenSizeCalls++; return { width: 390, height: 844, scale: 3 }; },
    }));
  });
  test.afterAll(() => server.close());

  test('asks the device for its screen size only once', async () => {
    await get(`${server.base}/api/inspect`);
    const { body } = await get(`${server.base}/api/inspect`);
    expect(screenSizeCalls).toBe(1);
    expect((body as { screen: unknown }).screen).toEqual({ width: 390, height: 844, scale: 3 });
  });
});

// ---- device actions: common behavior ----

test.describe('device actions — no device selected', () => {
  let server: TestServer;
  test.beforeAll(async () => { server = await serveWithoutDevice(); });
  test.afterAll(() => server.close());

  const validBodies = {
    '/api/tap': { x: 10, y: 20 },
    '/api/press-button': { button: 'HOME' },
    '/api/geolocation': { geolocation: { latitude: -17.833, longitude: 177.947 } },
  };
  for (const [path, body] of Object.entries(validBodies)) {
    test(`${path} returns 409 when no device is connected`, async () => {
      const { status } = await post(`${server.base}${path}`, body);
      expect(status).toBe(409);
    });
  }
});

// ---- POST /api/tap ----

test.describe('POST /api/tap', () => {
  let server: TestServer;
  const gestures: string[] = [];

  test.beforeAll(async () => {
    const record = (name: string) => async (x: number, y: number) => { gestures.push(`${name}(${x}, ${y})`); };
    server = await serveWithDevice({ screen: { tap: record('tap'), doubleTap: record('doubleTap'), longPress: record('longPress') } });
  });
  test.afterAll(() => server.close());
  test.beforeEach(() => { gestures.length = 0; });

  test('returns 400 when coordinates are missing', async () => {
    const { status } = await post(`${server.base}/api/tap`, { x: 10 });
    expect(status).toBe(400);
  });

  test('returns 400 when coordinates are not numbers', async () => {
    const { status } = await post(`${server.base}/api/tap`, { x: '10', y: 20 });
    expect(status).toBe(400);
  });

  test('taps the device screen at the given coordinates', async () => {
    const { status } = await post(`${server.base}/api/tap`, { x: 120, y: 340 });
    expect(status).toBe(200);
    expect(gestures).toEqual(['tap(120, 340)']);
  });

  test('double taps and long presses at the given coordinates', async () => {
    await post(`${server.base}/api/tap`, { x: 10, y: 20, gesture: 'doubleTap' });
    await post(`${server.base}/api/tap`, { x: 30, y: 40, gesture: 'longPress' });
    expect(gestures).toEqual(['doubleTap(10, 20)', 'longPress(30, 40)']);
  });

  test('returns 400 for an unknown gesture', async () => {
    const { status } = await post(`${server.base}/api/tap`, { x: 5, y: 6, gesture: 'swipe' });
    expect(status).toBe(400);
    expect(gestures).toEqual([]);
  });
});

// ---- POST /api/press-button ----

test.describe('POST /api/press-button', () => {
  let server: TestServer;
  const presses: string[] = [];

  test.beforeAll(async () => {
    server = await serveWithDevice({ screen: { pressButton: async (button: string) => { presses.push(button); } } });
  });
  test.afterAll(() => server.close());
  test.beforeEach(() => { presses.length = 0; });

  test('returns 400 for a button the recorder does not offer', async () => {
    const { status } = await post(`${server.base}/api/press-button`, { button: 'POWER' });
    expect(status).toBe(400);
  });

  test('presses home, back and app switch on the device', async () => {
    for (const button of ['HOME', 'BACK', 'APP_SWITCH']) {
      const { status } = await post(`${server.base}/api/press-button`, { button });
      expect(status).toBe(200);
    }
    expect(presses).toEqual(['HOME', 'BACK', 'APP_SWITCH']);
  });
});

// ---- POST /api/geolocation ----

test.describe('POST /api/geolocation', () => {
  let server: TestServer;
  const calls: unknown[] = [];

  test.beforeAll(async () => {
    server = await serveWithDevice({ setGeolocation: async (geolocation: unknown) => { calls.push(geolocation); } });
  });
  test.afterAll(() => server.close());
  test.beforeEach(() => { calls.length = 0; });

  const invalidBodies = [
    ['missing geolocation', {}],
    ['latitude out of range', { geolocation: { latitude: 91, longitude: 0 } }],
    ['longitude out of range', { geolocation: { latitude: 0, longitude: -181 } }],
    ['non-numeric latitude', { geolocation: { latitude: '1', longitude: 0 } }],
  ] as const;
  for (const [description, body] of invalidBodies) {
    test(`returns 400 for ${description}`, async () => {
      const { status } = await post(`${server.base}/api/geolocation`, body);
      expect(status).toBe(400);
      expect(calls).toEqual([]);
    });
  }

  test('sets the device location', async () => {
    const { status } = await post(`${server.base}/api/geolocation`, { geolocation: { latitude: -17.833, longitude: 177.947 } });
    expect(status).toBe(200);
    expect(calls).toEqual([{ latitude: -17.833, longitude: 177.947 }]);
  });

  test('resets the device location when geolocation is null', async () => {
    const { status } = await post(`${server.base}/api/geolocation`, { geolocation: null });
    expect(status).toBe(200);
    expect(calls).toEqual([null]);
  });
});
