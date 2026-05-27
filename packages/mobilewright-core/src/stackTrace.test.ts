import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { filterStack, captureLocation } from './stackTrace.js';

const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const aFrameworkFilePath = path.join(FRAMEWORK_ROOT, 'mobilewright-core', 'src', 'locator.ts');
const aUserFilePath = '/home/user/my-test.ts';

test('filterStack returns undefined when given no stack', () => {
  expect(filterStack(undefined)).toBeUndefined();
});

test('filterStack returns the original stack unchanged when MWDEBUGIMPL is set', () => {
  const stack = `Error\n    at fn (${aUserFilePath}:1:1)\n    at framework (${aFrameworkFilePath}:5:3)`;
  process.env.MWDEBUGIMPL = '1';
  try {
    expect(filterStack(stack)).toBe(stack);
  } finally {
    delete process.env.MWDEBUGIMPL;
  }
});

test('filterStack removes framework frames and keeps user frames', () => {
  const userFrame = `    at myTest (${aUserFilePath}:10:5)`;
  const frameworkFrame = `    at Locator.find (${aFrameworkFilePath}:50:3)`;
  const stack = `Error: something\n${userFrame}\n${frameworkFrame}`;

  const result = filterStack(stack);

  expect(result).toContain(userFrame);
  expect(result).not.toContain(frameworkFrame);
});

test('filterStack keeps the error message line even when all frames are framework frames', () => {
  const frameworkFrame = `    at fn (${aFrameworkFilePath}:1:1)`;
  const stack = `Error: the message\n${frameworkFrame}`;

  const result = filterStack(stack);

  expect(result).toContain('Error: the message');
  expect(result).not.toContain(frameworkFrame);
});

test('captureLocation returns a location with a file path, line number, and column number', () => {
  const location = captureLocation();

  expect(location).toBeDefined();
  expect(location!.file).toBeTruthy();
  expect(location!.line).toBeGreaterThan(0);
  expect(location!.column).toBeGreaterThan(0);
});
