import { createReadStream, openSync, readSync, closeSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Transform } from 'node:stream';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import createDebug from 'debug';
import type {
  AllocatedDevice,
  AllocationCriteria,
  AppInfo,
  ConnectionConfig,
  DeviceInfo,
  DeviceState,
  DeviceType,
  GestureSequence,
  HardwareButton,
  LaunchOptions,
  ListDevicesOptions,
  MobilewrightDriver,
  Orientation,
  Platform,
  RecordingOptions,
  RecordingResult,
  ReporterEntry,
  ScreenSize,
  ScreenshotOptions,
  Session,
  SwipeDirection,
  SwipeOptions,
  ViewNode,
} from '@mobilewright/protocol';
import { RpcClient } from './rpc-client.js';
import { FleetApiClient, type DeviceFilter } from './fleet-api.js';
import type { MobileNextTestResultConfig } from './reporter.js';

export const DEFAULT_URL = 'wss://api.mobilenext.ai/ws';

const _require = createRequire(import.meta.url);

// ─── RPC response types ───────────────────────────────────────

interface MobileNextElement {
  type: string;
  text?: string;
  label?: string;
  name?: string;
  value?: string;
  identifier?: string;
  placeholder?: string;
  rect?: { x: number; y: number; width: number; height: number };
  children?: MobileNextElement[];
  visible?: boolean;
  enabled?: boolean;
}

interface MobileNextAppEntry {
  packageName?: string;
  bundleId?: string;
  appName?: string;
  version?: string;
}

interface MobileNextDeviceInfoResponse {
  device: {
    platform: string;
    screenSize?: { width: number; height: number; scale: number };
    screenWidth?: number;
    screenHeight?: number;
    [k: string]: unknown;
  };
}

interface MobileNextDeviceEntry {
  id?: string;
  udid?: string;
  name: string;
  platform: string;
  type: string;
  state: string;
  model?: string;
  version?: string;
}

interface MobileNextScreenshotResponse {
  data: string;
}

interface MobileNextOrientationResponse {
  orientation: string;
}

interface MobileNextUIDumpResponse {
  elements: MobileNextElement[];
}

interface MobileNextDevicesResponse {
  status: string;
  data: { devices: MobileNextDeviceEntry[] };
}

export interface MobileNextDriverOptions {
  apiKey?: string;
  /** Fleet API base URL override. Mainly for testing. */
  apiUrl?: string;
  /** Timeout waiting for a cloud device to be allocated from the pool, in ms. Default: 300000 (5 min). */
  allocationTimeout?: number;
  /** Test-result upload options for the auto-injected upload reporter. Omit to use defaults ('on'). */
  testResult?: MobileNextTestResultConfig;
  /** Timeout for uploading test results to mobilenext.ai, in ms. Default: none. */
  uploadTimeout?: number;
}

function buildFilters(criteria: AllocationCriteria): DeviceFilter[] {
  // The fleet API requires exactly one platform filter, so a missing platform is a caller error —
  // fail loudly instead of silently constraining every allocation to iOS.
  if (!criteria.platform) {
    throw new Error('MobileNextDriver.allocate requires a platform ("ios" or "android") to allocate a device');
  }
  // The fleet filter DSL has no exact-device selector (only platform/type/name/version), so a
  // pinned deviceId cannot be honored. Reject it rather than silently allocating a different
  // device — deviceId is for local drivers; select a cloud device by deviceName instead.
  if (criteria.deviceId) {
    throw new Error(
      `MobileNextDriver.allocate cannot pin a specific deviceId ("${criteria.deviceId}"): the fleet does not support exact-device selection. Remove deviceId or filter by deviceName.`,
    );
  }
  const filters: DeviceFilter[] = [
    { attribute: 'platform', operator: 'EQUALS', value: criteria.platform },
  ];
  if (criteria.deviceNamePattern) {
    filters.push({ attribute: 'name', operator: 'CONTAINS', value: criteria.deviceNamePattern });
  }
  return filters;
}

