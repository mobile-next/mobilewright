import createDebug from 'debug';

const debug = createDebug('mw:driver-saucelabs:rest');

// ─── Public types ─────────────────────────────────────────────────────────────

export type SessionState = 'PENDING' | 'CREATING' | 'ACTIVE' | 'CLOSING' | 'CLOSED' | 'ERRORED';
export type DeviceOs = 'ANDROID' | 'IOS';

export interface SessionLinks {
  ioWebsocketUrl: string;
  eventsWebsocketUrl: string;
  liveViewUrl?: string;
  adbUrl?: string | null;
}

export interface SessionDevice {
  descriptor: string;
  deviceName?: string;
  os: DeviceOs;
  osVersion?: string;
}

export interface Session {
  id: string;
  state: SessionState;
  device?: SessionDevice;
  links?: SessionLinks;
}

export interface SessionCreation {
  id: string;
  state: SessionState;
}

export interface DeviceDescriptor {
  id: string;
  name: string;
  os: DeviceOs;
  osVersion?: string;
  resolutionWidth?: number;
  resolutionHeight?: number;
  pixelsPerPoint?: number;
  defaultOrientation?: string;
  isPrivate?: boolean;
  isTablet?: boolean;
  modelNumber?: string;
}

export interface DeviceStatus {
  descriptor: string;
  isPrivateDevice: boolean;
  state: string;
  inUseBy?: Array<{ username: string }>;
}

export interface DeviceStatusResponse {
  devices: DeviceStatus[];
}

export interface ExecuteShellCommandResponse {
  stdout: string;
}

export interface AppInstallationStatus {
  installationId?: string;
  app?: string;
  status: string;
}

export interface ListAppInstallationsResponse {
  appInstallations: AppInstallationStatus[];
}

export interface LaunchWebDriverAgentResponse {
  status: string;
}

export interface CheckWebDriverAgentStatusResponse {
  state: string;
  devicePort?: number;
  hostPort?: number;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export type Region = 'us-west-1' | 'eu-central-1' | 'us-east-4';

function regionToBaseUrl(region: Region): string {
  return `https://api.${region}.saucelabs.com/rdc/v2`;
}

function regionToStorageUrl(region: Region): string {
  return `https://api.${region}.saucelabs.com/v1/storage/upload`;
}

function regionToStorageFilesUrl(region: Region): string {
  return `https://api.${region}.saucelabs.com/v1/storage/files`;
}

// Repackages a WDA zip (containing .app at root) into an IPA (Payload/<App>.app/...)
async function repackageToIpa(zipBuffer: Buffer): Promise<Buffer> {
  const { default: AdmZip } = await import('adm-zip');
  const input = new AdmZip(zipBuffer);
  const output = new AdmZip();
  for (const entry of input.getEntries()) {
    output.addFile(`Payload/${entry.entryName}`, entry.getData(), '', entry.attr);
  }
  return output.toBuffer();
}

// Derives a versioned IPA filename from the source URL, e.g.
// .../v15.0.0/WebDriverAgentRunner-Runner.zip → v15.0.0-WebDriverAgentRunner-Runner.ipa
function ipaFilenameFromUrl(url: string): string {
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  const base = (parts.at(-1) ?? 'wda.zip').replace(/\.zip$/i, '.ipa');
  const version = parts.at(-2);
  return version ? `${version}-${base}` : base;
}

/** Bundle ID used when launching WebDriverAgent on the device. Falls back to SAUCE_WDA_BUNDLE_ID env var when omitted. */
export const DEFAULT_WDA_BUNDLE_ID =
  process.env['SAUCE_WDA_BUNDLE_ID'] ?? 'com.facebook.WebDriverAgentRunner.xctrunner';

/** HTTP client for the Sauce Labs RDC v2 and App Storage APIs, used to manage sessions, devices, and app artifacts. */
export class RestClient {
  private readonly baseUrl: string;
  private readonly storageUrl: string;
  private readonly storageFilesUrl: string;
  private readonly authHeader: string;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(
    username: string,
    accessKey: string,
    region: Region = 'us-west-1',
    _fetchFn?: typeof globalThis.fetch,
  ) {
    this.baseUrl = regionToBaseUrl(region);
    this.storageUrl = regionToStorageUrl(region);
    this.storageFilesUrl = regionToStorageFilesUrl(region);
    this.authHeader = `Basic ${Buffer.from(`${username}:${accessKey}`).toString('base64')}`;
    this.fetchFn = _fetchFn ?? globalThis.fetch;
  }

