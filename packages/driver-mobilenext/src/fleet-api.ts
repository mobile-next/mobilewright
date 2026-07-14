import createDebug from 'debug';

const debug = createDebug('mw:driver-mobilenext:fleet-api');

export const DEFAULT_API_URL = 'https://api.mobilenext.ai';

const DEFAULT_ALLOCATION_TIMEOUT = 300_000;
const DEFAULT_REQUEST_TIMEOUT = 30_000;
const POLL_INTERVAL = 5_000;

export type DeviceStatus = 'provisioning' | 'in_use' | 'released';

export interface DeviceFilter {
  attribute: 'platform' | 'type' | 'name' | 'version';
  operator:
    | 'EQUALS'
    | 'GREATER_THAN'
    | 'GREATER_THAN_OR_EQUALS'
    | 'LESS_THAN'
    | 'LESS_THAN_OR_EQUALS'
    | 'STARTS_WITH'
    | 'CONTAINS';
  value: string;
}

export interface SessionDevice {
  /** Allocation id — stable and always present, including while provisioning. Not the physical id. */
  id: string;
  status: DeviceStatus;
  info: {
    platform: string;
    type?: string;
    name: string;
    osVersion: string;
    /** The physical device id (UDID/serial). Absent while provisioning; this is what device tools accept. */
    serial?: string;
  };
  createdAt: string;
  releasedAt?: string;
}

interface Session {
  id: string;
}

interface DeviceList {
  object: 'list';
  data: SessionDevice[];
}

// The POST .../devices response. Despite the OpenAPI doc, the server returns the legacy
// fleet.allocate shape, not a SessionDevice: a pre-booted device lands inline under `device`
// (whose `id` is the physical serial), while an on-demand one returns only `allocationId` with
// `state: "allocating"` and provisions minutes later.
interface AllocatePostResponse {
  allocationId: string;
  state?: string;
  device?: {
    id: string;
    name: string;
    model?: string;
    platform: string;
    type?: string;
    version?: string;
    state?: string;
  };
}

export interface FleetApiClientOptions {
  apiKey: string;
  apiUrl?: string;
  /** Timeout waiting for a provisioning device to become in_use, in ms. Default: 300000 (5 min). */
  allocationTimeout?: number;
  /** Timeout for a single HTTP request, in ms. Bounds a stalled fetch. Default: 30000. */
  requestTimeout?: number;
  /** Injected for testing. Defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

// A setTimeout that rejects when the signal aborts, so a mid-poll shutdown/timeout is not held up
// for the full interval.
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * REST client for the mobilefleet sessions/devices API. A session is created once per test run;
 * each device allocation lives under that session and is addressed by its physical serial.
 */
export class FleetApiClient {
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly allocationTimeout: number;
  private readonly requestTimeout: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: FleetApiClientOptions) {
    this.apiKey = options.apiKey;
    this.apiUrl = options.apiUrl ?? DEFAULT_API_URL;
    this.allocationTimeout = options.allocationTimeout ?? DEFAULT_ALLOCATION_TIMEOUT;
    this.requestTimeout = options.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async createSession(): Promise<string> {
    const session = await this.request<Session>('POST', '/api/v1/sessions');
    debug('created session %s', session.id);
    return session.id;
  }

  /**
   * Allocates a device into the session and waits until it is in_use (has a serial). A pre-booted
   * device is ready immediately; an on-demand one provisions for minutes before landing.
   */
  async allocateDevice(sessionId: string, filters: DeviceFilter[], signal?: AbortSignal): Promise<SessionDevice> {
    const path = `/api/v1/sessions/${encodeURIComponent(sessionId)}/devices`;
    const res = await this.request<AllocatePostResponse>('POST', path, { filters }, signal);
    debug('allocate accepted (allocationId=%s, state=%s)', res.allocationId, res.state ?? (res.device ? 'ready' : 'unknown'));

    // Pre-booted device: it is ready inline and its `id` is the physical serial.
    if (res.device?.id) {
      return {
        id: res.allocationId,
        status: 'in_use',
        info: {
          platform: res.device.platform,
          type: res.device.type,
          name: res.device.name,
          osVersion: res.device.version ?? '',
          serial: res.device.id,
        },
        createdAt: '',
      };
    }

    if (!res.allocationId) {
      throw new Error(`Allocate response missing allocationId: ${JSON.stringify(res)}`);
    }
    // On-demand device: poll the session's device list until this allocation lands with a serial.
    return this.waitForDevice(sessionId, res.allocationId, signal);
  }

  /** Releases a device back to the pool. Addressed by serial, the same id device tools accept. */
  async releaseDevice(sessionId: string, serial: string): Promise<void> {
    const path = `/api/v1/sessions/${encodeURIComponent(sessionId)}/devices/${encodeURIComponent(serial)}/release`;
    await this.request('POST', path);
    debug('released device %s', serial);
  }

  // A provisioning device has no serial, and GET .../devices/{id} matches on serial — so the only
  // way to watch a still-provisioning allocation is to list the session's devices and match by
  // allocation id until it transitions to in_use.
  private async waitForDevice(sessionId: string, allocationId: string, signal?: AbortSignal): Promise<SessionDevice> {
    const deadline = Date.now() + this.allocationTimeout;
    while (Date.now() < deadline) {
      await delay(POLL_INTERVAL, signal);
      const list = await this.request<DeviceList>('GET', `/api/v1/sessions/${encodeURIComponent(sessionId)}/devices`, undefined, signal);
      const device = list.data.find((d) => d.id === allocationId);
      if (!device) {
        continue;
      }
      debug('waiting for device (allocationId=%s, status=%s)', allocationId, device.status);
      if (device.status === 'in_use' && device.info.serial) {
        return device;
      }
      if (device.status === 'released') {
        throw new Error(`Device allocation ${allocationId} was released before becoming ready`);
      }
    }
    throw new Error(
      `Timed out waiting for device allocation after ${this.allocationTimeout / 1000}s (session=${sessionId}, allocation=${allocationId})`,
    );
  }

  private async request<T = void>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = { 'Authorization': `Bearer ${this.apiKey}` };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    // Bound the call: a private controller fires on requestTimeout, and an external signal (pool
    // shutdown/allocation timeout) is forwarded into it so a stalled fetch aborts either way. The
    // controller covers body reading too, so a response whose body stalls is bounded as well.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeout);
    const onExternalAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    try {
      const res = await this.fetchFn(`${this.apiUrl}${path}`, {
        method,
        headers,
        signal: controller.signal,
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });

      if (!res.ok) {
        const detail = await this.errorDetail(res);
        throw new Error(`${method} ${path} failed with ${res.status}${detail ? `: ${detail}` : ''}`);
      }
      if (res.status === 204) {
        debug('%s %s -> %d (no content)', method, path, res.status);
        return undefined as T;
      }
      const result = (await res.json()) as T;
      debug('%s %s -> %d %o', method, path, res.status, result);
      return result;
    } catch (err) {
      if (signal?.aborted) {
        throw new Error(`${method} ${path} aborted`);
      }
      if (controller.signal.aborted) {
        throw new Error(`${method} ${path} timed out after ${this.requestTimeout}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  // The API's error body is {error: {code, message}}; surface both so callers see actionable text.
  private async errorDetail(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body?.error?.message) {
        return body.error.code ? `${body.error.code} — ${body.error.message}` : body.error.message;
      }
    } catch {
      // non-JSON body — nothing to add
    }
    return '';
  }
}
