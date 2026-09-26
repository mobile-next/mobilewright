import { test, expect } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { DeviceManager } from './lib/device-manager.js';
import { createDevicesRouter } from './routes/devices.js';
import { createInspectRouter } from './routes/inspect.js';

// ---- minimal HTTP helpers ----

interface HttpResponse {
  status: number
  body: unknown
}

function request(method: string, url: string, body: unknown = null): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const payload = body != null ? JSON.stringify(body) : null;
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': String(Buffer.byteLength(payload)) } : {}),
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
    if (payload) req.write(payload);
    req.end();
  });
}

const get  = (url: string)             => request('GET',  url);
const post = (url: string, b: unknown) => request('POST', url, b);

// ---- test server setup ----

function buildApp(dm: DeviceManager) {
  const app = express();
  app.use(express.json());
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/devices', createDevicesRouter(dm));
  app.use('/api', createInspectRouter(dm));
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

async function startServer(dm: DeviceManager): Promise<{ server: http.Server; base: string }> {
  return new Promise((resolve, reject) => {
    const server = buildApp(dm).listen(0);
    server.once('error', reject);
    server.once('listening', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://localhost:${port}` });
    });
  });
}

// ---- GET /health ----

test.describe('GET /health', () => {
  let server: http.Server;
  let base: string;

  test.beforeAll(async () => {
    const dm = new DeviceManager({
      ios: { devices: async () => [], launch: async () => { throw new Error(); } },
      android: { devices: async () => [], launch: async () => { throw new Error(); } },
    })
    ;({ server, base } = await startServer(dm));
  });

  test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  test('returns 200 { ok: true }', async () => {
    const { status, body } = await get(`${base}/health`);
    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
  });
});

// ---- GET /api/devices ----

test.describe('GET /api/devices', () => {
  let server: http.Server;
  let base: string;

  test.beforeAll(async () => {
    const dm = new DeviceManager({
      ios: { devices: async () => [{ id: 'sim-1', name: 'iPhone 15' } as never], launch: async () => { throw new Error(); } },
      android: { devices: async () => [{ id: 'emu-1', name: 'Pixel 7' } as never], launch: async () => { throw new Error(); } },
    })
    ;({ server, base } = await startServer(dm));
  });

  test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  test('returns combined device list with null activeId', async () => {
    const { status, body } = await get(`${base}/api/devices`);
    const b = body as { devices: { id: string }[]; activeId: null };
    expect(status).toBe(200);
    expect(Array.isArray(b.devices)).toBe(true);
    expect(b.devices.length).toBe(2);
    expect(b.devices.some(d => d.id === 'sim-1')).toBe(true);
    expect(b.devices.some(d => d.id === 'emu-1')).toBe(true);
    expect(b.activeId).toBeNull();
  });
});

// ---- POST /api/devices/select?device= ----

test.describe('POST /api/devices/select', () => {
  let server: http.Server;
  let base: string;
  let dm: DeviceManager;
  const launchedWith: string[] = [];

  test.beforeAll(async () => {
    dm = new DeviceManager({
      ios: {
        devices: async () => [{ id: 'sim-1', name: 'iPhone 15' } as never],
        launch: async ({ deviceId }) => { launchedWith.push(`ios:${deviceId}`); return ({ screen: {}, close: async () => {} }) as never; },
      },
      android: {
        devices: async () => [{ id: 'Pixel_9a', name: 'Pixel 9a' } as never],
        launch: async ({ deviceId }) => { launchedWith.push(`android:${deviceId}`); return ({ screen: {}, close: async () => {} }) as never; },
      },
    })
    ;({ server, base } = await startServer(dm));
  });

  test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  test.beforeEach(() => { launchedWith.length = 0; });

  test('returns 400 when device is missing', async () => {
    const { status } = await post(`${base}/api/devices/select`, {});
    expect(status).toBe(400);
  });

  test('returns 404 when device id is unknown', async () => {
    const { status } = await post(`${base}/api/devices/select?device=unknown`, {});
    expect(status).toBe(404);
  });

  test('connects with the platform the device is listed under', async () => {
    const { status, body } = await post(`${base}/api/devices/select?device=Pixel_9a`, {});
    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
    expect(launchedWith).toEqual(['android:Pixel_9a']);
  });

  test('switches devices while an inspect is running, once it finishes', async () => {
    dm.beginInspect();
    const switching = post(`${base}/api/devices/select?device=sim-1`, {});
    setTimeout(() => dm.endInspect(), 20);
    const { status } = await switching;
    expect(status).toBe(200);
    expect(launchedWith).toEqual(['ios:sim-1']);
  });
});

// ---- GET /api/inspect — no device selected ----