const VALID_PLATFORMS = new Set<string>(['ios', 'android']);
const VALID_DEVICE_TYPES = new Set<string>(['real', 'simulator', 'emulator']);
const VALID_DEVICE_STATES = new Set<string>(['online', 'offline']);

function toPlatform(value: string): Platform | undefined {
  return VALID_PLATFORMS.has(value) ? value as Platform : undefined;
}

function toDeviceType(value: string): DeviceType {
  return VALID_DEVICE_TYPES.has(value) ? value as DeviceType : 'real';
}

function toDeviceState(value: string): DeviceState {
  return VALID_DEVICE_STATES.has(value) ? value as DeviceState : 'offline';
}

function elementToViewNode(el: MobileNextElement): ViewNode {
  const bounds = el.rect ?? { x: 0, y: 0, width: 0, height: 0 };
  return {
    type: el.type ?? 'Unknown',
    label: el.label || undefined,
    identifier: el.identifier || undefined,
    value: el.value || undefined,
    text: el.text || undefined,
    placeholder: el.placeholder || undefined,
    isVisible: typeof el.visible === 'boolean' ? el.visible : bounds.width > 0 && bounds.height > 0,
    isEnabled: el.enabled ?? true,
    bounds,
    children: el.children?.map(elementToViewNode) ?? [],
    raw: { ...el },
  };
}

