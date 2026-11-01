import { test, expect } from '@playwright/test';
import { buildConfigOverrides, type TestCommandOptions } from './test-options.js';

function overridesFor(opts: TestCommandOptions): Record<string, unknown> {
  return buildConfigOverrides(opts);
}

function errorFor(opts: TestCommandOptions): string {
  try {
    buildConfigOverrides(opts);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected buildConfigOverrides to throw');
}

test.describe('buildConfigOverrides', () => {
  test('returns no overrides when no flags are given', () => {
    expect(overridesFor({})).toEqual({});
  });

  test('--repeat-each sets repeatEach', () => {
    expect(overridesFor({ repeatEach: '20' })).toEqual({ repeatEach: 20 });
  });

  test('--repeat-each rejects zero, negatives and non-integers', () => {
    expect(errorFor({ repeatEach: '0' })).toBe('--repeat-each must be a positive integer, got: 0');
    expect(errorFor({ repeatEach: '-1' })).toBe('--repeat-each must be a positive integer, got: -1');
    expect(errorFor({ repeatEach: 'abc' })).toBe('--repeat-each must be a positive integer, got: abc');
  });

  test('--max-failures sets maxFailures', () => {
    expect(overridesFor({ maxFailures: '3' })).toEqual({ maxFailures: 3 });
  });

  test('--max-failures 0 means no limit, like playwright', () => {
    expect(overridesFor({ maxFailures: '0' })).toEqual({ maxFailures: 0 });
  });

  test('--max-failures rejects negatives and non-integers', () => {
    expect(errorFor({ maxFailures: '-2' })).toBe('--max-failures must be a non-negative integer, got: -2');
    expect(errorFor({ maxFailures: '1.5' })).toBe('--max-failures must be a non-negative integer, got: 1.5');
  });

  test('-x stops after the first failure', () => {
    expect(overridesFor({ x: true })).toEqual({ maxFailures: 1 });
  });

  test('-x wins over --max-failures, like playwright', () => {
    expect(overridesFor({ x: true, maxFailures: '5' })).toEqual({ maxFailures: 1 });
  });

  test('--fail-on-flaky-tests sets failOnFlakyTests', () => {
    expect(overridesFor({ failOnFlakyTests: true })).toEqual({ failOnFlakyTests: true });
  });

  test('--forbid-only sets forbidOnly', () => {
    expect(overridesFor({ forbidOnly: true })).toEqual({ forbidOnly: true });
  });

  test('--workers sets workers and rejects non-positive values', () => {
    expect(overridesFor({ workers: '4' })).toEqual({ workers: 4 });
    expect(errorFor({ workers: '0' })).toBe('--workers must be a positive integer, got: 0');
  });

  test('--shard parses x/n and rejects other formats', () => {
    expect(overridesFor({ shard: '2/3' })).toEqual({ shard: { current: 2, total: 3 } });
    expect(errorFor({ shard: '2-3' })).toBe('--shard must be in the format x/n (e.g. 1/3), got: 2-3');
  });

  test('--reporter html writes to the mobilewright report folder', () => {
    expect(overridesFor({ reporter: 'list, html' })).toEqual({
      reporter: [['list'], ['html', { outputFolder: 'mobilewright-report' }]],
    });
  });
});
