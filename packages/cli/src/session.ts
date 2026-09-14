import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error(`invalid session name "${name}", use letters, digits, dot, dash or underscore`);
  }
  const path = join(sessionDir(), `${name}.json`);
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error(`refusing to use ${path}: it is a symlink`);
  }
  return path;
}

export function loadSession(name: string): SessionState {
  const path = sessionPath(name);
  if (!existsSync(path)) {
    return { refs: {} };
  }
  return JSON.parse(readFileSync(path, 'utf8')) as SessionState;
}

export function saveSession(name: string, state: SessionState): void {
  mkdirSync(sessionDir(), { recursive: true, mode: 0o700 });
  writeFileSync(sessionPath(name), JSON.stringify(state, null, 2));
}