function appendQueryParam(url: string, key: string, value: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${key}=${encodeURIComponent(value)}`;
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4B, 0x03, 0x04]);

function assertValidZipFile(path: string): void {
  const buf = Buffer.alloc(4);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buf, { offset: 0, length: 4, position: 0 });
  } finally {
    closeSync(fd);
  }
  if (!buf.equals(ZIP_MAGIC)) {
    throw new Error(`"${path}" is not a valid ZIP file`);
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^0-9a-zA-Z_.]/g, '_');
}

interface UploadCreateResponse {
  uploadId: string;
  uploadUrl: string;
}

interface ActiveSession {
  deviceId: string;
  platform: Platform;
  rpc: RpcClient;
}

const debug = createDebug('mw:driver-mobilenext');

export class MobileNextDriver implements MobilewrightDriver {
  private session: ActiveSession | null = null;
  private readonly options: MobileNextDriverOptions;
  private readonly fleetClient: FleetApiClient;
  private fleetSessionPromise: Promise<string> | null = null;
  // serial -> the fleet session it was allocated in, needed to release it later.
  private readonly fleetSessionBySerial = new Map<string, string>();

  constructor(options: MobileNextDriverOptions = {}) {
    if (options.apiKey && options.apiUrl && !options.apiUrl.startsWith('https://')) {
      throw new Error(`MobileNextDriver apiUrl must use https when apiKey is set, got: ${options.apiUrl}`);
    }
    this.options = options;
    this.fleetClient = new FleetApiClient({
      apiKey: options.apiKey ?? '',
      apiUrl: options.apiUrl,
      allocationTimeout: options.allocationTimeout,
    });
  }

  // ─── Connection ──────────────────────────────────────────────

  // The device must already be allocated via the fleet sessions API (see FleetApiClient); this
  // driver only opens the RPC channel to drive it. deviceId is the physical serial the device
  // tools accept.
  async connect(config: ConnectionConfig): Promise<Session> {
    if (!config.deviceId) {
      throw new Error('MobileNextDriver.connect requires a deviceId — allocate a device via the fleet sessions API first');
    }

    const baseUrl = config.url ?? DEFAULT_URL;
    const url = this.options.apiKey
      ? appendQueryParam(baseUrl, 'token', this.options.apiKey)
      : baseUrl;
    debug('connecting to %s (device=%s)', baseUrl, config.deviceId);
    const rpc = new RpcClient(url, config.timeout);
    await rpc.connect();
    debug('websocket connected');

    this.session = { deviceId: config.deviceId, platform: config.platform, rpc };
    return { deviceId: config.deviceId, platform: config.platform };
  }

  async disconnect(): Promise<void> {
    const session = this.requireSession();
    await session.rpc.disconnect();
    this.session = null;
    debug('disconnected');
  }

  // ─── UI hierarchy ───────────────────────────────────────────

  async getViewHierarchy(): Promise<ViewNode[]> {
    const result = await this.call<MobileNextUIDumpResponse>('device.dump.ui');
    return result.elements.map(elementToViewNode);
  }

  // ─── Input ──────────────────────────────────────────────────

  async tap(x: number, y: number): Promise<void> {
    await this.call('device.io.tap', { x: Math.round(x), y: Math.round(y) });
  }

  async doubleTap(x: number, y: number): Promise<void> {
    await this.call('device.io.tap', { x, y });
    await this.call('device.io.tap', { x, y });
  }

  async longPress(x: number, y: number, duration?: number): Promise<void> {
    await this.call('device.io.longpress', { x, y, ...(duration !== undefined && { duration }) });
  }

  async typeText(text: string): Promise<void> {
    await this.call('device.io.text', { text });
  }

  async pressKeys(keys: string[]): Promise<void> {
    await this.call('device.io.keys', { keys });
  }

  async clearText(): Promise<void> {
    const selectAll = this.requireSession().platform === 'ios' ? 'cmd+a' : 'ctrl+a';
    await this.pressKeys([selectAll, 'backspace']);
  }

  async swipe(direction: SwipeDirection, opts?: SwipeOptions): Promise<void> {
    const screen = await this.getScreenSize();
    const centerX = screen.width / 2;
    const centerY = screen.height / 2;

    const startX = opts?.startX ?? centerX;
    const startY = opts?.startY ?? centerY;

    const isHorizontal = direction === 'left' || direction === 'right';
    const defaultDistance = (isHorizontal ? screen.width : screen.height) * 0.5;
    const distance = opts?.distance ?? defaultDistance;

    let endX = startX;
    let endY = startY;
    switch (direction) {
      case 'up':    endY = startY - distance; break;
      case 'down':  endY = startY + distance; break;
      case 'left':  endX = startX - distance; break;
      case 'right': endX = startX + distance; break;
    }

    await this.call('device.io.swipe', {
      x1: Math.round(startX),
      y1: Math.round(startY),
      x2: Math.round(endX),
      y2: Math.round(endY),
      ...(opts?.duration !== undefined && { duration: opts.duration }),
    });
  }

  async gesture(gestures: GestureSequence): Promise<void> {
    await this.call('device.io.gesture', { actions: gestures.pointers });
  }

  async pressButton(button: HardwareButton): Promise<void> {
    await this.call('device.io.button', { button });
  }

  // ─── Screen ─────────────────────────────────────────────────

  async screenshot(opts?: ScreenshotOptions): Promise<Buffer> {
    const result = await this.call<MobileNextScreenshotResponse>('device.screenshot', {
      ...(opts?.format && { format: opts.format }),
      ...(opts?.quality !== undefined && { quality: opts.quality }),
    });
    let b64 = result.data;
    const commaIdx = b64.indexOf(',');
    if (commaIdx !== -1) {
      b64 = b64.slice(commaIdx + 1);
    }
    return Buffer.from(b64, 'base64');
  }

  async getScreenSize(): Promise<ScreenSize> {
    const result = await this.call<MobileNextDeviceInfoResponse>('device.info');
    const info = result.device;
    return info.screenSize ?? { width: info.screenWidth ?? 0, height: info.screenHeight ?? 0, scale: 1 };
  }

  async getOrientation(): Promise<Orientation> {
    const result = await this.call<MobileNextOrientationResponse>('device.io.orientation.get');
    return result.orientation === 'landscape' ? 'landscape' : 'portrait';
  }

  async setOrientation(orientation: Orientation): Promise<void> {
    await this.call('device.io.orientation.set', { orientation });
  }

  // ─── Recording ──────────────────────────────────────────────

  async startRecording(opts: RecordingOptions): Promise<void> {
    await this.call('device.screenrecord', {
      output: opts.output,
      ...(opts.timeLimit !== undefined && { timeLimit: opts.timeLimit }),
    });
  }

  async stopRecording(): Promise<RecordingResult> {
    const result = await this.call<RecordingResult>('device.screenrecord.stop');
    if (result.url) {
      debug('download screen recording from %s', result.url.split('?')[0]);
    }
    return result;
  }

  // ─── Apps ───────────────────────────────────────────────────

  async launchApp(bundleId: string, opts?: LaunchOptions): Promise<void> {
    await this.call('device.apps.launch', {
      bundleId,
      ...(opts?.locales && { locales: opts.locales }),
      ...(opts?.activity && { activity: opts.activity }),
    });
  }

  async terminateApp(bundleId: string): Promise<void> {
    await this.call('device.apps.terminate', { bundleId });
  }

  async listApps(): Promise<AppInfo[]> {
    // iOS returns a flat array, Android returns { apps: [...] }.
    const result = await this.call<MobileNextAppEntry[] | { apps: MobileNextAppEntry[] }>('device.apps.list');
    const apps = Array.isArray(result) ? result : result.apps;
    return apps.map((app) => ({
      bundleId: app.bundleId ?? app.packageName ?? '',
      name: app.appName,
      version: app.version,
    }));
  }

  async getForegroundApp(): Promise<AppInfo> {
    const result = await this.call<MobileNextAppEntry>('device.apps.foreground');
    return {
      bundleId: result.bundleId ?? result.packageName ?? '',
      name: result.appName,
      version: result.version,
    };
  }

  async installApp(filePath: string): Promise<void> {
    assertValidZipFile(filePath);
    const fileInfo = await stat(filePath);
    const filename = sanitizeFilename(basename(filePath));

    debug('creating upload for %s (%d bytes)', filename, fileInfo.size);
    const upload = await this.call<UploadCreateResponse>('uploads.create', {
      filename,
      filesize: fileInfo.size,
    });

    debug('uploading %s to S3 (uploadId=%s)', filename, upload.uploadId);
    let uploadedBytes = 0;
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        uploadedBytes += chunk.length;
        callback(null, chunk);
      },
    });
    const body = createReadStream(filePath).pipe(counter);

    const totalMB = (fileInfo.size / 1024 / 1024).toFixed(1);
    const progressTimer = setInterval(() => {
      const uploadedMB = (uploadedBytes / 1024 / 1024).toFixed(1);
      const percent = Math.round((uploadedBytes / fileInfo.size) * 100);
      debug('still uploading %s: %s / %s MB (%d%%)', filename, uploadedMB, totalMB, percent);
    }, 10_000);

    let response: Response;
    try {
      response = await fetch(upload.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(fileInfo.size),
        },
        body,
        duplex: 'half',
      } as RequestInit);
    } finally {
      clearInterval(progressTimer);
    }
    if (!response.ok) {
      throw new Error(`Upload failed with status ${response.status}`);
    }
    debug('upload complete, installing app (uploadId=%s)', upload.uploadId);

    await this.call('device.apps.install', { uploadId: upload.uploadId });
    debug('app installed successfully: %s', filename);
  }

  async uninstallApp(bundleId: string): Promise<void> {
    await this.call('device.apps.uninstall', { bundleId });
  }

  // ─── Device ─────────────────────────────────────────────────

  async listDevices(opts?: ListDevicesOptions): Promise<DeviceInfo[]> {
    const result = await this.call<MobileNextDevicesResponse>('device.list');
    let devices = result.data.devices;

    if (opts?.platform) {
      devices = devices.filter((d) => d.platform === opts.platform);
    }
    if (opts?.state) {
      devices = devices.filter((d) => d.state === opts.state);
    }

    return devices
      .filter((d) => toPlatform(d.platform) !== undefined)
      .map((d) => ({
        id: d.id ?? d.udid ?? '',
        name: d.name,
        platform: toPlatform(d.platform)!,
        type: toDeviceType(d.type),
        state: toDeviceState(d.state),
        model: d.model,
        osVersion: d.version,
      }));
  }

  async openUrl(url: string): Promise<void> {
    await this.call('device.url', { url });
  }

  // ─── Allocation ─────────────────────────────────────────────

  // takenDeviceIds is unused: the fleet allocates a fresh device server-side per call and the
  // filter DSL has no "exclude id" operator, so a local taken-set is both redundant and
  // inexpressible here. signal is threaded through so a pool shutdown or allocation timeout
  // cancels an in-flight provisioning wait.
  async allocate(
    criteria: AllocationCriteria,
    _takenDeviceIds: ReadonlySet<string>,
    signal?: AbortSignal,
  ): Promise<AllocatedDevice> {
    const filters = buildFilters(criteria);
    const sessionId = await this.getFleetSession();
    debug('allocating device (session=%s, filters=%o)', sessionId, filters);

    const device = await this.fleetClient.allocateDevice(sessionId, filters, signal);
    const serial = device.info.serial;
    if (!serial) {
      throw new Error(`Device allocation ${device.id} became in_use without a serial`);
    }
    this.fleetSessionBySerial.set(serial, sessionId);
    debug('allocated device %s (allocation=%s, platform=%s)', serial, device.id, device.info.platform);

    return {
      deviceId: serial,
      platform: device.info.platform === 'android' ? 'android' : ('ios' as Platform),
      driver: 'mobilenext',
      model: device.info.name,
      osVersion: device.info.osVersion,
      type: toDeviceType(device.info.type ?? ''),
    };
  }

  async release(deviceId: string): Promise<void> {
    const sessionId = this.fleetSessionBySerial.get(deviceId);
    if (!sessionId) {
      return;
    }
    debug('releasing device %s (session=%s)', deviceId, sessionId);
    await this.fleetClient.releaseDevice(sessionId, deviceId);
    this.fleetSessionBySerial.delete(deviceId);
    debug('released device %s', deviceId);
  }

  // Cache the promise, not the id, so concurrent first allocations share a single createSession.
  // On failure, clear the cache so a later allocate() can retry instead of inheriting the rejection.
  private getFleetSession(): Promise<string> {
    if (!this.fleetSessionPromise) {
      this.fleetSessionPromise = this.fleetClient.createSession().catch((err: unknown) => {
        this.fleetSessionPromise = null;
        throw err;
      });
    }
    return this.fleetSessionPromise;
  }

  // ─── Reporting ──────────────────────────────────────────────

  configureReporting(): { reporters: ReporterEntry[]; captureGitInfo?: boolean } | undefined {
    if (this.options.testResult?.uploadReport === 'off') {
      return undefined;
    }
    const jsonResultsPath = join(os.tmpdir(), `mobilewright-results-${randomUUID()}.json`);
    const uploadReporterPath = _require.resolve('./reporter.js');

    return {
      captureGitInfo: true,
      reporters: [
        ['json', { outputFile: jsonResultsPath }],
        [uploadReporterPath, {
          apiKey: this.options.apiKey ?? '',
          jsonResultsPath,
          testResult: this.options.testResult ?? {},
          uploadTimeout: this.options.uploadTimeout,
        }],
      ],
    };
  }

  // ─── Helpers ────────────────────────────────────────────────

  private call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const session = this.requireSession();
    return session.rpc.call<T>(method, { deviceId: session.deviceId, ...params });
  }

  private requireSession() {
    if (!this.session) {
      throw new Error('No active session. Call connect() first.');
    }
    return this.session;
  }
}
