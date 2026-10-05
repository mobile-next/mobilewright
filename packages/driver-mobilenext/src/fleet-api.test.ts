import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { FleetApiClient, type SessionDevice } from './fleet-api.js';
import { NoDeviceAvailableError } from '@mobilewright/protocol';

interface RecordedCall {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  authorization: string | null;
  userAgent: string | null;
}

interface StubResponse {
  status?: number;
  json: unknown;
}

// A fetch stub that records every request and replays the given responses in order. The last
// response repeats once exhausted, so pollers that call the same endpoint N times keep working.
function stubFetch(responses: StubResponse[]): { fetchFn: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let index = 0;

  const fetchFn = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({
      method: init.method ?? 'GET',
      url,
      path: new URL(url).pathname,
      headers,
      // A JSON request body is a string; an upload body is a file stream.
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
      authorization: headers?.['Authorization'] ?? null,
      userAgent: headers?.['User-Agent'] ?? null,
    });
    const chosen = responses[Math.min(index, responses.length - 1)];
    index += 1;
    const status = chosen.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => chosen.json,
    } as Response;
  }) as unknown as typeof fetch;

  return { fetchFn, calls };
}

function readyDevice(serial: string): SessionDevice {
  return {
    id: 'alloc-1',
    status: 'in_use',
    info: { platform: 'ios', type: 'real', name: 'iPhone 15', osVersion: '17.0', serial },
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function provisioningDevice(): SessionDevice {
  return {
    id: 'alloc-1',
    status: 'provisioning',
    info: { platform: 'ios', type: 'real', name: 'iPhone 15', osVersion: '17.0' },
    createdAt: '2026-01-01T00:00:00Z',
  };
}

test('createSession posts to the sessions endpoint with a bearer token', async () => {
  const { fetchFn, calls } = stubFetch([{ status: 201, json: { id: 'sess-1' } }]);
  const client = new FleetApiClient({ apiKey: 'mob_test', fetchFn });

  const sessionId = await client.createSession();

  expect(sessionId).toBe('sess-1');
  expect(calls[0].method).toBe('POST');
  expect(calls[0].path).toBe('/api/v1/sessions');
  expect(calls[0].authorization).toBe('Bearer mob_test');
  expect(calls[0].userAgent).toMatch(/^mobilewright\/\d+\.\d+\.\d+$/);
});

const IOS_FILTERS = [{ attribute: 'platform', operator: 'EQUALS', value: 'ios' }] as const;

test('allocateDevice polls the device list, matching its id, until the device lands', async () => {
  const readyB = readyDevice('SERIAL-B'); // its `id` is the allocation id the POST returned
  const { fetchFn, calls } = stubFetch([
    { status: 202, json: { allocationId: 'alloc-1', sessionId: 'sess-1', state: 'allocating' } },
    { status: 200, json: { object: 'list', data: [provisioningDevice()] } }, // first poll — not ready
    { status: 200, json: { object: 'list', data: [readyB] } }, // second poll — ready
  ]);
  const client = new FleetApiClient({ apiKey: 'mob_test', fetchFn });

  const device = await client.allocateDevice('sess-1', [...IOS_FILTERS]);

  expect(device.info.serial).toBe('SERIAL-B');
  expect(calls[0].path).toBe('/api/v1/sessions/sess-1/devices');
  expect(calls[0].body).toEqual({ filters: IOS_FILTERS });
  expect(calls[1].method).toBe('GET');
  expect(calls[1].path).toBe('/api/v1/sessions/sess-1/devices');
});

test('allocateDevice asks the fleet to install the stored files as file references', async () => {
  const { fetchFn, calls } = stubFetch([
    { status: 202, json: { allocationId: 'alloc-1', sessionId: 'sess-1', state: 'allocating' } },
    { status: 200, json: { object: 'list', data: [readyDevice('SERIAL-A')] } },
  ]);
  const client = new FleetApiClient({ apiKey: 'mob_test', fetchFn });

  await client.allocateDevice('sess-1', [...IOS_FILTERS], ['file-1', 'file-2']);

  expect(calls[0].body).toEqual({ filters: IOS_FILTERS, installApps: ['file:file-1', 'file:file-2'] });
});

test('an already booted device is also waited for through the device list', async () => {
  const { fetchFn, calls } = stubFetch([
    { status: 201, json: { allocationId: 'alloc-1', device: { id: 'SERIAL-A', name: 'Pixel 8', platform: 'android' } } },
    { status: 200, json: { object: 'list', data: [readyDevice('SERIAL-A')] } },
  ]);
  const client = new FleetApiClient({ apiKey: 'mob_test', fetchFn });

  const device = await client.allocateDevice('sess-1', [{ attribute: 'platform', operator: 'EQUALS', value: 'android' }]);

  expect(device.info.serial).toBe('SERIAL-A');
  expect(calls[1].path).toBe('/api/v1/sessions/sess-1/devices');
});

function appFileContaining(content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'fleet-api-')), 'My App.ipa');
  writeFileSync(path, content);
  return path;
}

