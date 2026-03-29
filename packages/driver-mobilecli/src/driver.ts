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

export const DEFAULT_URL = 'ws://localhost:12000/ws';

// ─── mobilecli RPC response types ─────────────────────────────

/** Element shape returned by mobilecli's device.dump.ui JSON response */
interface MobilecliElement {
  type: string;
  label?: string;
  name?: string;
  value?: string;
  identifier?: string;
  rect?: { x: number; y: number; width: number; height: number };
  children?: MobilecliElement[];
  visible?: boolean;
  enabled?: boolean;
}

interface MobilecliAppEntry {
  packageName?: string;
  bundleId?: string;
  appName?: string;
  version?: string;
}

interface MobilecliDeviceInfoResponse {
  device: {
    platform: string;
    screenSize?: { width: number; height: number };
    screenWidth?: number;
    screenHeight?: number;
    [k: string]: unknown;
  };
}

interface MobilecliDeviceEntry {
  id?: string;
  udid?: string;
  name: string;
  platform: string;
  type: string;
  state: string;
  model?: string;
  version?: string;
}

interface MobilecliScreenshotResponse {
  data: string;
}

interface MobilecliOrientationResponse {
  orientation: string;
}

interface MobilecliUIDumpResponse {
  elements: MobilecliElement[];
}

interface MobilecliDevicesListResponse {
  devices: MobilecliDeviceEntry[];
}

function elementToViewNode(el: MobilecliElement): ViewNode {
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
    raw: el as unknown as Record<string, unknown>,
  };
}

export class MobilecliDriver implements MobilewrightDriver {
  private session: { deviceId: string; platform: Platform; rpc: RpcClient } | null = null;
  private readonly serverUrl: string;

  constructor(opts?: { url?: string }) {
    this.serverUrl = opts?.url ?? DEFAULT_URL;
  }

  // ─── Connection ──────────────────────────────────────────────

  async connect(config: ConnectionConfig): Promise<Session> {
    const url = config.url ?? this.serverUrl;
    const rpc = new RpcClient(url, config.timeout);
    await rpc.connect();

    let platform: Platform;
    if (config.platform) {
      platform = config.platform;
    } else {
      const result = await rpc.call<MobilecliDeviceInfoResponse>(
        'device.info', { deviceId: config.deviceId },
      );
      const info = result.device ?? (result as unknown as { platform: string });
      platform = info.platform?.toLowerCase() === 'android' ? 'android' : 'ios';
    }

    this.session = { deviceId: config.deviceId, platform, rpc };
    return { deviceId: config.deviceId, platform };
  }

  async disconnect(): Promise<void> {
    this.requireSession().rpc.disconnect();
    this.session = null;
  }

  // ─── Element Operations ──────────────────────────────────────

  async getViewHierarchy(): Promise<ViewNode[]> {
    const result = await this.call<MobilecliUIDumpResponse>('device.dump.ui');
    return result.elements.map(elementToViewNode);
  }

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
    await this.call('device.io.swipe', {
      direction,
      ...(opts?.distance !== undefined && { distance: opts.distance }),
      ...(opts?.duration !== undefined && { duration: opts.duration }),
      ...(opts?.startX !== undefined && { startX: opts.startX }),
      ...(opts?.startY !== undefined && { startY: opts.startY }),
    });
  }

  async gesture(gestures: GestureSequence): Promise<void> {
    await this.call('device.io.gesture', { pointers: gestures.pointers });
  }

  async pressButton(button: HardwareButton): Promise<void> {
    await this.call('device.io.button', { button });
  }

  // ─── Screen Operations ───────────────────────────────────────

  async screenshot(opts?: ScreenshotOptions): Promise<Buffer> {
    const result = await this.call<MobilecliScreenshotResponse>('device.screenshot', {
      ...(opts?.format && { format: opts.format }),
      ...(opts?.quality !== undefined && { quality: opts.quality }),
    });
    let b64 = result.data;
    const commaIdx = b64.indexOf(',');
    if (commaIdx !== -1) b64 = b64.slice(commaIdx + 1);
    return Buffer.from(b64, 'base64');
  }

  async getScreenSize(): Promise<ScreenSize> {
    const result = await this.call<MobilecliDeviceInfoResponse>('device.info');
    const info = result.device;
    return info.screenSize ?? { width: info.screenWidth ?? 0, height: info.screenHeight ?? 0 };
  }

  async getOrientation(): Promise<Orientation> {
    const result = await this.call<MobilecliOrientationResponse>('device.io.orientation.get');
    return result.orientation === 'landscape' ? 'landscape' : 'portrait';
  }

  async setOrientation(orientation: Orientation): Promise<void> {
    await this.call('device.io.orientation.set', { orientation });
  }

  // ─── Recording Operations ─────────────────────────────────────

  async startRecording(opts: RecordingOptions): Promise<void> {
    await this.call('device.screenrecord', {
      output: opts.output,
      ...(opts.timeLimit && { timeLimit: opts.timeLimit }),
    });
  }

  async stopRecording(): Promise<RecordingResult> {
    return this.call<RecordingResult>('device.screenrecord.stop');
  }

  // ─── App Operations ──────────────────────────────────────────

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
    const result = await this.call<{ apps: MobilecliAppEntry[] }>('device.apps.list');
    return result.apps.map((app) => ({
      bundleId: app.bundleId ?? app.packageName ?? '',
      name: app.appName,
      version: app.version,
    }));
  }

  async getForegroundApp(): Promise<AppInfo> {
    const result = await this.call<MobilecliAppEntry>('device.apps.foreground');
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

  // ─── Device Operations ───────────────────────────────────────

  async listDevices(opts?: ListDevicesOptions): Promise<DeviceInfo[]> {
    const rpc = new RpcClient(this.serverUrl);
    await rpc.connect();
    try {
      const result = await rpc.call<MobilecliDevicesListResponse>(
        'devices.list', opts ? { ...opts } : undefined,
      );

      return result.devices.map((d) => ({
        id: d.id ?? d.udid ?? '',
        name: d.name,
        platform: d.platform as Platform,
        type: d.type as DeviceType,
        state: d.state as DeviceState,
        model: d.model,
        osVersion: d.version,
      }));
    } finally {
      await rpc.disconnect();
    }
  }

  async openUrl(url: string): Promise<void> {
    await this.call('device.url', { url });
  }

  // ─── Helpers ─────────────────────────────────────────────────

  /** RPC call on the active session, auto-injecting deviceId. */
  private call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const session = this.requireSession();
    return session.rpc.call<T>(method, { deviceId: session.deviceId, ...params });
  }

  private requireSession() {
    if (!this.session) throw new Error('No active session. Call connect() first.');
    return this.session;
  }
}
