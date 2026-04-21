import WebSocket from 'ws';

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

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
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.connectionPromise) return this.connectionPromise;

    this.connectionPromise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      const timeout = setTimeout(() => {
        ws.terminate();
        reject(new Error(`Connection to ${this.url} timed out`));
      }, this.requestTimeout);

      ws.on('open', () => {
        clearTimeout(timeout);
        this.ws = ws;
        this.connectionPromise = null;
        resolve();
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        this.connectionPromise = null;
        reject(err);
      });

      ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      ws.on('close', () => {
        this.ws = null;
        // Reject all pending requests
        for (const [id, req] of this.pending) {
          clearTimeout(req.timer);
          req.reject(new Error('WebSocket connection closed'));
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
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
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

      ws.send(JSON.stringify(request));
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
      return; // Ignore malformed messages
    }

    const pending = this.pending.get(response.id);
    if (!pending) return;

    this.pending.delete(response.id);
    clearTimeout(pending.timer);

    if (response.error) {
      // Surface the detail from mobilecli — response.error.data often
      // contains the real error (e.g. "exit status 4") while
      // response.error.message is just "Server error".
      const detail =
        typeof response.error.data === 'string'
          ? response.error.data
          : response.error.message;
      pending.reject(new RpcError(detail, response.error.code, response.error.data));
    } else {
      pending.resolve(response.result);
    }
  }
}
