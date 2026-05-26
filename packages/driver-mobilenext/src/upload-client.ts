import { randomUUID } from 'node:crypto';
import createDebug from 'debug';
import type { GitInfo } from './git-info.js';

const debug = createDebug('mw:reporter:upload');

const BASE_URL = 'https://api.mobilenext.ai';
const DASHBOARD_BASE_URL = 'https://app.mobilenext.ai';

export interface UploadTestResultParams {
  apiKey: string;
  report: Record<string, unknown>;
  userAgent: string;
  gitInfo?: GitInfo;
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

interface AssetResponse {
  id: string;
  name: string;
  contentType: string;
  size: number;
  createdAt: string;
}

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function extensionForContentType(contentType: string): string {
  return CONTENT_TYPE_EXTENSIONS[contentType] ?? 'bin';
}

function makeAttachmentUploader(testResultId: string, apiKey: string, fetchFn: typeof fetch) {
  async function uploadAndReplace(obj: unknown): Promise<void> {
    if (!obj || typeof obj !== 'object') { return; }
    if (Array.isArray(obj)) {
      for (const item of obj) {
        await uploadAndReplace(item);
      }
      return;
    }
    const record = obj as Record<string, unknown>;
    if (Array.isArray(record['attachments'])) {
      for (const att of record['attachments'] as Record<string, unknown>[]) {
        if (typeof att['body'] === 'string') {
          const contentType = typeof att['contentType'] === 'string' ? att['contentType'] : 'application/octet-stream';
          const ext = extensionForContentType(contentType);
          const assetName = `${randomUUID()}.${ext}`;
          const buffer = Buffer.from(att['body'], 'base64');
          const sizeKB = (buffer.length / 1024).toFixed(1);
          debug('uploading attachment name=%s contentType=%s size=%skB as %s', att['name'], contentType, sizeKB, assetName);

          const form = new FormData();
          form.append('name', assetName);
          form.append('file', new Blob([buffer], { type: contentType }), assetName);

          const res = await fetchFn(`${BASE_URL}/api/v1/test-results/${testResultId}/assets`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: form,
          });

          if (!res.ok) {
            throw new Error(`Failed to upload attachment "${att['name'] as string}": ${res.status}`);
          }

          const asset = await res.json() as AssetResponse;
          delete att['body'];
          att['assetId'] = asset.id;
          debug('attachment uploaded assetId=%s', asset.id);
        }
      }
    }
    for (const value of Object.values(record)) {
      await uploadAndReplace(value);
    }
  }
  return uploadAndReplace;
}

export async function uploadTestResult(params: UploadTestResultParams): Promise<{ url: string }> {
  const fetchFn = params._fetchFn ?? fetch;
  const hasGitInfo = params.gitInfo !== undefined && Object.values(params.gitInfo).some(v => v !== undefined);

  debug('creating test result name=%s userAgent=%s', params.name ?? 'Test Run', params.userAgent);
  const createRes = await fetchFn(`${BASE_URL}/api/v1/test-results`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: params.name ?? 'Test Run',
      userAgent: params.userAgent,
      ...(hasGitInfo ? { git: params.gitInfo } : {}),
    }),
  });

  if (!createRes.ok) {
    throw new Error(`Failed to create test result: ${createRes.status}`);
  }

  const testResult = await createRes.json() as TestResultResponse;
  debug('test result created id=%s', testResult.id);

  // Deep-clone so attachment body replacement does not mutate the caller's object
  const report = JSON.parse(JSON.stringify(params.report)) as Record<string, unknown>;
  const uploadAndReplace = makeAttachmentUploader(testResult.id, params.apiKey, fetchFn);
  await uploadAndReplace(report);

  const modifiedJson = JSON.stringify(report);
  const modifiedBuffer = Buffer.from(modifiedJson);
  const fileSizeKB = (modifiedBuffer.length / 1024).toFixed(1);
  debug('uploading report.json size=%skB', fileSizeKB);

  const form = new FormData();
  form.append('name', 'report.json');
  form.append('file', new Blob([modifiedBuffer], { type: 'application/json' }), 'report.json');

  const progressTimer = setInterval(() => {
    debug('still uploading report.json...');
  }, 10_000);

  const uploadRes = await fetchFn(`${BASE_URL}/api/v1/test-results/${testResult.id}/assets`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${params.apiKey}` },
    body: form,
  }).finally(() => clearInterval(progressTimer));

  if (!uploadRes.ok) {
    throw new Error(`Failed to upload report.json: ${uploadRes.status}`);
  }

  debug('upload complete url=%s', `${DASHBOARD_BASE_URL}/dashboard/test-results/${testResult.id}`);
  return { url: `${DASHBOARD_BASE_URL}/dashboard/test-results/${testResult.id}` };
}
