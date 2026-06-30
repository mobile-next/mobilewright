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

// ---- POST /api/devices/:id/select ----

test.describe('POST /api/devices/:id/select', () => {
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
  });

  test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  test('returns 400 when platform is missing', async () => {
    const { status } = await post(`${base}/api/devices/sim-1/select`, {});
    expect(status).toBe(400);
  });

  test('returns 400 when platform is invalid', async () => {
    const { status } = await post(`${base}/api/devices/sim-1/select`, { platform: 'windows' });
    expect(status).toBe(400);
  });

  test('returns 404 when device id is unknown', async () => {
    const { status } = await post(`${base}/api/devices/unknown/select`, { platform: 'ios' });
    expect(status).toBe(404);
  });

  test('returns 200 when device exists and connect succeeds', async () => {
    const { status, body } = await post(`${base}/api/devices/sim-1/select`, { platform: 'ios' });
    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
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
