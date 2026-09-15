import { test, expect } from '@playwright/test';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
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
