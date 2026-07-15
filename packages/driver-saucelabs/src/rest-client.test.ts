import { test, expect } from '@playwright/test';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RestClient } from './rest-client.js';

// ─── Mock fetch helpers ──────────────────────────────────────────────────────

type FetchCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

function makeMockFetch(responses: Record<string, { status: number; body: unknown }>) {
  const calls: FetchCall[] = [];

  const mockFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    let parsedBody: unknown = init?.body;
    if (typeof parsedBody === 'string') {
      try { parsedBody = JSON.parse(parsedBody); } catch { /* leave as string */ }
    }
    calls.push({ url, method, headers, body: parsedBody });

    // match the longest suffix key
    const key = Object.keys(responses).find((k) => url.includes(k)) ?? '__default';
    const resp = responses[key] ?? { status: 200, body: {} };
    const responseBody = resp.body instanceof Uint8Array
      ? resp.body
      : JSON.stringify(resp.body);
    return new Response(responseBody as string, { status: resp.status });
  };

  return { mockFetch: mockFetch as typeof globalThis.fetch, calls };
}

const BASE = 'https://api.us-west-1.saucelabs.com/rdc/v2';
const STORAGE_BASE = 'https://api.us-west-1.saucelabs.com/v1/storage/upload';

function client(overrides?: Record<string, { status: number; body: unknown }>) {
  const { mockFetch, calls } = makeMockFetch(overrides ?? { '': { status: 200, body: {} } });
  const rest = new RestClient('alice', 'secret-key', 'us-west-1', mockFetch);
  return { rest, calls };
}

// ─── Auth header ─────────────────────────────────────────────────────────────

test('includes Basic auth header with base64(username:accessKey)', async () => {
  const { rest, calls } = client({ '/sessions': { status: 200, body: { id: 's1', state: 'CREATING' } } });
  await rest.createSession({ device: { os: 'ANDROID' } });

  const expectedToken = Buffer.from('alice:secret-key').toString('base64');
  expect(calls[0].headers['Authorization']).toBe(`Basic ${expectedToken}`);
});

// ─── Region → URL ────────────────────────────────────────────────────────────

test('uses eu-central-1 base URL when region is eu-central-1', async () => {
  const { mockFetch, calls } = makeMockFetch({ '': { status: 200, body: [] } });
  const rest = new RestClient('u', 'k', 'eu-central-1', mockFetch);
  await rest.listDevices();
  expect(calls[0].url).toMatch(/api\.eu-central-1\.saucelabs\.com/);
});

test('uses us-east-4 base URL when region is us-east-4', async () => {
  const { mockFetch, calls } = makeMockFetch({ '': { status: 200, body: [] } });
  const rest = new RestClient('u', 'k', 'us-east-4', mockFetch);
  await rest.listDevices();
  expect(calls[0].url).toMatch(/api\.us-east-4\.saucelabs\.com/);
});

// ─── Session endpoints ───────────────────────────────────────────────────────

test('createSession sends POST /sessions with device os', async () => {
  const { rest, calls } = client({ '/sessions': { status: 200, body: { id: 's1', state: 'CREATING' } } });
  await rest.createSession({ device: { os: 'ANDROID' } });

  expect(calls[0].method).toBe('POST');
  expect(calls[0].url).toBe(`${BASE}/sessions`);
  expect((calls[0].body as Record<string, unknown>)['device']).toMatchObject({ os: 'ANDROID' });
});

test('createSession includes sessionDuration when provided', async () => {
  const { rest, calls } = client({ '/sessions': { status: 200, body: { id: 's1', state: 'CREATING' } } });
  await rest.createSession({
    device: { os: 'IOS' },
    configuration: { sessionDuration: 'PT1H' },
  });

  const body = calls[0].body as Record<string, unknown>;
  expect((body['configuration'] as Record<string, unknown>)['sessionDuration']).toBe('PT1H');
});

test('getSession sends GET /sessions/{id}', async () => {
  const { rest, calls } = client({ '/sessions/abc': { status: 200, body: { id: 'abc', state: 'ACTIVE' } } });
  const session = await rest.getSession('abc');

  expect(calls[0].method).toBe('GET');
  expect(calls[0].url).toBe(`${BASE}/sessions/abc`);
  expect(session.state).toBe('ACTIVE');
});

test('deleteSession sends DELETE /sessions/{id}', async () => {
  const { rest, calls } = client({ '/sessions/abc': { status: 200, body: {} } });
  await rest.deleteSession('abc');

  expect(calls[0].method).toBe('DELETE');
  expect(calls[0].url).toBe(`${BASE}/sessions/abc`);
});

test('deleteSession does not throw on 404', async () => {
  const { rest } = client({ '/sessions/abc': { status: 404, body: null } });
  await expect(rest.deleteSession('abc')).resolves.toBeUndefined();
});

