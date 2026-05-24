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

test('uploads inline attachment bodies as separate assets before report.json', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'mw-upload-test-'));
  const jsonPath = join(workDir, 'results.json');
  const pngBase64 = Buffer.from('fake-png-data').toString('base64');
  const report = {
    suites: [{ specs: [{ tests: [{ results: [{ attachments: [
      { name: 'screenshot', contentType: 'image/png', body: pngBase64 },
    ] }] }] }] }],
  };
  writeFileSync(jsonPath, JSON.stringify(report));

  let assetCallCount = 0;
  const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = String(url);
    if (urlStr.endsWith('/test-results')) {
      return new Response(
        JSON.stringify({ id: 'result-abc', name: 'Test Run', userAgent: 'mobilewright/0.0.1', createdAt: '2026-01-01T00:00:00Z' }),
        { status: 201 },
      );
    }
    assetCallCount++;
    return new Response(
      JSON.stringify({ id: `asset-${assetCallCount}`, name: 'x', contentType: 'image/png', size: 10, createdAt: '2026-01-01T00:00:00Z' }),
      { status: 201 },
    );
  };

  await uploadTestResult({
    apiKey: 'mob_key',
    jsonResultsPath: jsonPath,
    outputDir: join(workDir, 'artifacts'),
    _fetchFn: mockFetch as unknown as typeof fetch,
  });

  // 2 asset calls: one for the PNG attachment, one for report.json
  expect(assetCallCount).toBe(2);

  rmSync(workDir, { recursive: true });
});

test('removes body and sets assetId in the uploaded report.json', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'mw-upload-test-'));
  const jsonPath = join(workDir, 'results.json');
  const pngBase64 = Buffer.from('fake-png-data').toString('base64');
  const report = {
    suites: [{ specs: [{ tests: [{ results: [{ attachments: [
      { name: 'screenshot', contentType: 'image/png', body: pngBase64 },
    ] }] }] }] }],
  };
  writeFileSync(jsonPath, JSON.stringify(report));

  let assetCallCount = 0;
  let capturedReportForm: FormData | undefined;
  const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = String(url);
    if (urlStr.endsWith('/test-results')) {
      return new Response(
        JSON.stringify({ id: 'result-abc', name: 'Test Run', userAgent: 'mobilewright/0.0.1', createdAt: '2026-01-01T00:00:00Z' }),
        { status: 201 },
      );
    }
    assetCallCount++;
    if (assetCallCount === 2) {
      capturedReportForm = init?.body as FormData;
    }
    return new Response(
      JSON.stringify({ id: `asset-${assetCallCount}`, name: 'x', contentType: 'image/png', size: 10, createdAt: '2026-01-01T00:00:00Z' }),
      { status: 201 },
    );
  };

  await uploadTestResult({
    apiKey: 'mob_key',
    jsonResultsPath: jsonPath,
    outputDir: join(workDir, 'artifacts'),
    _fetchFn: mockFetch as unknown as typeof fetch,
  });

  const reportFile = capturedReportForm?.get('file') as File;
  const parsedReport = JSON.parse(await reportFile.text()) as typeof report;
  const att = parsedReport.suites[0].specs[0].tests[0].results[0].attachments[0] as Record<string, unknown>;
  expect(att['body']).toBeUndefined();
  expect(att['assetId']).toBe('asset-1');

  rmSync(workDir, { recursive: true });
});

test('does not modify the original json file on disk', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'mw-upload-test-'));
  const jsonPath = join(workDir, 'results.json');
  const pngBase64 = Buffer.from('fake-png-data').toString('base64');
  const report = {
    suites: [{ specs: [{ tests: [{ results: [{ attachments: [
      { name: 'screenshot', contentType: 'image/png', body: pngBase64 },
    ] }] }] }] }],
  };
  const originalJson = JSON.stringify(report);
  writeFileSync(jsonPath, originalJson);
  const { mockFetch } = makeMockFetch('result-abc');

  await uploadTestResult({
    apiKey: 'mob_key',
    jsonResultsPath: jsonPath,
    outputDir: join(workDir, 'artifacts'),
    _fetchFn: mockFetch,
  });

  const { readFileSync: read } = await import('node:fs');
  expect(read(jsonPath, 'utf8')).toBe(originalJson);

  rmSync(workDir, { recursive: true });
});

test('leaves path-based attachments unchanged', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'mw-upload-test-'));
  const jsonPath = join(workDir, 'results.json');
  const report = {
    suites: [{ specs: [{ tests: [{ results: [{ attachments: [
      { name: 'video', contentType: 'video/mp4', path: '/some/path/video.mp4' },
    ] }] }] }] }],
  };
  writeFileSync(jsonPath, JSON.stringify(report));

  let assetCallCount = 0;
  const mockFetch = async (url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    if (String(url).endsWith('/test-results')) {
      return new Response(
        JSON.stringify({ id: 'result-abc', name: 'Test Run', userAgent: 'mobilewright/0.0.1', createdAt: '2026-01-01T00:00:00Z' }),
        { status: 201 },
      );
    }
    assetCallCount++;
    return new Response(
      JSON.stringify({ id: 'asset-1', name: 'report.json', contentType: 'application/json', size: 10, createdAt: '2026-01-01T00:00:00Z' }),
      { status: 201 },
    );
  };

  await uploadTestResult({
    apiKey: 'mob_key',
    jsonResultsPath: jsonPath,
    outputDir: join(workDir, 'artifacts'),
    _fetchFn: mockFetch as unknown as typeof fetch,
  });

  // Only 1 asset call: just report.json (no upload for path-based attachments)
  expect(assetCallCount).toBe(1);

  rmSync(workDir, { recursive: true });
});
