import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';
import { resolveMobilecliBinary } from './resolve-binary.js';

const HEALTH_CHECK_TIMEOUT = 5_000;
const SERVER_START_TIMEOUT = 10_000;
const SERVER_POLL_INTERVAL = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── URL helpers ───────────────────────────────────────────────

export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return true;
  }
}

// ─── Server auto-start ────────────────────────────────────────

export interface ServerHandle {
  process: ChildProcess;
  kill: () => Promise<void>;
}

export async function startMobilecliServer(opts?: {
  binaryPath?: string;
  port?: number;
}): Promise<ServerHandle> {
  const binary = opts?.binaryPath ?? 'mobilecli';
  const port = opts?.port ?? 12000;
  if (opts?.binaryPath && !existsSync(opts.binaryPath)) {
    throw new Error(`mobilecli binary not found at ${opts.binaryPath}`);
  }

  const verbose = !!process.env['DEBUG'];
  const serverArgs = ['server', 'start', '--listen', `localhost:${port}`];
  if (verbose) {
    serverArgs.push('--verbose');
  }

  const proc = spawn(binary, serverArgs, {
    stdio: 'pipe',
    detached: false,
  });
  // Always drain mobilecli's stdio: an unconsumed pipe buffer fills and then
  // blocks the server's next log write (a single large log line would hang it).
  // Forward to our stderr only when debugging (DEBUG set).
  const drain = (chunk: Buffer): void => {
    if (verbose) {
      process.stderr.write(chunk);
    }
  };
  proc.stdout?.on('data', drain);
  proc.stderr?.on('data', drain);
  // spawn() reports a missing or non-executable binary as an asynchronous
  // 'error' event; without a listener Node raises it as an uncaught exception.
  let spawnFailure: Error | null = null;
  proc.on('error', (err) => {
    spawnFailure = new Error(`Failed to start mobilecli (${binary}): ${err.message}`);
  });

  const wsUrl = `ws://localhost:${port}/ws`;
  const deadline = Date.now() + SERVER_START_TIMEOUT;

  while (Date.now() < deadline) {
    if (spawnFailure) {
      throw spawnFailure;
    }
    if (await checkWebSocket(wsUrl, 1_000)) {
      return {
        process: proc,
        kill: async () => {
          proc.kill('SIGTERM');
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => { proc.kill('SIGKILL'); resolve(); }, 3_000);
            proc.on('exit', () => { clearTimeout(timer); resolve(); });
          });
        },
      };
    }
    await sleep(SERVER_POLL_INTERVAL);
  }

  if (spawnFailure) {
    throw spawnFailure;
  }
  proc.kill('SIGTERM');
  throw new Error(
    `mobilecli server did not become ready within ${SERVER_START_TIMEOUT / 1000}s.\n` +
      `Try starting it manually with: ${binary} server start`,
  );
}

// ─── Health check ──────────────────────────────────────────────

export async function ensureMobilecliReachable(
  url: string,
  opts?: { autoStart?: boolean; binaryPath?: string },
): Promise<{ serverProcess?: ServerHandle }> {
  if (await checkWebSocket(url, HEALTH_CHECK_TIMEOUT)) return {};

  if (!isLocalUrl(url)) {
    throw new Error(
      `Cannot reach mobilecli server at ${url}.\n\n` +
        'Ensure the remote server is running and accessible.',
    );
  }

  // An explicitly configured path that does not exist is a configuration
  // error worth reporting as such; only the "no bundled binary" case falls
  // through to the install hint below.
  let binaryPath: string | null;
  if (opts?.binaryPath) {
    binaryPath = resolveMobilecliBinary(opts.binaryPath);
  } else {
    try { binaryPath = resolveMobilecliBinary(); } catch { binaryPath = null; }
  }

  if (opts?.autoStart && binaryPath) {
    let port = 12000;
    try { port = Number(new URL(url).port) || 12000; } catch { /* default */ }
    const handle = await startMobilecliServer({ binaryPath, port });
    return { serverProcess: handle };
  }

  const hint = binaryPath
    ? 'Start it with:\n  mobilecli server start'
    : 'Install mobilecli from:\n  https://github.com/mobile-next/mobilecli\n\n' +
      'Then start the server with:\n  mobilecli server start';

  throw new Error(
    `mobilecli server is not running at ${url}.\n\n${hint}`,
  );
}

// ─── Helpers ───────────────────────────────────────────────────

function checkWebSocket(url: string, timeout: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { ws.terminate(); resolve(false); }, timeout);
    ws.on('open', () => { clearTimeout(timer); ws.close(); resolve(true); });
    ws.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}
