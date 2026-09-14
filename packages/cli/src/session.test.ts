import { test, expect } from '@playwright/test';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSession, saveSession } from './session.js';

function inTempSessionDir(fn: (dir: string) => void): void {
  const previous = process.env['MOBILEWRIGHT_CLI_DIR'];
  const dir = mkdtempSync(join(tmpdir(), 'mw-cli-'));
  process.env['MOBILEWRIGHT_CLI_DIR'] = dir;
  try {
    fn(dir);
  } finally {
    if (previous === undefined) {
      delete process.env['MOBILEWRIGHT_CLI_DIR'];
    } else {
      process.env['MOBILEWRIGHT_CLI_DIR'] = previous;
    }
  }
}

test('a session round-trips through disk and a missing one starts empty', () => {
  inTempSessionDir(() => {
    expect(loadSession('fresh')).toEqual({ refs: {} });
    saveSession('fresh', { deviceId: 'abc', platform: 'ios', refs: { e1: { bounds: { x: 0, y: 0, width: 1, height: 1 }, locator: 'screen' } } });
    expect(loadSession('fresh').deviceId).toBe('abc');
    expect(loadSession('fresh').refs['e1'].bounds).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});

test('session names cannot escape the session directory', () => {
  inTempSessionDir(() => {
    expect(() => loadSession('../etc')).toThrow('invalid session name');
    expect(() => saveSession('', { refs: {} })).toThrow('invalid session name');
  });
});

test('a session file that is a symlink is refused', () => {
  inTempSessionDir((dir) => {
    const victim = join(dir, 'victim.json');
    writeFileSync(victim, '{}');
    symlinkSync(victim, join(dir, 'linked.json'));
    expect(() => loadSession('linked')).toThrow('symlink');
  });
});
