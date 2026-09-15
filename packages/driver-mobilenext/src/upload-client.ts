import { randomUUID } from 'node:crypto';
import createDebug from 'debug';

export interface GitInfo {
  repoUrl?: string;
  branch?: string;
  commitSha?: string;
  authorName?: string;
  commitMessage?: string;
}

export function extractGitInfoFromReport(report: Record<string, unknown>): GitInfo | undefined {
  const config = report['config'] as Record<string, unknown> | undefined;
  return extractGitInfoFromMetadata(config?.['metadata'] as Record<string, unknown> | undefined);
}

/** Reads Playwright's `config.metadata.gitCommit`, available from `onBegin` onwards. */
export function extractGitInfoFromMetadata(metadata: Record<string, unknown> | undefined): GitInfo | undefined {
  const gitCommit = metadata?.['gitCommit'] as Record<string, unknown> | undefined;
  if (!gitCommit) {
    return undefined;
  }

  const author = gitCommit['author'] as Record<string, unknown> | undefined;
  const result: GitInfo = {
    commitSha: gitCommit['hash'] as string | undefined,
    commitMessage: gitCommit['subject'] as string | undefined,
    authorName: author?.['name'] as string | undefined,
    branch: gitCommit['branch'] as string | undefined,
  };

  const hasAnyField = Object.values(result).some(v => v !== undefined);
  return hasAnyField ? result : undefined;
}

const debug = createDebug('mw:reporter:upload');

const FINISH_PATCH_RESERVE_MS = 10_000;
const BASE_URL = 'https://api.mobilenext.ai';
const DASHBOARD_BASE_URL = 'https://app.mobilenext.ai';

export type TestRunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'flaky' | 'errored';

interface ApiCallParams {
  apiKey: string;
  /** Timeout for the entire operation in ms. */
  timeout?: number;
  _fetchFn?: typeof fetch;
}

/** Creates the test result row before the run finishes. Omit `status` for `running`. */
export interface CreateTestResultParams extends ApiCallParams {
  userAgent: string;
  gitInfo?: GitInfo;
  name?: string;
  tags?: string[];
  environment?: string;
  status?: TestRunStatus;
  stats?: PlaywrightStats;
}

/** Uploads the report for an existing test result and flips it to a terminal status. */
export interface FinishTestResultParams extends ApiCallParams {
  testResultId: string;
  report: Record<string, unknown>;
  /** Omit to let the server derive passed/failed/flaky from the report stats. */
  status?: TestRunStatus;
}

export interface UploadTestResultParams {
  apiKey: string;
  report: Record<string, unknown>;
  userAgent: string;
  gitInfo?: GitInfo;
  name?: string;
  tags?: string[];
  environment?: string;
  /** Timeout for the entire upload operation in ms. */
  timeout?: number;
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

interface PlaywrightStats {
  startTime: string;
  duration: number;
  expected: number;
  skipped: number;
  unexpected: number;
  flaky: number;
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

function makeAttachmentUploader(testResultId: string, apiKey: string, fetchFn: typeof fetch, signal?: AbortSignal) {
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
            ...(signal && { signal }),
          });

          if (!res.ok) {
            const body = await res.text().catch(() => '');
            debug('upload attachment failed status=%d body=%s', res.status, body);
            throw new Error(`Failed to upload attachment "${att['name'] as string}": ${res.status}${body ? ` — ${body}` : ''}`);
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

function dashboardUrl(testResultId: string): string {
  return `${DASHBOARD_BASE_URL}/dashboard/test-results/${testResultId}`;
}

async function throwIfNotOk(res: Response, what: string): Promise<void> {
  if (res.ok) {
    return;
  }
  const body = await res.text().catch(() => '');
  debug('%s failed status=%d body=%s', what, res.status, body);
  throw new Error(`Failed to ${what}: ${res.status}${body ? ` — ${body}` : ''}`);
}

export async function createTestResult(params: CreateTestResultParams): Promise<{ id: string; url: string }> {
  const fetchFn = params._fetchFn ?? fetch;
  const signal = params.timeout ? AbortSignal.timeout(params.timeout) : undefined;
  const hasGitInfo = params.gitInfo !== undefined && Object.values(params.gitInfo).some(v => v !== undefined);
  const status = params.status ?? 'running';

  debug('creating test result name=%s userAgent=%s status=%s', params.name ?? 'Test Run', params.userAgent, status);
  const res = await fetchFn(`${BASE_URL}/api/v1/test-results`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: params.name ?? 'Test Run',
      userAgent: params.userAgent,
      status,
      ...(hasGitInfo ? { git: params.gitInfo } : {}),
      ...(params.tags?.length ? { tags: params.tags } : {}),
      ...(params.environment ? { environment: params.environment } : {}),
      ...(params.stats !== undefined ? { stats: params.stats } : {}),
    }),
    ...(signal && { signal }),
  });
  await throwIfNotOk(res, 'create test result');

  const testResult = await res.json() as TestResultResponse;
  debug('test result created id=%s', testResult.id);
  return { id: testResult.id, url: dashboardUrl(testResult.id) };
}