  // ─── Session ──────────────────────────────────────────────────────────────

  /** Creates a new RDC session and returns its ID and initial state. */
  async createSession(body: {
    device: { os: DeviceOs; deviceName?: string };
    configuration?: { sessionDuration?: string };
  }): Promise<SessionCreation> {
    debug('createSession %o', body);
    return this.post<SessionCreation>('/sessions', body);
  }

  /** Fetches the current state and WebSocket links for an existing session. */
  async getSession(sessionId: string): Promise<Session> {
    debug('getSession %s', sessionId);
    return this.get<Session>(`/sessions/${sessionId}`);
  }

  /** Terminates a session and releases the device back to the pool; tolerates 404 if the session already closed. */
  async deleteSession(sessionId: string): Promise<void> {
    debug('deleteSession %s', sessionId);
    await this.delete(`/sessions/${sessionId}`);
  }

  // ─── Devices ──────────────────────────────────────────────────────────────

  /** Returns the full catalog of devices available in the account's RDC pool. */
  async listDevices(): Promise<DeviceDescriptor[]> {
    debug('listDevices');
    return this.get<DeviceDescriptor[]>('/devices');
  }

  /** Returns real-time availability state (AVAILABLE / IN_USE) for all devices in the pool. */
  async listDeviceStatus(): Promise<DeviceStatusResponse> {
    debug('listDeviceStatus');
    return this.get<DeviceStatusResponse>('/devices/status');
  }

  // ─── Device interactions ──────────────────────────────────────────────────

