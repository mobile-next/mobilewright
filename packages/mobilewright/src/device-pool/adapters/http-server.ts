import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { DevicePool } from '../application/device-pool.js';
import type { AllocationCriteria, AllocationHandle } from '../application/ports.js';

interface AllocateRequest {
  criteria: AllocationCriteria;
}

interface ReleaseRequest {
  allocationId: string;
}

interface InstallRequest {
  allocationId: string;
  bundleId: string;
}

export interface DevicePoolHttpServerOptions {
  pool: DevicePool;
}

export class DevicePoolHttpServer {
  private readonly pool: DevicePool;
  private readonly server: Server;
  private readonly responsesByAllocationId = new Map<string, ServerResponse>();

  constructor(options: DevicePoolHttpServerOptions) {
    this.pool = options.pool;
    this.server = createServer((req, res) => this.handle(req, res));
  }

  async listen(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server.address();
        if (typeof address === 'string' || address === null) {
          reject(new Error('expected AddressInfo'));
          return;
        }
        resolve(address.port);
      });
    });
  }

  async close(): Promise<void> {
    return new Promise<void>((resolve) => {
      for (const res of this.responsesByAllocationId.values()) {
        res.end();
        res.socket?.destroy();
      }
      this.responsesByAllocationId.clear();
      this.server.close(() => resolve());
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end();
      return;
    }
    switch (req.url) {
      case '/allocate': await this.handleAllocate(req, res); return;
      case '/release': await this.handleRelease(req, res); return;
      case '/installed/is-installed': await this.handleIsAppInstalled(req, res); return;
      case '/installed/record': await this.handleRecordAppInstalled(req, res); return;
      case '/shutdown': await this.handleShutdown(req, res); return;
      default:
        res.statusCode = 404;
        res.end();
    }
  }

  private async handleIsAppInstalled(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson<InstallRequest>(req);
    const installed = this.pool.isAppInstalled(body.allocationId, body.bundleId);
    res.statusCode = 200;
    res.end(JSON.stringify({ installed }));
  }

  private async handleRecordAppInstalled(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson<InstallRequest>(req);
    this.pool.recordAppInstalled(body.allocationId, body.bundleId);
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  }

  private async handleShutdown(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    await this.pool.shutdown();
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  }

  private async handleAllocate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson<AllocateRequest>(req);
    let handle: AllocationHandle;
    try {
      handle = await this.pool.allocate(body.criteria ?? {});
    } catch (err) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: (err as Error).message }));
      return;
    }
    this.responsesByAllocationId.set(handle.allocationId, res);

    const onClose = () => {
      if (this.responsesByAllocationId.get(handle.allocationId) === res) {
        this.responsesByAllocationId.delete(handle.allocationId);
        void this.pool.release(handle.allocationId);
      }
    };
    res.on('close', onClose);

    res.statusCode = 200;
    res.setHeader('content-type', 'application/x-ndjson');
    res.write(JSON.stringify(handle) + '\n');
  }

  private async handleRelease(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson<ReleaseRequest>(req);
    await this.pool.release(body.allocationId);
    const heldResponse = this.responsesByAllocationId.get(body.allocationId);
    if (heldResponse) {
      this.responsesByAllocationId.delete(body.allocationId);
      heldResponse.end();
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  }
}

function readJson<T>(req: IncomingMessage): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text.length === 0 ? ({} as T) : JSON.parse(text) as T);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}