async function uploadReportAssets(testResultId: string, params: FinishTestResultParams, fetchFn: typeof fetch, signal?: AbortSignal): Promise<void> {
  // Deep-clone so attachment body replacement does not mutate the caller's object
  const report = JSON.parse(JSON.stringify(params.report)) as Record<string, unknown>;
  const uploadAndReplace = makeAttachmentUploader(testResultId, params.apiKey, fetchFn, signal);
  await uploadAndReplace(report);

  const modifiedBuffer = Buffer.from(JSON.stringify(report));
  debug('uploading report.json size=%skB', (modifiedBuffer.length / 1024).toFixed(1));

  const form = new FormData();
  form.append('name', 'report.json');
  form.append('file', new Blob([modifiedBuffer], { type: 'application/json' }), 'report.json');

  const progressTimer = setInterval(() => {
    debug('still uploading report.json...');
  }, 10_000);

  const res = await fetchFn(`${BASE_URL}/api/v1/test-results/${testResultId}/assets`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${params.apiKey}` },
    body: form,
    ...(signal && { signal }),
  }).finally(() => clearInterval(progressTimer));
  await throwIfNotOk(res, 'upload report.json');
}

async function patchTestResult(testResultId: string, params: FinishTestResultParams, fetchFn: typeof fetch, signal?: AbortSignal): Promise<void> {
  const stats = params.report['stats'] as PlaywrightStats | undefined;
  debug('finishing test result id=%s status=%s', testResultId, params.status ?? '(derived)');
  const res = await fetchFn(`${BASE_URL}/api/v1/test-results/${testResultId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(stats !== undefined ? { stats } : {}),
    }),
    ...(signal && { signal }),
  });
  await throwIfNotOk(res, 'finish test result');
}

export async function finishTestResult(params: FinishTestResultParams): Promise<{ url: string }> {
  const fetchFn = params._fetchFn ?? fetch;
  // Reserve part of the overall timeout for the final PATCH so it still gets a
  // usable deadline when the report upload itself times out.
  const patchTimeout = params.timeout ? Math.min(FINISH_PATCH_RESERVE_MS, Math.ceil(params.timeout / 2)) : undefined;
  const uploadSignal = params.timeout && patchTimeout ? AbortSignal.timeout(params.timeout - patchTimeout) : undefined;
  const patchSignal = (): AbortSignal | undefined => patchTimeout ? AbortSignal.timeout(patchTimeout) : undefined;
  const url = dashboardUrl(params.testResultId);

  // The PATCH runs even when the report upload fails, so the run never stays "running".
  try {
    await uploadReportAssets(params.testResultId, params, fetchFn, uploadSignal);
  } catch (err) {
    await patchTestResult(params.testResultId, params, fetchFn, patchSignal()).catch((patchErr: unknown) => {
      debug('finish after failed upload also failed: %s', patchErr);
    });
    throw err;
  }
  await patchTestResult(params.testResultId, params, fetchFn, patchSignal());

  debug('upload complete url=%s', url);
  return { url };
}

/** One-shot upload after the run: create with stats (status derived server-side), then upload the report. */
export async function uploadTestResult(params: UploadTestResultParams): Promise<{ url: string }> {
  const fetchFn = params._fetchFn ?? fetch;
  const signal = params.timeout ? AbortSignal.timeout(params.timeout) : undefined;
  const stats = params.report['stats'] as PlaywrightStats | undefined;

  const created = await createTestResult({
    apiKey: params.apiKey,
    userAgent: params.userAgent,
    gitInfo: params.gitInfo,
    name: params.name,
    tags: params.tags,
    environment: params.environment,
    stats,
    status: statusFromStats(stats),
    timeout: params.timeout,
    _fetchFn: fetchFn,
  });
  await uploadReportAssets(created.id, { apiKey: params.apiKey, testResultId: created.id, report: params.report }, fetchFn, signal);

  debug('upload complete url=%s', created.url);
  return { url: created.url };
}

// Mirrors the server derivation so a one-shot upload never lands as "running".
function statusFromStats(stats: PlaywrightStats | undefined): TestRunStatus {
  if (stats && stats.unexpected > 0) {
    return 'failed';
  }
  if (stats && stats.flaky > 0) {
    return 'flaky';
  }
  return 'passed';
}