// sha256 of "hello"
const HELLO_SHA256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

test('uploadFile declares the file by sha256 and skips the upload when it is already stored', async () => {
  const { fetchFn, calls } = stubFetch([{ status: 200, json: { id: 'file-1', status: 'ready' } }]);
  const client = new FleetApiClient({ apiKey: 'mob_test', fetchFn });

  const fileId = await client.uploadFile(appFileContaining('hello'));

  expect(fileId).toBe('file-1');
  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/api/v1/files');
  expect(calls[0].body).toEqual({ filename: 'My_App.ipa', filesize: 5, sha256: HELLO_SHA256 });
});

test('uploadFile puts the bytes with the signed headers, then completes the file', async () => {
  const signedHeaders = { 'X-Amz-Checksum-Sha256': 'abc', 'Content-Length': '5' };
  const { fetchFn, calls } = stubFetch([
    { status: 201, json: { id: 'file-1', status: 'pendingUpload', upload: { method: 'PUT', url: 'https://storage.test/put', headers: signedHeaders } } },
    { status: 200, json: {} },
    { status: 200, json: { id: 'file-1', status: 'ready' } },
  ]);
  const client = new FleetApiClient({ apiKey: 'mob_test', fetchFn });

  const fileId = await client.uploadFile(appFileContaining('hello'));

  expect(fileId).toBe('file-1');
  expect(calls[1].method).toBe('PUT');
  expect(calls[1].url).toBe('https://storage.test/put');
  expect(calls[1].headers).toEqual(signedHeaders);
  expect(calls[2].method).toBe('POST');
  expect(calls[2].path).toBe('/api/v1/files/file-1/complete');
});

test('uploadFile fails with the reason when the stored bytes do not verify', async () => {
  const { fetchFn } = stubFetch([
    { status: 201, json: { id: 'file-1', status: 'pendingUpload', upload: { method: 'PUT', url: 'https://storage.test/put', headers: {} } } },
    { status: 200, json: {} },
    { status: 200, json: { id: 'file-1', status: 'failed', failureReason: 'not a valid ipa' } },
  ]);
  const client = new FleetApiClient({ apiKey: 'mob_test', fetchFn });

  await expect(client.uploadFile(appFileContaining('hello'))).rejects.toThrow(/not a valid ipa/);
});

test('installFile installs the stored file on the device by serial', async () => {
  const { fetchFn, calls } = stubFetch([{ status: 200, json: { file: 'file-1', status: 'installed', bundleId: 'com.acme', launched: false } }]);
  const client = new FleetApiClient({ apiKey: 'mob_test', fetchFn });

  await client.installFile('sess-1', 'SERIAL-A', 'file-1');

  expect(calls[0].path).toBe('/api/v1/sessions/sess-1/devices/SERIAL-A/install');
  expect(calls[0].body).toEqual({ file: 'file-1' });
});

test('findSessionOfDevice returns the session where the device is in use', async () => {
  const released = { ...readyDevice('SERIAL-A'), status: 'released' };
  const { fetchFn } = stubFetch([{
    status: 200,
    json: {
      object: 'list',
      data: [
        { id: 'sess-old', devices: [released] },
        { id: 'sess-live', devices: [readyDevice('SERIAL-A')] },
      ],
    },
  }]);
  const client = new FleetApiClient({ apiKey: 'mob_test', fetchFn });

  expect(await client.findSessionOfDevice('SERIAL-A')).toBe('sess-live');
});

