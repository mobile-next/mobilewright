import { test, expect } from '@playwright/test';
import { uploadTestResult, extractGitInfoFromReport } from './upload-client.js';

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
  const { mockFetch, calls } = makeMockFetch('result-abc');

  await uploadTestResult({
    apiKey: 'mob_test_key',
    report: { tests: [] },
    userAgent: 'mobilewright/1.2.3',
    _fetchFn: mockFetch,
  });

  const createCall = calls.find(c => c.url === 'https://api.mobilenext.ai/api/v1/test-results');
  expect(createCall?.method).toBe('POST');
  const body = JSON.parse(createCall?.body as string);
  expect(body.name).toBe('Test Run');
  expect(body.userAgent).toBe('mobilewright/1.2.3');
  expect(createCall?.headers['Authorization']).toBe('Bearer mob_test_key');
  expect(createCall?.headers['Content-Type']).toBe('application/json');
});

test('uses provided name in the create test result request', async () => {
  const { mockFetch, calls } = makeMockFetch('result-abc');

  await uploadTestResult({
    apiKey: 'mob_key',
    report: {},
    userAgent: 'mobilewright/test',
    name: 'Nightly Suite',
    _fetchFn: mockFetch,
  });

  const createCall = calls.find(c => c.url === 'https://api.mobilenext.ai/api/v1/test-results');
  const body = JSON.parse(createCall?.body as string);
  expect(body.name).toBe('Nightly Suite');
});

test('uploads report.json as multipart FormData to the asset endpoint', async () => {
  const { mockFetch, calls } = makeMockFetch('result-abc');

  await uploadTestResult({
    apiKey: 'mob_test_key',
    report: { tests: [] },
    userAgent: 'mobilewright/test',
    _fetchFn: mockFetch,
  });

  const assetCall = calls.find(c => c.url.includes('/assets'));
  expect(assetCall?.url).toBe('https://api.mobilenext.ai/api/v1/test-results/result-abc/assets');
  expect(assetCall?.method).toBe('POST');
  expect(assetCall?.body).toBeInstanceOf(FormData);
  expect(assetCall?.headers['Authorization']).toBe('Bearer mob_test_key');
});

test('returns the dashboard URL for the created test result', async () => {
  const { mockFetch } = makeMockFetch('my-test-id-123');

  const result = await uploadTestResult({
    apiKey: 'mob_key',
    report: {},
    userAgent: 'mobilewright/test',
    _fetchFn: mockFetch,
  });

  expect(result.url).toBe('https://app.mobilenext.ai/dashboard/test-results/my-test-id-123');
});

test('includes git metadata in the create request when gitInfo is provided', async () => {
  const { mockFetch, calls } = makeMockFetch('result-abc');

  await uploadTestResult({
    apiKey: 'mob_key',
    report: {},
    userAgent: 'mobilewright/test',
    gitInfo: { branch: 'main', commitSha: 'abc123', authorName: 'alice' },
    _fetchFn: mockFetch,
  });

  const createCall = calls.find(c => c.url.endsWith('/test-results'));
  const body = JSON.parse(createCall?.body as string);
  expect(body.git.branch).toBe('main');
  expect(body.git.commitSha).toBe('abc123');
  expect(body.git.authorName).toBe('alice');
});

test('omits git field when gitInfo is undefined', async () => {
  const { mockFetch, calls } = makeMockFetch('result-abc');

  await uploadTestResult({
    apiKey: 'mob_key',
    report: {},
    userAgent: 'mobilewright/test',
    _fetchFn: mockFetch,
  });

  const createCall = calls.find(c => c.url.endsWith('/test-results'));
  const body = JSON.parse(createCall?.body as string);
  expect(body.git).toBeUndefined();
});

test('includes tags, environment, and stats in the create request', async () => {
  const { mockFetch, calls } = makeMockFetch('result-abc');
  const stats = { startTime: '2026-01-01T00:00:00Z', duration: 5000, expected: 3, skipped: 1, unexpected: 0, flaky: 0 };

  await uploadTestResult({
    apiKey: 'mob_key',
    report: { stats },
    userAgent: 'mobilewright/test',
    tags: ['ci', 'nightly'],
    environment: 'staging',
    _fetchFn: mockFetch,
  });

  const createCall = calls.find(c => c.url.endsWith('/test-results'));
  const body = JSON.parse(createCall?.body as string);
  expect(body.tags).toEqual(['ci', 'nightly']);
  expect(body.environment).toBe('staging');
  expect(body.stats).toEqual(stats);
});

test('omits tags, environment, and stats when not present', async () => {
  const { mockFetch, calls } = makeMockFetch('result-abc');

  await uploadTestResult({
    apiKey: 'mob_key',
    report: {},
    userAgent: 'mobilewright/test',
    _fetchFn: mockFetch,
  });

  const createCall = calls.find(c => c.url.endsWith('/test-results'));
  const body = JSON.parse(createCall?.body as string);
  expect(body.tags).toBeUndefined();
  expect(body.environment).toBeUndefined();
  expect(body.stats).toBeUndefined();
});

