import WebSocket from 'ws';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RpcClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private connectionPromise: Promise<void> | null = null;

  constructor(
    private url: string,
    private requestTimeout = 30_000,
  ) {}

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url);
      const timeout = setTimeout(() => {
        ws.terminate();
        if (!settled) {
          settled = true;
          reject(new Error(`Connection to ${this.url} timed out`));
        }
      }, this.requestTimeout);

      ws.on('open', () => {
        clearTimeout(timeout);
        this.ws = ws;
        this.connectionPromise = null;
        settled = true;
        resolve();
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        this.connectionPromise = null;
        if (!settled) {
          settled = true;
          // Node may wrap connection failures in AggregateError (e.g. IPv4+IPv6).
          // Unwrap to surface the actual error message.
          if (err instanceof AggregateError && err.errors.length > 0) {
            reject(new Error(`Failed to connect to ${this.url}: ${err.errors.map((e: Error) => e.message).join('; ')}`));
          } else {
            reject(new Error(`Failed to connect to ${this.url}: ${err.message}`));
          }
        }
      });

      ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      ws.on('close', (code: number, reason: Buffer) => {
        this.ws = null;
        const reasonStr = reason.toString() || 'no reason';
        const msg = `WebSocket connection closed (code=${code}, reason=${reasonStr})`;
        if (!settled) {
          clearTimeout(timeout);
          this.connectionPromise = null;
          settled = true;
          reject(new Error(msg));
        }
        for (const [id, req] of this.pending) {
          clearTimeout(req.timer);
          req.reject(new Error(msg));
          this.pending.delete(id);
        }
      });
    });

    return this.connectionPromise;
  }

  async call<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    await this.connect();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined && { params }),
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`RPC call "${method}" timed out after ${this.requestTimeout}ms`),
        );
      }, this.requestTimeout);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      this.ws!.send(JSON.stringify(request));
    });
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private handleMessage(data: WebSocket.Data): void {
    let response: JsonRpcResponse;
    try {
      response = JSON.parse(data.toString()) as JsonRpcResponse;
    } catch {
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }

    this.pending.delete(response.id);
    clearTimeout(pending.timer);

    if (response.error) {
      const detail =
        typeof response.error.data === 'string'
          ? response.error.data
          : response.error.message;
      const err = new Error(detail);
      (err as Error & { code: number }).code = response.error.code;
      (err as Error & { data: unknown }).data = response.error.data;
      pending.reject(err);
    } else {
      pending.resolve(response.result);
    }
  }
}
