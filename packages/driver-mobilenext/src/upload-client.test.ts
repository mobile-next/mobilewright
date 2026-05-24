import { test, expect } from '@playwright/test';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { uploadTestResult } from './upload-client.js';

type FetchCall = { url: string; method: string; headers: Record<string, string>; body: unknown };

function makeMockFetch(testResultId: string) {
  const calls: FetchCall[] = [];

  const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = String(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: urlStr, method: init?.method ?? 'GET', headers, body: init?.body });

    if (urlStr.endsWith('/test-results')) {
      return new Response(
        JSON.stringify({ id: testResultId, name: 'Test Run', userAgent: 'mobilewright/0.0.1', createdAt: '2026-01-01T00:00:00Z' }),
        { status: 201 },
      );
    }
    return new Response(
      JSON.stringify({ id: 'asset-1', name: 'report.json', contentType: 'application/json', size: 12, createdAt: '2026-01-01T00:00:00Z' }),
      { status: 201 },
    );
  };

  return { mockFetch: mockFetch as unknown as typeof fetch, calls };
}

test('sends POST to test-results endpoint with apiKey, name, and userAgent', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'mw-upload-test-'));
  const jsonPath = join(workDir, 'results.json');
  writeFileSync(jsonPath, '{"tests":[]}');
  const { mockFetch, calls } = makeMockFetch('result-abc');

  await uploadTestResult({
    apiKey: 'mob_test_key',
    jsonResultsPath: jsonPath,
    outputDir: join(workDir, 'artifacts'),
    _fetchFn: mockFetch,
  });

  const createCall = calls.find(c => c.url === 'https://api.mobilenext.ai/api/v1/test-results');
  expect(createCall?.method).toBe('POST');
  const body = JSON.parse(createCall?.body as string);
  expect(body.name).toBe('Test Run');
  expect(body.userAgent).toMatch(/^mobilewright\//);
  expect(createCall?.headers['Authorization']).toBe('Bearer mob_test_key');
  expect(createCall?.headers['Content-Type']).toBe('application/json');

  rmSync(workDir, { recursive: true });
});

test('uses provided name in the create test result request', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'mw-upload-test-'));
  const jsonPath = join(workDir, 'results.json');
  writeFileSync(jsonPath, '{}');
  const { mockFetch, calls } = makeMockFetch('result-abc');

  await uploadTestResult({
    apiKey: 'mob_key',
    jsonResultsPath: jsonPath,
    outputDir: join(workDir, 'artifacts'),
    name: 'Nightly Suite',
    _fetchFn: mockFetch,
  });

  const createCall = calls.find(c => c.url === 'https://api.mobilenext.ai/api/v1/test-results');
  const body = JSON.parse(createCall?.body as string);
  expect(body.name).toBe('Nightly Suite');

  rmSync(workDir, { recursive: true });
});

test('uploads report.json as multipart FormData to the asset endpoint', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'mw-upload-test-'));
  const jsonPath = join(workDir, 'results.json');
  writeFileSync(jsonPath, '{"tests":[]}');
  const { mockFetch, calls } = makeMockFetch('result-abc');

  await uploadTestResult({
    apiKey: 'mob_test_key',
    jsonResultsPath: jsonPath,
    outputDir: join(workDir, 'artifacts'),
    _fetchFn: mockFetch,
  });

  const assetCall = calls.find(c => c.url.includes('/assets'));
  expect(assetCall?.url).toBe('https://api.mobilenext.ai/api/v1/test-results/result-abc/assets');
  expect(assetCall?.method).toBe('POST');
  expect(assetCall?.body).toBeInstanceOf(FormData);
  expect(assetCall?.headers['Authorization']).toBe('Bearer mob_test_key');

  rmSync(workDir, { recursive: true });
});

test('returns the dashboard URL for the created test result', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'mw-upload-test-'));
  const jsonPath = join(workDir, 'results.json');
  writeFileSync(jsonPath, '{}');
  const { mockFetch } = makeMockFetch('my-test-id-123');

  const result = await uploadTestResult({
    apiKey: 'mob_key',
    jsonResultsPath: jsonPath,
    outputDir: join(workDir, 'artifacts'),
    _fetchFn: mockFetch,
  });

  expect(result.url).toBe('https://app.mobilenext.ai/dashboard/test-results/my-test-id-123');

  rmSync(workDir, { recursive: true });
});

test('throws when create test result API returns a non-2xx status', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'mw-upload-test-'));
  const jsonPath = join(workDir, 'results.json');
  writeFileSync(jsonPath, '{}');

  const failingFetch = async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> =>
    new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  await expect(
    uploadTestResult({
      apiKey: 'bad-key',
      jsonResultsPath: jsonPath,
      outputDir: join(workDir, 'artifacts'),
      _fetchFn: failingFetch as unknown as typeof fetch,
    }),
  ).rejects.toThrow('401');

  rmSync(workDir, { recursive: true });
});

test('throws when asset upload API returns a non-2xx status', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'mw-upload-test-'));
  const jsonPath = join(workDir, 'results.json');
  writeFileSync(jsonPath, '{}');

  const mockFetch = async (url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    if (String(url).endsWith('/test-results')) {
      return new Response(
        JSON.stringify({ id: 'result-abc', name: 'Test Run', userAgent: 'mobilewright/0.0.1', createdAt: '2026-01-01T00:00:00Z' }),
        { status: 201 },
      );
    }
    return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
  };

  await expect(
    uploadTestResult({
      apiKey: 'mob_key',
      jsonResultsPath: jsonPath,
      outputDir: join(workDir, 'artifacts'),
      _fetchFn: mockFetch as unknown as typeof fetch,
    }),
  ).rejects.toThrow('500');

  rmSync(workDir, { recursive: true });
});
