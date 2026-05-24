import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import createDebug from 'debug';

const _require = createRequire(import.meta.url);
const debug = createDebug('mw:reporter:upload');

const BASE_URL = 'https://api.mobilenext.ai';
const DASHBOARD_BASE_URL = 'https://app.mobilenext.ai';

export interface UploadTestResultParams {
  apiKey: string;
  jsonResultsPath: string;
  outputDir: string;
  name?: string;
  tags?: string[];
  environment?: string;
  _fetchFn?: typeof fetch;
}

interface TestResultResponse {
  id: string;
  name: string;
  userAgent: string;
  createdAt: string;
}

export async function uploadTestResult(params: UploadTestResultParams): Promise<{ url: string }> {
  const fetchFn = params._fetchFn ?? fetch;
  const pkg = _require('../package.json') as { version: string };
  const userAgent = `mobilewright/${pkg.version}`;

  debug('creating test result name=%s userAgent=%s', params.name ?? 'Test Run', userAgent);
  const createRes = await fetchFn(`${BASE_URL}/api/v1/test-results`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: params.name ?? 'Test Run',
      userAgent,
    }),
  });

  if (!createRes.ok) {
    throw new Error(`Failed to create test result: ${createRes.status}`);
  }

  const testResult = await createRes.json() as TestResultResponse;
  debug('test result created id=%s', testResult.id);

  debug('uploading report.json path=%s', params.jsonResultsPath);
  const jsonContent = readFileSync(params.jsonResultsPath);
  const form = new FormData();
  form.append('name', 'report.json');
  form.append('file', new Blob([jsonContent], { type: 'application/json' }), 'report.json');

  const uploadRes = await fetchFn(`${BASE_URL}/api/v1/test-results/${testResult.id}/assets`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${params.apiKey}`,
    },
    body: form,
  });

  if (!uploadRes.ok) {
    throw new Error(`Failed to upload results.json: ${uploadRes.status}`);
  }

  debug('upload complete url=%s', `${DASHBOARD_BASE_URL}/dashboard/test-results/${testResult.id}`);
  return { url: `${DASHBOARD_BASE_URL}/dashboard/test-results/${testResult.id}` };
}