test.describe('GET /api/inspect — no device selected', () => {
  let server: http.Server;
  let base: string;

  test.beforeAll(async () => {
    const dm = new DeviceManager({
      ios: { devices: async () => [], launch: async () => { throw new Error(); } },
      android: { devices: async () => [], launch: async () => { throw new Error(); } },
    })
    ;({ server, base } = await startServer(dm));
  });

  test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  test('returns 409 when no device is connected', async () => {
    const { status } = await get(`${base}/api/inspect`);
    expect(status).toBe(409);
  });
});

// ---- GET /api/inspect — inspect already in progress ----

test.describe('GET /api/inspect — inspect already in progress', () => {
  let server: http.Server;
  let base: string;

  test.beforeAll(async () => {
    const dm = new DeviceManager({
      ios: {
        devices: async () => [{ id: 'sim-1', name: 'iPhone 15' } as never],
        launch: async () => ({ screen: {}, close: async () => {} }) as never,
      },
      android: { devices: async () => [], launch: async () => { throw new Error(); } },
    })
    ;({ server, base } = await startServer(dm));
    await dm.select('sim-1', 'ios');
    dm.beginInspect();
  });

  test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  test('returns 503 when inspect is already in flight', async () => {
    const { status } = await get(`${base}/api/inspect`);
    expect(status).toBe(503);
  });
});

// ---- POST /api/tap ----

function deviceManagerWithTapRecorder(taps: { x: number; y: number }[]): DeviceManager {
  return new DeviceManager({
    ios: {
      devices: async () => [{ id: 'sim-1', name: 'iPhone 15' } as never],
      launch: async () => ({
        screen: { tap: async (x: number, y: number) => { taps.push({ x, y }); } },
        close: async () => {},
      }) as never,
    },
    android: { devices: async () => [], launch: async () => { throw new Error(); } },
  });
}

test.describe('POST /api/tap — no device selected', () => {
  let server: http.Server;
  let base: string;

  test.beforeAll(async () => {
    ;({ server, base } = await startServer(deviceManagerWithTapRecorder([])));
  });

  test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  test('returns 409 when no device is connected', async () => {
    const { status } = await post(`${base}/api/tap`, { x: 10, y: 20 });
    expect(status).toBe(409);
  });
});

test.describe('POST /api/tap — device selected', () => {
  let server: http.Server;
  let base: string;
  const taps: { x: number; y: number }[] = [];

  test.beforeAll(async () => {
    const dm = deviceManagerWithTapRecorder(taps);
    ;({ server, base } = await startServer(dm));
    await dm.select('sim-1', 'ios');
  });

  test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  test('returns 400 when coordinates are missing', async () => {
    const { status } = await post(`${base}/api/tap`, { x: 10 });
    expect(status).toBe(400);
  });

  test('returns 400 when coordinates are not numbers', async () => {
    const { status } = await post(`${base}/api/tap`, { x: '10', y: 20 });
    expect(status).toBe(400);
  });

  test('taps the device screen at the given coordinates', async () => {
    const { status } = await post(`${base}/api/tap`, { x: 120, y: 340 });
    expect(status).toBe(200);
    expect(taps).toEqual([{ x: 120, y: 340 }]);
  });
});

// ---- POST /api/press-button ----

function deviceManagerWithButtonRecorder(presses: string[]): DeviceManager {
  return new DeviceManager({
    ios: {
      devices: async () => [{ id: 'sim-1', name: 'iPhone 15' } as never],
      launch: async () => ({
        screen: { pressButton: async (button: string) => { presses.push(button); } },
        close: async () => {},
      }) as never,
    },
    android: { devices: async () => [], launch: async () => { throw new Error(); } },
  });
}

test.describe('POST /api/press-button — no device selected', () => {
  let server: http.Server;
  let base: string;

  test.beforeAll(async () => {
    ;({ server, base } = await startServer(deviceManagerWithButtonRecorder([])));
  });

  test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  test('returns 409 when no device is connected', async () => {
    const { status } = await post(`${base}/api/press-button`, { button: 'HOME' });
    expect(status).toBe(409);
  });
});

test.describe('POST /api/press-button — device selected', () => {
  let server: http.Server;
  let base: string;
  const presses: string[] = [];

  test.beforeAll(async () => {
    const dm = deviceManagerWithButtonRecorder(presses);
    ;({ server, base } = await startServer(dm));
    await dm.select('sim-1', 'ios');
  });

  test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  test('returns 400 for a button the recorder does not offer', async () => {
    const { status } = await post(`${base}/api/press-button`, { button: 'POWER' });
    expect(status).toBe(400);
  });

  test('presses home, back and app switch on the device', async () => {
    for (const button of ['HOME', 'BACK', 'APP_SWITCH']) {
      const { status } = await post(`${base}/api/press-button`, { button });
      expect(status).toBe(200);
    }
    expect(presses).toEqual(['HOME', 'BACK', 'APP_SWITCH']);
  });
});

// ---- GET /api/inspect?scale= ----

