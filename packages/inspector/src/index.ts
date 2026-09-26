import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { DeviceManager, type MobilewrightLauncher } from './lib/device-manager.js';
import { createDevicesRouter } from './routes/devices.js';
import { createInspectRouter } from './routes/inspect.js';
import { createDeviceActionsRouter } from './routes/device-actions.js';

export type { MobilewrightLauncher };

/** Options passed to {@link start}. */
export interface InspectorOptions {
  /** iOS launcher from mobilewright. */
  ios: MobilewrightLauncher;
  /** Android launcher from mobilewright. */
  android: MobilewrightLauncher;
  /** HTTP port to listen on. Defaults to 4621. */
  port?: number;
}

/** Handle returned by {@link start} to retrieve the server URL and shut it down. */
export interface InspectorServer {
  /** The URL the inspector is listening on, e.g. `http://localhost:4621`. */
  url: string;
  /** Gracefully close the device connection and stop the HTTP server. */
  close: () => Promise<void>;
}

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** Hostnames that address this machine. */
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Only answer requests addressed to a loopback hostname. With DNS rebinding, a page on another site
 * can point its own hostname at 127.0.0.1 and then call this server as a same-origin page, which
 * the JSON-only rule below does not stop; its requests still carry that foreign Host header.
 */
const rejectNonLoopbackHosts: express.RequestHandler = (req, res, next) => {
  if (!LOOPBACK_HOSTNAMES.has(req.hostname)) {
    res.status(403).json({ error: 'The Inspector only answers requests addressed to localhost' });
    return;
  }
  next();
};

/**
 * Every POST must be JSON. A page on another site can send a "simple" POST (form, text/plain or no
 * body) straight to localhost without a CORS preflight; requiring JSON forces the preflight, which
 * this server never answers, so only the Inspector's own pages can drive the device.
 */
const rejectNonJsonPosts: express.RequestHandler = (req, res, next) => {
  if (req.method === 'POST' && !req.is('application/json')) {
    res.status(415).json({ error: 'POST requests must send a JSON body' });
    return;
  }
  next();
};

/** The Inspector's Express app, without listening; split out so tests can drive it directly. */
export function createApp(deviceManager: DeviceManager): express.Express {
  const app = express();
  app.use(rejectNonLoopbackHosts);
  app.use(rejectNonJsonPosts);
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/devices', createDevicesRouter(deviceManager));
  app.use('/api', createInspectRouter(deviceManager));
  app.use('/api', createDeviceActionsRouter(deviceManager));

  // 4-argument signature is required by Express to treat this as an error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

/**
 * Start the Mobilewright Inspector HTTP server.
 * Pass the ios and android launcher objects from mobilewright so the inspector
 * can list and connect to devices without a circular dependency.
 */
export async function start({ ios, android, port = 4621 }: InspectorOptions): Promise<InspectorServer> {
  const deviceManager = new DeviceManager({ ios, android });
  const server = http.createServer(createApp(deviceManager));

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  const assignedPort = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${assignedPort}`;

  /** Gracefully drain the device connection and shut down the HTTP server. */
  async function close(): Promise<void> {
    await new Promise<void>(resolve => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    await Promise.race([
      deviceManager.close().catch(() => {}),
      new Promise(r => setTimeout(r, 3000)),
    ]);
  }

  return { url, close };
}
