import { test, expect } from '@playwright/test';
import { resolveArtifactMode, shouldAttachArtifact } from './fixtures.js';

test.describe('artifact mode helpers', () => {
  test('resolveArtifactMode returns configured mode', () => {
    expect(resolveArtifactMode('on', 'screenshot', 'on-failure')).toBe('on');
    expect(resolveArtifactMode('on-failure', 'viewTree', 'off')).toBe('on-failure');
    expect(resolveArtifactMode('off', 'viewTree', 'on')).toBe('off');
  });

  test('resolveArtifactMode falls back to default', () => {
    expect(resolveArtifactMode(undefined, 'screenshot', 'on-failure')).toBe('on-failure');
    expect(resolveArtifactMode(undefined, 'viewTree', 'off')).toBe('off');
  });

  test('resolveArtifactMode rejects invalid values', () => {
    expect(() => resolveArtifactMode('always', 'screenshot', 'on-failure')).toThrow(
      /Invalid screenshot value/,
    );
    expect(() => resolveArtifactMode(123, 'viewTree', 'off')).toThrow(
      /Invalid viewTree value/,
    );
  });

  test('shouldAttachArtifact uses mode and test outcome', () => {
    expect(shouldAttachArtifact('on', false)).toBe(true);
    expect(shouldAttachArtifact('on', true)).toBe(true);
    expect(shouldAttachArtifact('on-failure', false)).toBe(false);
    expect(shouldAttachArtifact('on-failure', true)).toBe(true);
    expect(shouldAttachArtifact('off', false)).toBe(false);
    expect(shouldAttachArtifact('off', true)).toBe(false);
  });
});
