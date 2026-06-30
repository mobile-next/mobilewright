import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { DeviceManager, type MobilewrightLauncher } from './lib/device-manager.js';
import { createDevicesRouter } from './routes/devices.js';
import { createInspectRouter } from './routes/inspect.js';

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

/**
 * Start the Mobilewright Inspector HTTP server.
 * Pass the ios and android launcher objects from mobilewright so the inspector
 * can list and connect to devices without a circular dependency.
 */
export async function start({ ios, android, port = 4621 }: InspectorOptions): Promise<InspectorServer> {
  const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

  const app = express();
  app.use(express.json());
  app.use(express.static(publicDir));
  app.get('/health', (_req, res) => res.json({ ok: true }));

  const deviceManager = new DeviceManager({ ios, android });
  app.use('/api/devices', createDevicesRouter(deviceManager));
  app.use('/api', createInspectRouter(deviceManager));

  // 4-argument signature is required by Express to treat this as an error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });

  const server = http.createServer(app);

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
