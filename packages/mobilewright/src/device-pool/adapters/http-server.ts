import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { DevicePool } from '../application/device-pool.js';
import type { AllocationCriteria, AllocationHandle } from '../application/ports.js';

export interface DevicePoolHttpServerOptions {
  pool: DevicePool;
}

export class DevicePoolHttpServer {
  private readonly pool: DevicePool;
  private readonly server: Server;
  private readonly socketsByAllocationId = new Map<string, Socket>();

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
      for (const socket of this.socketsByAllocationId.values()) {
        socket.destroy();
      }
      this.socketsByAllocationId.clear();
      this.server.close(() => resolve());
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end();
      return;
    }
    if (req.url === '/allocate') {
      await this.handleAllocate(req, res);
      return;
    }
    res.statusCode = 404;
    res.end();
  }

  private async handleAllocate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson<{ criteria: AllocationCriteria }>(req);
    let handle: AllocationHandle;
    try {
      handle = await this.pool.allocate(body.criteria ?? {});
    } catch (err) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: (err as Error).message }));
      return;
    }
    this.socketsByAllocationId.set(handle.allocationId, req.socket);
    res.statusCode = 200;
    res.setHeader('content-type', 'application/x-ndjson');
    res.write(JSON.stringify(handle) + '\n');
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