// ─── Device endpoints ────────────────────────────────────────────────────────

test('listDevices sends GET /devices', async () => {
  const { rest, calls } = client({ '/devices': { status: 200, body: [] } });
  await rest.listDevices();

  expect(calls[0].method).toBe('GET');
  expect(calls[0].url).toBe(`${BASE}/devices`);
});

test('listDeviceStatus sends GET /devices/status', async () => {
  const { rest, calls } = client({ '/devices/status': { status: 200, body: { devices: [] } } });
  await rest.listDeviceStatus();

  expect(calls[0].method).toBe('GET');
  expect(calls[0].url).toBe(`${BASE}/devices/status`);
});

// ─── Device interaction endpoints ────────────────────────────────────────────

test('executeShellCommand sends adbShellCommand in body and returns stdout', async () => {
  const { rest, calls } = client({
    'executeShellCommand': { status: 200, body: { stdout: 'package:com.example.app\n' } },
  });
  const result = await rest.executeShellCommand('sess1', 'pm list packages -3');

  expect(calls[0].method).toBe('POST');
  expect(calls[0].url).toContain('/sessions/sess1/device/executeShellCommand');
  expect((calls[0].body as Record<string, unknown>)['adbShellCommand']).toBe('pm list packages -3');
  expect(result).toBe('package:com.example.app\n');
});

test('applySettings sends orientation in body', async () => {
  const { rest, calls } = client({ 'applySettings': { status: 200, body: {} } });
  await rest.applySettings('sess1', { orientation: 'LANDSCAPE' });

  expect(calls[0].method).toBe('POST');
  expect(calls[0].url).toContain('/sessions/sess1/device/applySettings');
  expect((calls[0].body as Record<string, unknown>)['orientation']).toBe('LANDSCAPE');
});

test('applySettings sends animations in body', async () => {
  const { rest, calls } = client({ 'applySettings': { status: 200, body: {} } });
  await rest.applySettings('sess1', { animations: false });

  expect((calls[0].body as Record<string, unknown>)['animations']).toBe(false);
});

test('launchApp sends bundleId for iOS', async () => {
  const { rest, calls } = client({ 'launchApp': { status: 200, body: {} } });
  await rest.launchApp('sess1', { bundleId: 'com.example.App' });

  expect(calls[0].url).toContain('/sessions/sess1/device/launchApp');
  expect((calls[0].body as Record<string, unknown>)['bundleId']).toBe('com.example.App');
});

test('launchApp sends packageName and activityName for Android', async () => {
  const { rest, calls } = client({ 'launchApp': { status: 200, body: {} } });
  await rest.launchApp('sess1', { packageName: 'com.example.app', activityName: '.MainActivity' });

  const body = calls[0].body as Record<string, unknown>;
  expect(body['packageName']).toBe('com.example.app');
  expect(body['activityName']).toBe('.MainActivity');
});

test('installApp sends storage ref and enableInstrumentation', async () => {
  const { rest, calls } = client({ 'installApp': { status: 200, body: { status: 'OK' } } });
  await rest.installApp('sess1', 'storage:uuid-123');

  const body = calls[0].body as Record<string, unknown>;
  expect(body['app']).toBe('storage:uuid-123');
  expect(body['enableInstrumentation']).toBe(true);
});

test('uninstallApp sends bundleId', async () => {
  const { rest, calls } = client({ 'uninstallApp': { status: 200, body: {} } });
  await rest.uninstallApp('sess1', { bundleId: 'com.example.App' });

  expect((calls[0].body as Record<string, unknown>)['bundleId']).toBe('com.example.App');
});

test('uninstallApp sends packageName for Android', async () => {
  const { rest, calls } = client({ 'uninstallApp': { status: 200, body: {} } });
  await rest.uninstallApp('sess1', { packageName: 'com.example.app' });

  expect((calls[0].body as Record<string, unknown>)['packageName']).toBe('com.example.app');
});

test('openUrl sends url in body', async () => {
  const { rest, calls } = client({ 'openUrl': { status: 200, body: {} } });
  await rest.openUrl('sess1', 'https://example.com');

  expect((calls[0].body as Record<string, unknown>)['url']).toBe('https://example.com');
});

test('takeScreenshot returns Buffer from binary response', async () => {
  const pngBytes = new Uint8Array([137, 80, 78, 71]);
  const { rest } = client({ 'takeScreenshot': { status: 200, body: pngBytes } });
  const result = await rest.takeScreenshot('sess1');

  expect(result).toBeInstanceOf(Buffer);
  expect(result[0]).toBe(137);
});

// ─── Storage upload ───────────────────────────────────────────────────────────

const tmpDir = mkdtempSync(join(tmpdir(), 'mw-saucelabs-rest-test-'));

test.afterAll(() => {
  rmSync(tmpDir, { recursive: true });
});

