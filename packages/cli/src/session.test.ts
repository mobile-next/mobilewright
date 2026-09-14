import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSession, saveSession } from './session.js';

test('a session round-trips through disk and a missing one starts empty', () => {
  process.env['MOBILEWRIGHT_CLI_DIR'] = mkdtempSync(join(tmpdir(), 'mw-cli-'));
  expect(loadSession('fresh')).toEqual({ refs: {} });
  saveSession('fresh', { deviceId: 'abc', platform: 'ios', refs: { e1: { bounds: { x: 0, y: 0, width: 1, height: 1 }, locator: 'screen' } } });
  expect(loadSession('fresh').deviceId).toBe('abc');
  expect(loadSession('fresh').refs['e1'].bounds).toEqual({ x: 0, y: 0, width: 1, height: 1 });
});