  /** Captures the current device screen and returns the raw PNG bytes. */
  async takeScreenshot(sessionId: string): Promise<Buffer> {
    debug('takeScreenshot %s', sessionId);
    const url = `${this.baseUrl}/sessions/${sessionId}/device/takeScreenshot`;
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: { Authorization: this.authHeader },
    });
    if (!response.ok) {
      throw new Error(`takeScreenshot failed: ${response.status} ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /** Applies device-level settings such as orientation or animation state to the active session. */
  async applySettings(sessionId: string, settings: {
    orientation?: 'PORTRAIT' | 'LANDSCAPE';
    animations?: boolean;
  }): Promise<void> {
    debug('applySettings %s %o', sessionId, settings);
    await this.postNoContent(`/sessions/${sessionId}/device/applySettings`, settings);
  }

  /** Launches an already-installed app by bundle ID (iOS) or package/activity name (Android). */
  async launchApp(sessionId: string, opts: {
    bundleId?: string;
    packageName?: string;
    activityName?: string;
  }): Promise<void> {
    debug('launchApp %s %o', sessionId, opts);
    await this.postNoContent(`/sessions/${sessionId}/device/launchApp`, opts);
  }

  /** Installs an app from Sauce Storage onto the device, optionally launching it immediately after. */
  async installApp(
    sessionId: string,
    storageRef: string,
    opts: { launchAfterInstall?: boolean } = {},
  ): Promise<AppInstallationStatus> {
    debug('installApp %s storage=%s launch=%s', sessionId, storageRef, opts.launchAfterInstall ?? false);
    return this.post<AppInstallationStatus>(`/sessions/${sessionId}/device/installApp`, {
      app: storageRef,
      enableInstrumentation: true,
      ...(opts.launchAfterInstall ? { launchAfterInstall: true } : {}),
    });
  }

  /** Returns the list of pending and completed app installation records for a session. */
  async listAppInstallations(sessionId: string): Promise<ListAppInstallationsResponse> {
    debug('listAppInstallations %s', sessionId);
    return this.post<ListAppInstallationsResponse>(`/sessions/${sessionId}/device/listAppInstallations`, {});
  }

  /** Removes an installed app from the device by bundle ID (iOS) or package name (Android). */
  async uninstallApp(sessionId: string, opts: {
    bundleId?: string;
    packageName?: string;
  }): Promise<void> {
    debug('uninstallApp %s %o', sessionId, opts);
    await this.postNoContent(`/sessions/${sessionId}/device/uninstallApp`, opts);
  }

  /** Opens the given URL in the device's default browser. */
  async openUrl(sessionId: string, url: string): Promise<void> {
    debug('openUrl %s %s', sessionId, url);
    await this.postNoContent(`/sessions/${sessionId}/device/openUrl`, { url });
  }

  /** Runs an adb shell command on the device and returns its stdout (Android only). */
  async executeShellCommand(sessionId: string, command: string): Promise<string> {
    debug('executeShellCommand %s %s', sessionId, command);
    const result = await this.post<ExecuteShellCommandResponse>(
      `/sessions/${sessionId}/device/executeShellCommand`,
      { adbShellCommand: command },
    );
    return result.stdout;
  }

  // ─── WDA (iOS) ────────────────────────────────────────────────────────────

  /** Starts the WebDriverAgent process on the device using the specified bundle ID. */
  async launchWebDriverAgent(sessionId: string, opts: { bundleId?: string; app?: string } = {}): Promise<void> {
    const bundleId = opts.bundleId ?? DEFAULT_WDA_BUNDLE_ID;
    debug('launchWebDriverAgent %s bundleId=%s app=%s', sessionId, bundleId, opts.app);
    const body: Record<string, string> = { bundleId };
    if (opts.app) body['app'] = opts.app;
    await this.postNoContent(`/sessions/${sessionId}/device/launchWebDriverAgent`, body);
  }

  /** Returns the current WDA launch state and the device port it is listening on once running. */
  async checkWebDriverAgentStatus(sessionId: string): Promise<CheckWebDriverAgentStatusResponse> {
    debug('checkWebDriverAgentStatus %s', sessionId);
    return this.post<CheckWebDriverAgentStatusResponse>(
      `/sessions/${sessionId}/device/checkWebDriverAgentStatus`,
      {},
    );
  }

  // ─── WDA HTTP proxy ───────────────────────────────────────────────────────

  /** Proxies an HTTP request to WDA running on the device through the Sauce Labs reverse proxy. */
  async wdaRequest<T = unknown>(
    sessionId: string,
    method: string,
    wdaHost: string,
    wdaPort: number,
    wdaPath: string,
    body?: unknown,
  ): Promise<T> {
    const path = wdaPath.startsWith('/') ? wdaPath.slice(1) : wdaPath;
    const url = `${this.baseUrl}/sessions/${sessionId}/device/proxy/http/${wdaHost}/${wdaPort}/${path}`;
    debug('wdaRequest %s %s', method, url);
    const response = await this.fetchFn(url, {
      method,
      headers: {
        Authorization: this.authHeader,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`WDA proxy ${method} ${wdaPath} failed: ${response.status} ${text}`);
    }
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  // ─── App Storage upload ───────────────────────────────────────────────────

  /** Uploads a local file to Sauce Labs App Storage and returns a `storage:<id>` ref. */
  async uploadToStorage(filePath: string): Promise<string> {
    debug('uploadToStorage %s', filePath);
    const { readFile } = await import('node:fs/promises');
    const { basename } = await import('node:path');

    const content = await readFile(filePath);
    const filename = basename(filePath);

    const formData = new FormData();
    const blob = new Blob([content]);
    formData.append('payload', blob, filename);

    const response = await this.fetchFn(this.storageUrl, {
      method: 'POST',
      headers: { Authorization: this.authHeader },
      body: formData,
    });
    if (!response.ok) {
      throw new Error(`Storage upload failed: ${response.status} ${response.statusText}`);
    }
    const json = await response.json() as { item?: { id?: string } };
    const id = json?.item?.id;
    if (!id) {
      throw new Error(`Storage upload response missing item.id: ${JSON.stringify(json)}`);
    }
    debug('uploaded %s (%d bytes) → storage:%s', filename, content.length, id);
    return `storage:${id}`;
  }

  /** Downloads a file from an HTTPS URL and uploads it directly to Sauce Labs App Storage, returning a `storage:<id>` ref. */
  async uploadUrlToStorage(url: string): Promise<string> {
    debug('uploadUrlToStorage %s', url);
    const filename = new URL(url).pathname.split('/').pop() ?? 'upload.zip';

    const download = await this.fetchFn(url);
    if (!download.ok) {
      throw new Error(`Failed to download from ${url}: ${download.status} ${download.statusText}`);
    }
    const content = Buffer.from(await download.arrayBuffer());

    const formData = new FormData();
    formData.append('payload', new Blob([content]), filename);

    const response = await this.fetchFn(this.storageUrl, {
      method: 'POST',
      headers: { Authorization: this.authHeader },
      body: formData,
    });
    if (!response.ok) {
      throw new Error(`Storage upload failed: ${response.status} ${response.statusText}`);
    }
    const json = await response.json() as { item?: { id?: string } };
    const id = json?.item?.id;
    if (!id) {
      throw new Error(`Storage upload response missing item.id: ${JSON.stringify(json)}`);
    }
    debug('uploaded %s (%d bytes) → storage:%s', filename, content.length, id);
    return `storage:${id}`;
  }

  /** Searches Sauce Storage by exact filename and returns a `storage:<id>` ref if a match is found, otherwise null. */
  async findInStorage(filename: string): Promise<string | null> {
    debug('findInStorage %s', filename);
    const url = `${this.storageFilesUrl}?q=${encodeURIComponent(filename)}&page_size=5`;
    const response = await this.fetchFn(url, {
      headers: { Authorization: this.authHeader },
    });
    if (!response.ok) {
      debug('findInStorage failed: %s %s', response.status, response.statusText);
      return null;
    }
    const json = await response.json() as { items?: Array<{ id?: string; name?: string }> };
    const item = json.items?.find((i) => i.name === filename);
    if (item?.id) {
      debug('found %s in storage → storage:%s', filename, item.id);
      return `storage:${item.id}`;
    }
    return null;
  }

  /** Ensures the WDA IPA is available in Sauce Storage — reuses an existing upload if found, otherwise downloads the zip, repackages it as an IPA, and uploads it. */
  async uploadWdaToStorage(url: string): Promise<string> {
    debug('uploadWdaToStorage %s', url);
    const ipaFilename = ipaFilenameFromUrl(url);

    const existing = await this.findInStorage(ipaFilename);
    if (existing) {
      debug('WDA already in storage: %s', ipaFilename);
      return `storage:filename=${ipaFilename}`;
    }

    debug('downloading WDA zip from %s', url);
    const download = await this.fetchFn(url);
    if (!download.ok) {
      throw new Error(`Failed to download WDA from ${url}: ${download.status} ${download.statusText}`);
    }
    const zipBuffer = Buffer.from(await download.arrayBuffer());

    debug('repackaging WDA zip as IPA');
    const ipaBuffer = await repackageToIpa(zipBuffer);

    const formData = new FormData();
    formData.append('payload', new Blob([ipaBuffer]), ipaFilename);
    const response = await this.fetchFn(this.storageUrl, {
      method: 'POST',
      headers: { Authorization: this.authHeader },
      body: formData,
    });
    if (!response.ok) {
      throw new Error(`Storage upload failed: ${response.status} ${response.statusText}`);
    }
    const json = await response.json() as { item?: { id?: string } };
    const id = json?.item?.id;
    if (!id) {
      throw new Error(`Storage upload response missing item.id: ${JSON.stringify(json)}`);
    }
    debug('uploaded WDA as %s (id=%s)', ipaFilename, id);
    return `storage:filename=${ipaFilename}`;
  }

  // ─── HTTP helpers ─────────────────────────────────────────────────────────

  private async get<T>(path: string): Promise<T> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      headers: { Authorization: this.authHeader },
    });
    if (!response.ok) {
      throw new Error(`GET ${path} failed: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`POST ${path} failed: ${response.status} ${text}`);
    }
    return response.json() as Promise<T>;
  }

  private async postNoContent(path: string, body: unknown): Promise<void> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`POST ${path} failed: ${response.status} ${text}`);
    }
  }

  private async delete(path: string): Promise<void> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: { Authorization: this.authHeader },
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`DELETE ${path} failed: ${response.status} ${response.statusText}`);
    }
  }
}