test('throws when create test result API returns a non-2xx status', async () => {
  const failingFetch = async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> =>
    new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  await expect(
    uploadTestResult({
      apiKey: 'bad-key',
      report: {},
      userAgent: 'mobilewright/test',
      _fetchFn: failingFetch as unknown as typeof fetch,
    }),
  ).rejects.toThrow('401');
});

test('throws when asset upload API returns a non-2xx status', async () => {
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
      report: {},
      userAgent: 'mobilewright/test',
      _fetchFn: mockFetch as unknown as typeof fetch,
    }),
  ).rejects.toThrow('500');
});

test('uploads inline attachment bodies as separate assets before report.json', async () => {
  const pngBase64 = Buffer.from('fake-png-data').toString('base64');
  const report = {
    suites: [{ specs: [{ tests: [{ results: [{ attachments: [
      { name: 'screenshot', contentType: 'image/png', body: pngBase64 },
    ] }] }] }] }],
  };

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
    report,
    userAgent: 'mobilewright/test',
    _fetchFn: mockFetch as unknown as typeof fetch,
  });

  // 2 asset calls: one for the PNG attachment, one for report.json
  expect(assetCallCount).toBe(2);
});

test('removes body and sets assetId in the uploaded report.json', async () => {
  const pngBase64 = Buffer.from('fake-png-data').toString('base64');
  const report = {
    suites: [{ specs: [{ tests: [{ results: [{ attachments: [
      { name: 'screenshot', contentType: 'image/png', body: pngBase64 },
    ] }] }] }] }],
  };

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
    report,
    userAgent: 'mobilewright/test',
    _fetchFn: mockFetch as unknown as typeof fetch,
  });

  const reportFile = capturedReportForm?.get('file') as File;
  const parsedReport = JSON.parse(await reportFile.text()) as typeof report;
  const att = parsedReport.suites[0].specs[0].tests[0].results[0].attachments[0] as Record<string, unknown>;
  expect(att['body']).toBeUndefined();
  expect(att['assetId']).toBe('asset-1');
});

test('does not modify the caller\'s report object', async () => {
  const pngBase64 = Buffer.from('fake-png-data').toString('base64');
  const report = {
    suites: [{ specs: [{ tests: [{ results: [{ attachments: [
      { name: 'screenshot', contentType: 'image/png', body: pngBase64 },
    ] }] }] }] }],
  };
  const { mockFetch } = makeMockFetch('result-abc');

  await uploadTestResult({
    apiKey: 'mob_key',
    report,
    userAgent: 'mobilewright/test',
    _fetchFn: mockFetch,
  });

  expect(report.suites[0].specs[0].tests[0].results[0].attachments[0].body).toBe(pngBase64);
});

test('leaves path-based attachments unchanged', async () => {
  const report = {
    suites: [{ specs: [{ tests: [{ results: [{ attachments: [
      { name: 'video', contentType: 'video/mp4', path: '/some/path/video.mp4' },
    ] }] }] }] }],
  };

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
    report,
    userAgent: 'mobilewright/test',
    _fetchFn: mockFetch as unknown as typeof fetch,
  });

  // Only 1 asset call: just report.json (no upload for path-based attachments)
  expect(assetCallCount).toBe(1);
});

test('uploadTestResult rejects when timeout is exceeded', async () => {
  const slowFetch: typeof fetch = (_url, init) => {
    const signal = (init as RequestInit | undefined)?.signal as AbortSignal | undefined;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason); return; }
      const timer = setTimeout(() => resolve(new Response('{}', { status: 200 })), 500);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal!.reason); });
    });
  };

  await expect(
    uploadTestResult({
      apiKey: 'key',
      report: {},
      userAgent: 'test/1.0',
      timeout: 50,
      _fetchFn: slowFetch,
    }),
  ).rejects.toThrow();
});

test('extractGitInfoFromReport returns undefined when report has no gitCommit metadata', () => {
  expect(extractGitInfoFromReport({})).toBeUndefined();
  expect(extractGitInfoFromReport({ config: {} })).toBeUndefined();
  expect(extractGitInfoFromReport({ config: { metadata: {} } })).toBeUndefined();
});

test('extractGitInfoFromReport maps Playwright gitCommit fields to GitInfo fields', () => {
  const report = {
    config: {
      metadata: {
        gitCommit: {
          hash: 'abc123def456',
          subject: 'feat: add git support',
          author: { name: 'Alice', email: 'alice@example.com', time: 1700000000 },
          branch: 'main',
        },
      },
    },
  };

  const result = extractGitInfoFromReport(report);

  expect(result?.commitSha).toBe('abc123def456');
  expect(result?.commitMessage).toBe('feat: add git support');
  expect(result?.authorName).toBe('Alice');
  expect(result?.branch).toBe('main');
});

test('extractGitInfoFromReport returns undefined when gitCommit has no recognizable fields', () => {
  const report = { config: { metadata: { gitCommit: {} } } };
  expect(extractGitInfoFromReport(report)).toBeUndefined();
});
