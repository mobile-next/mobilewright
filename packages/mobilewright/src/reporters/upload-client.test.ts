import { test, expect } from '@playwright/test';
import { writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { uploadTestResult } from './upload-client.js';

test('copies json results to a new tmp dir and returns a file:// url', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'mw-client-test-'));
  const jsonPath = join(workDir, 'results.json');
  writeFileSync(jsonPath, '{"tests":[]}');

  const result = await uploadTestResult({
    apiKey: 'test-key',
    jsonResultsPath: jsonPath,
    outputDir: join(workDir, 'nonexistent-dir'),
  });

  expect(result.url).toMatch(/^file:\/\//);
  const uploadDir = result.url.replace('file://', '');
  expect(existsSync(join(uploadDir, 'results.json'))).toBe(true);

  rmSync(workDir, { recursive: true });
  rmSync(uploadDir, { recursive: true });
});

test('copies outputDir artifacts into an artifacts/ subdirectory when outputDir exists', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'mw-client-test-'));
  const jsonPath = join(workDir, 'results.json');
  writeFileSync(jsonPath, '{}');
  const outputDir = join(workDir, 'test-results');
  mkdirSync(outputDir);
  writeFileSync(join(outputDir, 'screenshot.png'), 'fake-png');

  const result = await uploadTestResult({
    apiKey: 'test-key',
    jsonResultsPath: jsonPath,
    outputDir,
  });

  const uploadDir = result.url.replace('file://', '');
  expect(existsSync(join(uploadDir, 'artifacts', 'screenshot.png'))).toBe(true);

  rmSync(workDir, { recursive: true });
  rmSync(uploadDir, { recursive: true });
});

test('skips artifacts copy when outputDir does not exist', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'mw-client-test-'));
  const jsonPath = join(workDir, 'results.json');
  writeFileSync(jsonPath, '{}');

  const result = await uploadTestResult({
    apiKey: 'test-key',
    jsonResultsPath: jsonPath,
    outputDir: join(workDir, 'does-not-exist'),
  });

  const uploadDir = result.url.replace('file://', '');
  expect(existsSync(join(uploadDir, 'artifacts'))).toBe(false);

  rmSync(workDir, { recursive: true });
  rmSync(uploadDir, { recursive: true });
});
