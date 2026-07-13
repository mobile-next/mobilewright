import { test, expect } from '@playwright/test';
import { FleetApiClient, type SessionDevice } from './fleet-api.js';

interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
  authorization: string | null;
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
      path: new URL(url).pathname,
      body: init.body ? JSON.parse(init.body as string) : undefined,
      authorization: headers?.['Authorization'] ?? null,
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
});

test('allocateDevice returns immediately for a pre-booted device (serial is device.id)', async () => {
  // The 201 response is the legacy fleet.allocate shape: the ready device lands inline under
  // `device`, and its `id` is the physical serial the driver drives with.
  const { fetchFn, calls } = stubFetch([
    {
      status: 201,
      json: {
        allocationId: 'alloc-1',
        device: { id: 'SERIAL-A', name: 'iPhone 15', model: 'iPhone15,2', platform: 'ios', type: 'real', version: '17.0', state: 'online' },
      },
    },
  ]);
  const client = new FleetApiClient({ apiKey: 'mob_test', fetchFn });

  const device = await client.allocateDevice('sess-1', [
    { attribute: 'platform', operator: 'EQUALS', value: 'ios' },
  ]);

  expect(device.info.serial).toBe('SERIAL-A');
  expect(device.info.osVersion).toBe('17.0');
  // No polling was needed, so only the allocate POST happened.
  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/api/v1/sessions/sess-1/devices');
  expect(calls[0].body).toEqual({ filters: [{ attribute: 'platform', operator: 'EQUALS', value: 'ios' }] });
});

test('allocateDevice polls the device list, matching its allocationId, until the device lands', async () => {
  const readyB = readyDevice('SERIAL-B'); // its `id` is the allocation id the POST returned
  const { fetchFn, calls } = stubFetch([
    { status: 202, json: { allocationId: 'alloc-1', state: 'allocating' } }, // on-demand POST
    { status: 200, json: { object: 'list', data: [provisioningDevice()] } }, // first poll — not ready
    { status: 200, json: { object: 'list', data: [readyB] } }, // second poll — ready
  ]);
  const client = new FleetApiClient({ apiKey: 'mob_test', fetchFn });

  const device = await client.allocateDevice('sess-1', [
    { attribute: 'platform', operator: 'EQUALS', value: 'ios' },
  ]);

  expect(device.info.serial).toBe('SERIAL-B');
  expect(calls[1].method).toBe('GET');
  expect(calls[1].path).toBe('/api/v1/sessions/sess-1/devices');
});

test('releaseDevice targets the device by serial', async () => {
  const { fetchFn, calls } = stubFetch([{ status: 202, json: readyDevice('SERIAL-A') }]);
  const client = new FleetApiClient({ apiKey: 'mob_test', fetchFn });

  await client.releaseDevice('sess-1', 'SERIAL-A');

  expect(calls[0].method).toBe('POST');
  expect(calls[0].path).toBe('/api/v1/sessions/sess-1/devices/SERIAL-A/release');
});

test('a failed request surfaces the API error code and message', async () => {
  const { fetchFn } = stubFetch([
    { status: 402, json: { error: { code: 'insufficient_credits', message: 'Not enough credits' } } },
  ]);
  const client = new FleetApiClient({ apiKey: 'mob_test', fetchFn });

  await expect(client.createSession()).rejects.toThrow(/insufficient_credits — Not enough credits/);
});
