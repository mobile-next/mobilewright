import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Bounds, Platform, DeviceType } from '@mobilewright/protocol';

export interface SessionState {
  deviceId?: string;
  platform?: Platform;
  deviceType?: DeviceType;
  /** Ref → bounds from the most recent snapshot/find. */
  refs: Record<string, Bounds>;
}

export function sessionDir(): string {
  return join(process.env['MOBILEWRIGHT_CLI_DIR'] ?? join(tmpdir(), 'mobilewright-cli'));
}

function sessionPath(name: string): string {
  return join(sessionDir(), `${name}.json`);
}

export function loadSession(name: string): SessionState {
  const path = sessionPath(name);
  if (!existsSync(path)) {
    return { refs: {} };
  }
  return JSON.parse(readFileSync(path, 'utf8')) as SessionState;
}

export function saveSession(name: string, state: SessionState): void {
  mkdirSync(sessionDir(), { recursive: true });
  writeFileSync(sessionPath(name), JSON.stringify(state, null, 2));
}
