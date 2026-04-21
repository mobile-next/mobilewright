import createDebug from 'debug';
import type {
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
  ScreenSize,
  ScreenshotOptions,
  Session,
  SwipeDirection,
  SwipeOptions,
  ViewNode,
} from '@mobilewright/protocol';
import { RpcClient } from './rpc-client.js';

export const DEFAULT_URL = 'wss://api.mobilenexthq.com/ws';

// ─── RPC response types ───────────────────────────────────────

interface MobileUseElement {
  type: string;
  label?: string;
  name?: string;
  value?: string;
  identifier?: string;
  rect?: { x: number; y: number; width: number; height: number };
  children?: MobileUseElement[];
  visible?: boolean;
  enabled?: boolean;
}

interface MobileUseAppEntry {
  packageName?: string;
  bundleId?: string;
  appName?: string;
  version?: string;
}

interface MobileUseDeviceInfoResponse {
  device: {
    platform: string;
    screenSize?: { width: number; height: number; scale: number };
    screenWidth?: number;
    screenHeight?: number;
    [k: string]: unknown;
  };
}

interface MobileUseDeviceEntry {
  id?: string;
  udid?: string;
  name: string;
  platform: string;
  type: string;
  state: string;
  model?: string;
  version?: string;
}

interface MobileUseScreenshotResponse {
  data: string;
}

interface MobileUseOrientationResponse {
  orientation: string;
}

interface MobileUseUIDumpResponse {
  elements: MobileUseElement[];
}

interface MobileUseDevicesResponse {
  status: string;
  data: { devices: MobileUseDeviceEntry[] };
}

export interface MobileUseDriverOptions {
  region?: string;
  apiKey?: string;
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

function elementToViewNode(el: MobileUseElement): ViewNode {
  const bounds = el.rect ?? { x: 0, y: 0, width: 0, height: 0 };
  return {
    type: el.type ?? 'Unknown',
    label: el.label || undefined,
    identifier: el.identifier || el.name || undefined,
    value: el.value || undefined,
    text: el.label || undefined,
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

interface FleetAllocateResponse {
  sessionId: string;
  device: {
    id: string;
    name: string;
    platform: string;
    status: string;
    model: string;
  };
}

type DeviceFilter =
  | { attribute: 'platform'; operator: 'EQUALS'; value: 'ios' | 'android' }
  | { attribute: 'type'; operator: 'EQUALS'; value: 'real' }
  | { attribute: 'name'; operator: 'EQUALS' | 'STARTS_WITH' | 'CONTAINS'; value: string }
  | { attribute: 'version'; operator: 'EQUALS' | 'GREATER_THAN' | 'GREATER_THAN_OR_EQUALS' | 'LESS_THAN' | 'LESS_THAN_OR_EQUALS'; value: string };

const debug = createDebug('mw:driver-mobile-use');

export class MobileUseDriver implements MobilewrightDriver {
  private session: { deviceId: string; platform: Platform; rpc: RpcClient } | null = null;
  private readonly options: MobileUseDriverOptions;

  constructor(options: MobileUseDriverOptions = {}) {
    this.options = options;
  }

  // ─── Connection ──────────────────────────────────────────────

  async connect(config: ConnectionConfig): Promise<Session> {
    const baseUrl = config.url ?? DEFAULT_URL;
    const url = this.options.apiKey
      ? appendQueryParam(baseUrl, 'token', this.options.apiKey)
      : baseUrl;
    debug('connecting to %s', baseUrl);
    const rpc = new RpcClient(url, config.timeout);
    await rpc.connect();
    debug('websocket connected');

    const platform = config.platform;
    const filters = this.buildFilters(config);
    debug('allocating device with filters %o', filters);
    const result = await rpc.call<FleetAllocateResponse>('fleet.allocate', { filters });
    debug('allocated device %s (session=%s, model=%s)', result.device.id, result.sessionId, result.device.model);
    const deviceId = result.device.id;

    this.session = { deviceId, platform, rpc };
    return { deviceId, platform };
  }

  async disconnect(): Promise<void> {
    const session = this.requireSession();
    debug('releasing device %s', session.deviceId);
    await session.rpc.call('fleet.release', { deviceId: session.deviceId });
    await session.rpc.disconnect();
    this.session = null;
    debug('disconnected');
  }

  private buildFilters(config: ConnectionConfig): DeviceFilter[] {
    const filters: DeviceFilter[] = [
      { attribute: 'platform', operator: 'EQUALS', value: config.platform },
    ];

    if (config.deviceName) {
      const name = typeof config.deviceName === 'string'
        ? config.deviceName
        : config.deviceName.source;
      filters.push({ attribute: 'name', operator: 'CONTAINS', value: name });
    }

    if (config.osVersion) {
      filters.push({ attribute: 'version', operator: 'EQUALS', value: config.osVersion });
    }

    return filters;
  }

  // ─── UI hierarchy ───────────────────────────────────────────

  async getViewHierarchy(): Promise<ViewNode[]> {
    const result = await this.call<MobileUseUIDumpResponse>('device.dump.ui');
    return result.elements.map(elementToViewNode);
  }

  // ─── Input ──────────────────────────────────────────────────

  async tap(x: number, y: number): Promise<void> {
    await this.call('device.io.tap', { x, y });
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
    await this.call('device.io.gesture', { pointers: gestures.pointers });
  }

  async pressButton(button: HardwareButton): Promise<void> {
    await this.call('device.io.button', { button });
  }

  // ─── Screen ─────────────────────────────────────────────────

  async screenshot(opts?: ScreenshotOptions): Promise<Buffer> {
    const result = await this.call<MobileUseScreenshotResponse>('device.screenshot', {
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
    const result = await this.call<MobileUseDeviceInfoResponse>('device.info');
    const info = result.device;
    return info.screenSize ?? { width: info.screenWidth ?? 0, height: info.screenHeight ?? 0, scale: 1 };
  }

  async getOrientation(): Promise<Orientation> {
    const result = await this.call<MobileUseOrientationResponse>('device.io.orientation.get');
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
    return this.call<RecordingResult>('device.screenrecord.stop');
  }

  // ─── Apps ───────────────────────────────────────────────────

  async launchApp(bundleId: string, opts?: LaunchOptions): Promise<void> {
    await this.call('device.apps.launch', {
      bundleId,
      ...(opts?.locale && { locale: opts.locale }),
    });
  }

  async terminateApp(bundleId: string): Promise<void> {
    await this.call('device.apps.terminate', { bundleId });
  }

  async listApps(): Promise<AppInfo[]> {
    // iOS returns a flat array, Android returns { apps: [...] }.
    const result = await this.call<MobileUseAppEntry[] | { apps: MobileUseAppEntry[] }>('device.apps.list');
    const apps = Array.isArray(result) ? result : result.apps;
    return apps.map((app) => ({
      bundleId: app.bundleId ?? app.packageName ?? '',
      name: app.appName,
      version: app.version,
    }));
  }

  async getForegroundApp(): Promise<AppInfo> {
    const result = await this.call<MobileUseAppEntry>('device.apps.foreground');
    return {
      bundleId: result.bundleId ?? result.packageName ?? '',
      name: result.appName,
      version: result.version,
    };
  }

  async installApp(path: string): Promise<void> {
    await this.call('device.apps.install', { path });
  }

  async uninstallApp(bundleId: string): Promise<void> {
    await this.call('device.apps.uninstall', { bundleId });
  }

  // ─── Device ─────────────────────────────────────────────────

  async listDevices(opts?: ListDevicesOptions): Promise<DeviceInfo[]> {
    const result = await this.call<MobileUseDevicesResponse>('device.list');
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
