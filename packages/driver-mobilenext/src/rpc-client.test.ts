import { test, expect } from '@playwright/test';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import { createServer, type Socket } from 'node:net';
import { RpcClient } from './rpc-client.js';

// A server that completes the handshake and then stops reading, like a peer behind a dead network:
// the client's close frame is never answered, so no clean close handshake can ever finish.
async function startServerThatNeverAnswersClose(): Promise<{ url: string; stop: () => void }> {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  server.on('connection', (socket: ServerSocket) => {
    (socket as unknown as { _socket: { pause: () => void } })._socket.pause();
  });
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const { port } = server.address() as { port: number };
  return { url: `ws://127.0.0.1:${port}`, stop: () => server.close() };
}

test('disconnect returns within the grace period even when the peer never answers the close frame', async () => {
  const server = await startServerThatNeverAnswersClose();
  const client = new RpcClient(server.url, 1_000, 200);
  try {
    await client.connect();
    const started = Date.now();
    await client.disconnect();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(client.isConnected).toBe(false);
  } finally {
    server.stop();
  }
});

// The Mobile Next api key travels as a `token` query param on the websocket
// URL. Connection failures end up in CI logs and test reports, so the key must
// never appear in an error message.

// A bare TCP server that accepts connections and never answers the WebSocket
// upgrade request, so a client connect can only end by timing out.
async function startServerThatNeverCompletesTheHandshake(): Promise<{ port: number; stop: () => void }> {
  const sockets: Socket[] = [];
  const server = createServer((socket) => { sockets.push(socket); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { port, stop: () => { for (const s of sockets) s.destroy(); server.close(); } };
}

test.describe('connection errors do not reveal the api key', () => {
  const SECRET = 'mnxt_SUPER_SECRET_KEY_123';
  const unreachableUrlWithToken = `ws://127.0.0.1:1/ws?token=${SECRET}`;

  async function connectionError(client: RpcClient): Promise<Error> {
    try {
      await client.connect();
    } catch (e) {
      return e as Error;
    }
    throw new Error('connect() unexpectedly succeeded');
  }

  test('a refused connection reports a redacted url', async () => {
    const error = await connectionError(new RpcClient(unreachableUrlWithToken, 1_000));
    expect(error.message).toContain('Failed to connect to ws://127.0.0.1:1/ws?token=***');
    expect(error.message).not.toContain(SECRET);
  });

  test('a connection timeout reports a redacted url', async () => {
    const server = await startServerThatNeverCompletesTheHandshake();
    // The TCP connection opens but no HTTP upgrade response ever arrives, so
    // the client can only give up via its own timeout.
    const client = new RpcClient(`ws://127.0.0.1:${server.port}/ws?token=${SECRET}`, 200);
    try {
      const error = await connectionError(client);
      expect(error.message).toContain('timed out');
      expect(error.message).not.toContain(SECRET);
      expect(error.message).toContain('token=***');
    } finally {
      server.stop();
    }
  });
});
