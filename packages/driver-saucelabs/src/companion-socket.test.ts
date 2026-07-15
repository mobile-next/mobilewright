import { test, expect } from '@playwright/test';
import { CompanionSocket } from './companion-socket.js';

// Exercise the private message parser without opening a real WebSocket.
function sendMessage(socket: CompanionSocket, msg: unknown): void {
  (socket as any).handleMessage(JSON.stringify(msg));
}

function createSocket() {
  return new CompanionSocket('wss://fake', 'user', 'key');
}

// ─── Orientation finish ───────────────────────────────────────────────────────

test('calls handler with LANDSCAPE on device.orientation.finish LANDSCAPE', () => {
  const socket = createSocket();
  let received: string | undefined;
  socket.onOrientationFinish((o) => { received = o; });

  sendMessage(socket, { type: 'device.orientation.finish', value: { orientation: 'LANDSCAPE' } });

  expect(received).toBe('LANDSCAPE');
});

test('calls handler with PORTRAIT on device.orientation.finish PORTRAIT', () => {
  const socket = createSocket();
  let received: string | undefined;
  socket.onOrientationFinish((o) => { received = o; });

  sendMessage(socket, { type: 'device.orientation.finish', value: { orientation: 'PORTRAIT' } });

  expect(received).toBe('PORTRAIT');
});

test('normalises lowercase orientation value to uppercase', () => {
  const socket = createSocket();
  let received: string | undefined;
  socket.onOrientationFinish((o) => { received = o; });

  sendMessage(socket, { type: 'device.orientation.finish', value: { orientation: 'landscape' } });

  expect(received).toBe('LANDSCAPE');
});

test('calls the latest registered handler, not a previous one', () => {
  const socket = createSocket();
  const results: string[] = [];

  socket.onOrientationFinish(() => results.push('first'));
  socket.onOrientationFinish((o) => results.push(`second:${o}`));

  sendMessage(socket, { type: 'device.orientation.finish', value: { orientation: 'LANDSCAPE' } });

  expect(results).toEqual(['second:LANDSCAPE']);
});

// ─── Ignored events ───────────────────────────────────────────────────────────

test('does not call handler for device.orientation.start events', () => {
  const socket = createSocket();
  let called = false;
  socket.onOrientationFinish(() => { called = true; });

  sendMessage(socket, { type: 'device.orientation.start', value: { orientation: 'LANDSCAPE' } });

  expect(called).toBe(false);
});

test('does not call handler for unrelated event types', () => {
  const socket = createSocket();
  let called = false;
  socket.onOrientationFinish(() => { called = true; });

  sendMessage(socket, { type: 'device.log.message', value: { message: 'hello' } });

  expect(called).toBe(false);
});

// ─── Robustness ───────────────────────────────────────────────────────────────

test('silently ignores malformed JSON', () => {
  const socket = createSocket();
  expect(() => {
    (socket as any).handleMessage('not valid json {{{');
  }).not.toThrow();
});

test('silently ignores orientation.finish with missing value', () => {
  const socket = createSocket();
  let called = false;
  socket.onOrientationFinish(() => { called = true; });

  sendMessage(socket, { type: 'device.orientation.finish' }); // no value field

  expect(called).toBe(false);
});