function deviceManagerWithScreenshotRecorder(screenshotOptions: unknown[]): DeviceManager {
  return new DeviceManager({
    ios: {
      devices: async () => [{ id: 'sim-1', name: 'iPhone 15' } as never],
      launch: async () => ({
        screen: {
          screenshot: async (opts: unknown) => { screenshotOptions.push(opts); return Buffer.from('png'); },
          viewTree: async () => [],
        },
        screenSize: async () => ({ width: 390, height: 844, scale: 3 }),
        close: async () => {},
      }) as never,
    },
    android: { devices: async () => [], launch: async () => { throw new Error(); } },
  });
}

test.describe('GET /api/inspect — screenshot scale', () => {
  let server: http.Server;
  let base: string;
  const screenshotOptions: unknown[] = [];

  test.beforeAll(async () => {
    const dm = deviceManagerWithScreenshotRecorder(screenshotOptions);
    ;({ server, base } = await startServer(dm));
    await dm.select('sim-1', 'ios');
  });

  test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  test.beforeEach(() => { screenshotOptions.length = 0; });

  for (const scale of ['0', '-1', '1.5', 'half']) {
    test(`returns 400 for scale=${scale}`, async () => {
      const { status } = await get(`${base}/api/inspect?scale=${scale}`);
      expect(status).toBe(400);
    });
  }

  test('asks the device for a JPEG screenshot at the requested scale', async () => {
    const { status, body } = await get(`${base}/api/inspect?scale=0.5`);
    expect(status).toBe(200);
    expect(screenshotOptions).toEqual([{ format: 'jpeg', quality: 60, scale: 0.5 }]);
    expect((body as { screenshot: string }).screenshot.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  test('takes a full-size screenshot when no scale is given', async () => {
    await get(`${base}/api/inspect`);
    expect(screenshotOptions).toEqual([{ format: 'jpeg', quality: 60, scale: 1 }]);
  });

  test('reports the device pixel scale so the page can size its request', async () => {
    const { body } = await get(`${base}/api/inspect`);
    expect((body as { screen: unknown }).screen).toEqual({ width: 390, height: 844, scale: 3 });
  });
});

// ---- GET /api/inspect?etag= ----

function deviceManagerWithChangingScreen(screen: { png: string }): DeviceManager {
  return new DeviceManager({
    ios: {
      devices: async () => [{ id: 'sim-1', name: 'iPhone 15' } as never],
      launch: async () => ({
        screen: {
          screenshot: async () => Buffer.from(screen.png),
          viewTree: async () => [],
        },
        screenSize: async () => ({ width: 390, height: 844, scale: 3 }),
        close: async () => {},
      }) as never,
    },
    android: { devices: async () => [], launch: async () => { throw new Error(); } },
  });
}

test.describe('GET /api/inspect — etag', () => {
  let server: http.Server;
  let base: string;
  const screen = { png: 'first frame' };

  test.beforeAll(async () => {
    const dm = deviceManagerWithChangingScreen(screen);
    ;({ server, base } = await startServer(dm));
    await dm.select('sim-1', 'ios');
  });

  test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  async function inspectEtag(query = ''): Promise<string> {
    const { body } = await get(`${base}/api/inspect${query}`);
    return (body as { etag: string }).etag;
  }

  test('returns an etag with the inspect payload', async () => {
    expect(await inspectEtag()).toMatch(/^[0-9a-f]{40}$/);
  });

  test('returns 304 with no payload when the screen has not changed since the given etag', async () => {
    const etag = await inspectEtag();
    const { status, body } = await get(`${base}/api/inspect?etag=${etag}`);
    expect(status).toBe(304);
    expect(body).toBe('');
  });

  test('returns the full payload when the given etag is stale', async () => {
    const { status } = await get(`${base}/api/inspect?etag=0000000000000000000000000000000000000000`);
    expect(status).toBe(200);
  });

  test('returns a new etag once the screenshot changes', async () => {
    const before = await inspectEtag();
    screen.png = 'second frame';
    const { status, body } = await get(`${base}/api/inspect?etag=${before}`);
    expect(status).toBe(200);
    expect((body as { etag: string }).etag).not.toBe(before);
  });
});

// ---- POST /api/geolocation ----

function deviceManagerWithGeolocationRecorder(calls: unknown[]): DeviceManager {
  return new DeviceManager({
    ios: {
      devices: async () => [{ id: 'sim-1', name: 'iPhone 15' } as never],
      launch: async () => ({
        screen: {},
        setGeolocation: async (geolocation: unknown) => { calls.push(geolocation); },
        close: async () => {},
      }) as never,
    },
    android: { devices: async () => [], launch: async () => { throw new Error(); } },
  });
}

test.describe('POST /api/geolocation — no device selected', () => {
  let server: http.Server;
  let base: string;

  test.beforeAll(async () => {
    ;({ server, base } = await startServer(deviceManagerWithGeolocationRecorder([])));
  });

  test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  test('returns 409 when no device is connected', async () => {
    const { status } = await post(`${base}/api/geolocation`, { geolocation: { latitude: -17.833, longitude: 177.947 } });
    expect(status).toBe(409);
  });
});

test.describe('POST /api/geolocation — device selected', () => {
  let server: http.Server;
  let base: string;
  const calls: unknown[] = [];

  test.beforeAll(async () => {
    const dm = deviceManagerWithGeolocationRecorder(calls);
    ;({ server, base } = await startServer(dm));
    await dm.select('sim-1', 'ios');
  });

  test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  test.beforeEach(() => { calls.length = 0; });

  const invalidBodies = [
    ['missing geolocation', {}],
    ['latitude out of range', { geolocation: { latitude: 91, longitude: 0 } }],
    ['longitude out of range', { geolocation: { latitude: 0, longitude: -181 } }],
    ['non-numeric latitude', { geolocation: { latitude: '1', longitude: 0 } }],
  ] as const;
  for (const [description, body] of invalidBodies) {
    test(`returns 400 for ${description}`, async () => {
      const { status } = await post(`${base}/api/geolocation`, body);
      expect(status).toBe(400);
      expect(calls).toEqual([]);
    });
  }

  test('sets the device location', async () => {
    const { status } = await post(`${base}/api/geolocation`, { geolocation: { latitude: -17.833, longitude: 177.947 } });
    expect(status).toBe(200);
    expect(calls).toEqual([{ latitude: -17.833, longitude: 177.947 }]);
  });

  test('resets the device location when geolocation is null', async () => {
    const { status } = await post(`${base}/api/geolocation`, { geolocation: null });
    expect(status).toBe(200);
    expect(calls).toEqual([null]);
  });
});

// ---- POST /api/tap with gesture ----

function deviceManagerWithGestureRecorder(gestures: string[]): DeviceManager {
  const record = (name: string) => async (x: number, y: number) => { gestures.push(`${name}(${x}, ${y})`); };
  return new DeviceManager({
    ios: {
      devices: async () => [{ id: 'sim-1', name: 'iPhone 15' } as never],
      launch: async () => ({
        screen: { tap: record('tap'), doubleTap: record('doubleTap'), longPress: record('longPress') },
        close: async () => {},
      }) as never,
    },
    android: { devices: async () => [], launch: async () => { throw new Error(); } },
  });
}

test.describe('POST /api/tap — gestures', () => {
  let server: http.Server;
  let base: string;
  const gestures: string[] = [];

  test.beforeAll(async () => {
    const dm = deviceManagerWithGestureRecorder(gestures);
    ;({ server, base } = await startServer(dm));
    await dm.select('sim-1', 'ios');
  });

  test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  test.beforeEach(() => { gestures.length = 0; });

  test('double taps and long presses at the given coordinates', async () => {
    await post(`${base}/api/tap`, { x: 10, y: 20, gesture: 'doubleTap' });
    await post(`${base}/api/tap`, { x: 30, y: 40, gesture: 'longPress' });
    expect(gestures).toEqual(['doubleTap(10, 20)', 'longPress(30, 40)']);
  });

  test('taps when no gesture is given', async () => {
    await post(`${base}/api/tap`, { x: 5, y: 6 });
    expect(gestures).toEqual(['tap(5, 6)']);
  });

  test('returns 400 for an unknown gesture', async () => {
    const { status } = await post(`${base}/api/tap`, { x: 5, y: 6, gesture: 'swipe' });
    expect(status).toBe(400);
    expect(gestures).toEqual([]);
  });
});

// ---- GET /api/inspect — screen size cache ----

test.describe('GET /api/inspect — screen size', () => {
  let server: http.Server;
  let base: string;
  let screenSizeCalls = 0;

  test.beforeAll(async () => {
    const dm = new DeviceManager({
      ios: {
        devices: async () => [{ id: 'sim-1', name: 'iPhone 15' } as never],
        launch: async () => ({
          screen: { screenshot: async () => Buffer.from('png'), viewTree: async () => [] },
          screenSize: async () => { screenSizeCalls++; return { width: 390, height: 844, scale: 3 }; },
          close: async () => {},
        }) as never,
      },
      android: { devices: async () => [], launch: async () => { throw new Error(); } },
    });
    ;({ server, base } = await startServer(dm));
    await dm.select('sim-1', 'ios');
  });

  test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  test('asks the device for its screen size only once', async () => {
    await get(`${base}/api/inspect`);
    const { body } = await get(`${base}/api/inspect`);
    expect(screenSizeCalls).toBe(1);
    expect((body as { screen: unknown }).screen).toEqual({ width: 390, height: 844, scale: 3 });
  });
});