test('uploadToStorage sends FormData to storage URL and returns storage:uuid', async () => {
  const filePath = join(tmpDir, 'app.apk');
  writeFileSync(filePath, 'fake apk content');

  const { mockFetch, calls } = makeMockFetch({
    '': { status: 200, body: { item: { id: 'uuid-abc-123' } } },
  });
  const rest = new RestClient('u', 'k', 'us-west-1', mockFetch);
  const ref = await rest.uploadToStorage(filePath);

  expect(ref).toBe('storage:uuid-abc-123');
  expect(calls[0].url).toBe(STORAGE_BASE);
  expect(calls[0].method).toBe('POST');
  expect(calls[0].body).toBeInstanceOf(FormData);
});

test('uploadToStorage throws when response is missing item.id', async () => {
  const filePath = join(tmpDir, 'bad.apk');
  writeFileSync(filePath, 'content');

  const { mockFetch } = makeMockFetch({ '': { status: 200, body: {} } });
  const rest = new RestClient('u', 'k', 'us-west-1', mockFetch);
  await expect(rest.uploadToStorage(filePath)).rejects.toThrow('missing item.id');
});

// ─── WDA launch ──────────────────────────────────────────────────────────────

test('launchWebDriverAgent sends bundleId and no app when only bundleId is given', async () => {
  const { rest, calls } = client({ 'launchWebDriverAgent': { status: 200, body: {} } });
  await rest.launchWebDriverAgent('sess1', { bundleId: 'com.example.WDA' });

  expect(calls[0].method).toBe('POST');
  expect(calls[0].url).toContain('/sessions/sess1/device/launchWebDriverAgent');
  const body = calls[0].body as Record<string, unknown>;
  expect(body['bundleId']).toBe('com.example.WDA');
  expect(body['app']).toBeUndefined();
});

test('launchWebDriverAgent includes app when a storage ref is given', async () => {
  const { rest, calls } = client({ 'launchWebDriverAgent': { status: 200, body: {} } });
  await rest.launchWebDriverAgent('sess1', {
    bundleId: 'com.example.WDA',
    app: 'storage:wda-uuid-456',
  });

  const body = calls[0].body as Record<string, unknown>;
  expect(body['bundleId']).toBe('com.example.WDA');
  expect(body['app']).toBe('storage:wda-uuid-456');
});

test('launchWebDriverAgent uses DEFAULT_WDA_BUNDLE_ID when none is provided', async () => {
  const { rest, calls } = client({ 'launchWebDriverAgent': { status: 200, body: {} } });
  await rest.launchWebDriverAgent('sess1');

  const body = calls[0].body as Record<string, unknown>;
  expect(body['bundleId']).toBe('com.facebook.WebDriverAgentRunner.xctrunner');
});

test('launchWebDriverAgent uses xctrunner bundleId when app is provided without explicit bundleId', async () => {
  const { rest, calls } = client({ 'launchWebDriverAgent': { status: 200, body: {} } });
  await rest.launchWebDriverAgent('sess1', { app: 'storage:wda-uuid-xyz' });

  const body = calls[0].body as Record<string, unknown>;
  expect(body['bundleId']).toBe('com.facebook.WebDriverAgentRunner.xctrunner');
  expect(body['app']).toBe('storage:wda-uuid-xyz');
});

// ─── uploadUrlToStorage ───────────────────────────────────────────────────────

test('uploadUrlToStorage downloads from URL then uploads to storage', async () => {
  const fakeZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // ZIP magic bytes

  const { mockFetch, calls } = makeMockFetch({
    'github.com': { status: 200, body: fakeZip },
    'storage/upload': { status: 200, body: { item: { id: 'wda-uuid-789' } } },
  });
  const rest = new RestClient('u', 'k', 'us-west-1', mockFetch);

  const ref = await rest.uploadUrlToStorage(
    'https://github.com/appium/WebDriverAgent/releases/download/v15.0.0/WebDriverAgentRunner-Runner.zip',
  );

  expect(ref).toBe('storage:wda-uuid-789');
  expect(calls[0].method).toBe('GET');
  expect(calls[0].url).toContain('github.com');
  expect(calls[1].url).toBe(STORAGE_BASE);
  expect(calls[1].method).toBe('POST');
  expect(calls[1].body).toBeInstanceOf(FormData);
});

test('uploadUrlToStorage throws when download fails', async () => {
  const { mockFetch } = makeMockFetch({
    'github.com': { status: 404, body: 'Not Found' },
  });
  const rest = new RestClient('u', 'k', 'us-west-1', mockFetch);

  await expect(
    rest.uploadUrlToStorage('https://github.com/appium/WebDriverAgent/releases/download/v15.0.0/WebDriverAgentRunner-Runner.zip'),
  ).rejects.toThrow('Failed to download');
});

