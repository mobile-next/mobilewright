import { Agent, request, type ClientRequest } from 'node:http';
import type {
  AllocationCriteria,
  AllocationHandle,
  DevicePoolClient,
} from '../application/ports.js';

export interface HttpDevicePoolClientOptions {
  baseUrl: string;
}

export class HttpDevicePoolClient implements DevicePoolClient {
  private readonly baseUrl: string;
  private readonly agent: Agent;
  private readonly openAllocateRequests = new Map<string, ClientRequest>();

  constructor(options: HttpDevicePoolClientOptions) {
    this.baseUrl = options.baseUrl;
    this.agent = new Agent({ keepAlive: true });
  }

  allocate(criteria: AllocationCriteria): Promise<AllocationHandle> {
    return new Promise<AllocationHandle>((resolve, reject) => {
      const url = new URL('/allocate', this.baseUrl);
      const req = request({
        method: 'POST',
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        agent: this.agent,
        headers: { 'content-type': 'application/json' },
      }, (res) => {
        if (res.statusCode !== 200) {
          let buffer = '';
          res.on('data', (chunk: Buffer) => { buffer += chunk.toString('utf8'); });
          res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${buffer}`)));
          return;
        }
        let buffer = '';
        const onData = (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          const newlineIdx = buffer.indexOf('\n');
          if (newlineIdx === -1) {
            return;
          }
          const handle = JSON.parse(buffer.slice(0, newlineIdx)) as AllocationHandle;
          res.off('data', onData);
          this.openAllocateRequests.set(handle.allocationId, req);
          // If the server closes the stream (e.g. on shutdown), release the map entry.
          res.on('close', () => this.openAllocateRequests.delete(handle.allocationId));
          resolve(handle);
        };
        res.on('data', onData);
        res.on('error', reject);
      });
      req.on('error', reject);
      req.write(JSON.stringify({ criteria }));
      req.end();
    });
  }

  async release(allocationId: string): Promise<void> {
    const openReq = this.openAllocateRequests.get(allocationId);
    if (openReq) {
      this.openAllocateRequests.delete(allocationId);
      openReq.destroy();
    }
    await this.postJson('/release', { allocationId });
  }

  async isAppInstalled(allocationId: string, bundleId: string): Promise<boolean> {
    const body = await this.postJson<{ installed: boolean }>('/installed/is-installed', { allocationId, bundleId });
    return body.installed;
  }

  async recordAppInstalled(allocationId: string, bundleId: string): Promise<void> {
    await this.postJson('/installed/record', { allocationId, bundleId });
  }

  private postJson<T = unknown>(path: string, body: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const req = request({
        method: 'POST',
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        agent: this.agent,
        headers: { 'content-type': 'application/json' },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${text}`));
            return;
          }
          resolve(text.length === 0 ? ({} as T) : JSON.parse(text) as T);
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.write(JSON.stringify(body));
      req.end();
    });
  }
}