test('releaseDevice targets the device by serial', async () => {
  const { fetchFn, calls } = stubFetch([{ status: 202, json: readyDevice('SERIAL-A') }]);
  const client = new FleetApiClient({ apiKey: 'mob_test', fetchFn });

  await client.releaseDevice('sess-1', 'SERIAL-A');

  expect(calls[0].method).toBe('POST');
  expect(calls[0].path).toBe('/api/v1/sessions/sess-1/devices/SERIAL-A/release');
});

// A fetch that never resolves on its own; it only settles by rejecting when its signal aborts —
// which is exactly how a real stalled connection behaves once the client's controller fires.
function stallingFetch(): typeof fetch {
  return (async (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init.signal as AbortSignal;
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
}

test('a stalled request aborts and is reported as a timeout', async () => {
  const client = new FleetApiClient({ apiKey: 'mob_test', fetchFn: stallingFetch(), requestTimeout: 20 });

  await expect(client.createSession()).rejects.toThrow(/timed out after 20ms/);
});

test('an external abort signal cancels an in-flight allocation', async () => {
  const controller = new AbortController();
  const client = new FleetApiClient({ apiKey: 'mob_test', fetchFn: stallingFetch() });

  const pending = client.allocateDevice('sess-1', [...IOS_FILTERS], [], controller.signal);
  controller.abort();

  await expect(pending).rejects.toThrow(/aborted/);
});

test('a failed request surfaces the API error code and message', async () => {
  const { fetchFn } = stubFetch([
    { status: 402, json: { error: { code: 'insufficient_credits', message: 'Not enough credits' } } },
  ]);
  const client = new FleetApiClient({ apiKey: 'mob_test', fetchFn });

  await expect(client.createSession()).rejects.toThrow(/insufficient_credits — Not enough credits/);
});

test('a 429 concurrency limit is a retriable NoDeviceAvailableError, so the pool re-queues instead of failing the test', async () => {
  const { fetchFn } = stubFetch([
    { status: 429, json: { error: { code: 'concurrency_limit', message: '1/1 concurrent allocations' } } },
  ]);
  const client = new FleetApiClient({ apiKey: 'mob_test', fetchFn });

  const pending = client.allocateDevice('sess-1', [{ attribute: 'platform', operator: 'EQUALS', value: 'ios' }]);

  await expect(pending).rejects.toBeInstanceOf(NoDeviceAvailableError);
  await expect(pending).rejects.toThrow(/concurrency_limit/);
});

test('a server draining for deploy (503) is retried until a healthy instance answers', async () => {
  const { fetchFn, calls } = stubFetch([
    { status: 503, json: { error: { code: 'server_draining', message: 'this instance is draining for deploy' } } },
    { status: 503, json: { error: { code: 'server_draining', message: 'this instance is draining for deploy' } } },
    { status: 201, json: { id: 'sess-1' } },
  ]);
  const client = new FleetApiClient({ apiKey: 'mob_test', fetchFn, retryDelay: 0 });

  expect(await client.createSession()).toBe('sess-1');
  expect(calls).toHaveLength(3);
});

test('a server that stays unavailable fails after the last retry', async () => {
  const { fetchFn, calls } = stubFetch([{ status: 503, json: { error: { code: 'server_draining', message: 'draining' } } }]);
  const client = new FleetApiClient({ apiKey: 'mob_test', fetchFn, retryDelay: 0 });

  await expect(client.createSession()).rejects.toThrow(/503: server_draining/);
  expect(calls).toHaveLength(10);
});

test('a stalled upload to storage aborts after the install timeout', async () => {
  const declaredWithUpload = { id: 'file-1', status: 'pendingUpload', upload: { method: 'PUT', url: 'https://storage.test/put', headers: {} } };
  const fetchFn = (async (url: string, init: RequestInit) => {
    if (url.startsWith('https://storage.test')) {
      return stallingFetch()(url, init);
    }
    return { ok: true, status: 201, json: async () => declaredWithUpload } as Response;
  }) as unknown as typeof fetch;
  const client = new FleetApiClient({ apiKey: 'mob_test', fetchFn, installTimeout: 20 });

  await expect(client.uploadFile(appFileContaining('hello'))).rejects.toThrow(/aborted/);
});
