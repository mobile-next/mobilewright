import { test, expect } from '@playwright/test';
import { startMobilecliServer, ensureMobilecliReachable } from './server.js';

const MISSING_BINARY = '/nonexistent/path/to/mobilecli';

// A free high port nobody listens on, so the readiness poll cannot succeed by accident.
const UNUSED_PORT = 45_321;

// `spawn()` of a missing binary emits an asynchronous 'error' event. Without a
// listener Node turns it into an uncaught exception that kills the Playwright
// worker (or the inspector) instead of surfacing "mobilecli not found".
test.describe('starting mobilecli with a binary that does not exist', () => {
  test('startMobilecliServer rejects with the binary path instead of crashing', async () => {
    await expect(startMobilecliServer({ binaryPath: MISSING_BINARY, port: UNUSED_PORT }))
      .rejects.toThrow(MISSING_BINARY);
  });

  test('ensureMobilecliReachable reports the configured path when it cannot be started', async () => {
    await expect(ensureMobilecliReachable(`ws://localhost:${UNUSED_PORT}/ws`, { autoStart: true, binaryPath: MISSING_BINARY }))
      .rejects.toThrow(MISSING_BINARY);
  });
});
