import { spawn, type ChildProcess } from 'node:child_process';
import WebSocket from 'ws';
import { sleep } from '@mobilewright/core';
import { DEFAULT_URL, resolveMobilecliBinary } from '@mobilewright/driver-mobilecli';
import { MobilewrightError } from './errors.js';

const HEALTH_CHECK_TIMEOUT = 5_000;
const SERVER_START_TIMEOUT = 10_000;
const SERVER_POLL_INTERVAL = 500;

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

  const proc = spawn(binary, ['server', 'start', '--listen', `localhost:${port}`], {
    stdio: 'pipe',
    detached: false,
  });

  const wsUrl = `ws://localhost:${port}/ws`;
  const deadline = Date.now() + SERVER_START_TIMEOUT;

  while (Date.now() < deadline) {
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

  proc.kill('SIGTERM');
  throw new MobilewrightError(
    `mobilecli server did not become ready within ${SERVER_START_TIMEOUT / 1000}s.\n` +
      `Try starting it manually with: ${binary} server start`,
  );
}

// ─── Health check ──────────────────────────────────────────────

export async function ensureMobilecliReachable(
  url: string = DEFAULT_URL,
  opts?: { autoStart?: boolean },
): Promise<{ serverProcess?: ServerHandle }> {
  if (await checkWebSocket(url, HEALTH_CHECK_TIMEOUT)) return {};

  if (!isLocalUrl(url)) {
    throw new MobilewrightError(
      `Cannot reach mobilecli server at ${url}.\n\n` +
        `Ensure the remote server is running and accessible.`,
    );
  }

  let binaryPath: string | null;
  try { binaryPath = resolveMobilecliBinary(); } catch { binaryPath = null; }

  if (opts?.autoStart && binaryPath) {
    let port = 12000;
    try { port = Number(new URL(url).port) || 12000; } catch { /* default */ }
    const handle = await startMobilecliServer({ binaryPath, port });
    return { serverProcess: handle };
  }

  const hint = binaryPath
    ? `Start it with:\n  mobilecli server start`
    : `Install mobilecli from:\n  https://github.com/mobile-next/mobilecli\n\n` +
      `Then start the server with:\n  mobilecli server start`;

  throw new MobilewrightError(
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