// ─── findInStorage ────────────────────────────────────────────────────────────

test('findInStorage returns storage ref when file is found', async () => {
  const { mockFetch, calls } = makeMockFetch({
    '/storage/files': { status: 200, body: { items: [{ id: 'found-uuid', name: 'v15.0.0-WebDriverAgentRunner-Runner.ipa' }] } },
  });
  const rest = new RestClient('u', 'k', 'us-west-1', mockFetch);
  const ref = await rest.findInStorage('v15.0.0-WebDriverAgentRunner-Runner.ipa');

  expect(ref).toBe('storage:found-uuid');
  expect(calls[0].url).toContain('/storage/files');
  expect(calls[0].url).toContain('v15.0.0-WebDriverAgentRunner-Runner.ipa');
});

test('findInStorage returns null when file is not found', async () => {
  const { mockFetch } = makeMockFetch({
    '/storage/files': { status: 200, body: { items: [] } },
  });
  const rest = new RestClient('u', 'k', 'us-west-1', mockFetch);
  const ref = await rest.findInStorage('missing.ipa');

  expect(ref).toBeNull();
});

test('findInStorage returns null on non-2xx response', async () => {
  const { mockFetch } = makeMockFetch({
    '/storage/files': { status: 500, body: {} },
  });
  const rest = new RestClient('u', 'k', 'us-west-1', mockFetch);
  const ref = await rest.findInStorage('something.ipa');

  expect(ref).toBeNull();
});

// ─── uploadWdaToStorage ───────────────────────────────────────────────────────

test('uploadWdaToStorage returns existing ref without downloading when file is in storage', async () => {
  const { mockFetch, calls } = makeMockFetch({
    '/storage/files': { status: 200, body: { items: [{ id: 'existing-uuid', name: 'v15.0.0-WebDriverAgentRunner-Runner.ipa' }] } },
  });
  const rest = new RestClient('u', 'k', 'us-west-1', mockFetch);
  const ref = await rest.uploadWdaToStorage(
    'https://github.com/appium/WebDriverAgent/releases/download/v15.0.0/WebDriverAgentRunner-Runner.zip',
  );

  expect(ref).toBe('storage:filename=v15.0.0-WebDriverAgentRunner-Runner.ipa');
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toContain('/storage/files');
});

test('uploadWdaToStorage derives versioned IPA filename from URL', async () => {
  const fakeZip = new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const { mockFetch, calls } = makeMockFetch({
    '/storage/files': { status: 200, body: { items: [] } },
    'github.com': { status: 200, body: fakeZip },
    'storage/upload': { status: 200, body: { item: { id: 'new-uuid' } } },
  });
  const rest = new RestClient('u', 'k', 'us-west-1', mockFetch);
  await rest.uploadWdaToStorage(
    'https://github.com/appium/WebDriverAgent/releases/download/v15.0.0/WebDriverAgentRunner-Runner.zip',
  );

  const uploadCall = calls.find((c) => c.url.includes('storage/upload'));
  expect(uploadCall).toBeTruthy();
  const formData = uploadCall!.body as FormData;
  expect(formData).toBeInstanceOf(FormData);
});

// ─── WDA proxy ────────────────────────────────────────────────────────────────

test('wdaRequest builds correct proxy URL', async () => {
  const { rest, calls } = client({
    '/proxy/http': { status: 200, body: { value: 'ok' } },
  });
  await rest.wdaRequest('sess1', 'GET', 'localhost', 8100, '/source', undefined);

  expect(calls[0].url).toBe(`${BASE}/sessions/sess1/device/proxy/http/localhost/8100/source`);
  expect(calls[0].method).toBe('GET');
});

test('wdaRequest strips leading slash from wdaPath', async () => {
  const { rest, calls } = client({ '/proxy/http': { status: 200, body: {} } });
  await rest.wdaRequest('sess1', 'POST', '127.0.0.1', 8100, '/wda/pressButton', { name: 'home' });

  expect(calls[0].url).toContain('/proxy/http/127.0.0.1/8100/wda/pressButton');
});

// ─── Error handling ───────────────────────────────────────────────────────────

test('throws with status code on non-2xx GET response', async () => {
  const { rest } = client({ '/devices': { status: 401, body: { error: 'Unauthorized' } } });
  await expect(rest.listDevices()).rejects.toThrow('401');
});

test('throws with status code on non-2xx POST response', async () => {
  const { rest } = client({ '/sessions': { status: 422, body: { error: 'Bad request' } } });
  await expect(rest.createSession({ device: { os: 'IOS' } })).rejects.toThrow('422');
});

test('throws with status code on non-2xx DELETE response', async () => {
  const { rest } = client({ '/sessions/x': { status: 500, body: {} } });
  await expect(rest.deleteSession('x')).rejects.toThrow('500');
});
