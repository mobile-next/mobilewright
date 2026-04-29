import createDebug from 'debug';
import { execFileSync } from 'node:child_process';
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
import { resolveMobilecliBinary } from './resolve-binary.js';

export const DEFAULT_URL = 'ws://localhost:12000/ws';

// ─── mobilecli RPC response types ─────────────────────────────

/** Element shape returned by mobilecli's device.dump.ui JSON response */
interface MobilecliElement {
  type: string;
  text?: string;
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
    screenSize?: { 
      width: number; 
      height: number;
      scale: number;
    };
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

interface MobilecliDevicesResponse {
  status: string;
  data: { devices: MobilecliDeviceEntry[]; };
}

interface MobilecliAgentStatusResponse {
  status: string;
  data: {
    message?: string;
    agent?: { version: string; bundleId: string };
  };
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

function elementToViewNode(el: MobilecliElement): ViewNode {
  const bounds = el.rect ?? { x: 0, y: 0, width: 0, height: 0 };
  return {
    type: el.type ?? 'Unknown',
    label: el.label || undefined,
    identifier: el.identifier || el.name || undefined,
    value: el.value || undefined,
    text: el.text || undefined,
    isVisible: typeof el.visible === 'boolean' ? el.visible : bounds.width > 0 && bounds.height > 0,
    isEnabled: el.enabled ?? true,
    bounds,
    children: el.children?.map(elementToViewNode) ?? [],
    raw: { ...el },
  };
}

const debug = createDebug('mw:driver-mobilecli');

export class MobilecliDriver implements MobilewrightDriver {
  private session: { deviceId: string; platform: Platform; rpc: RpcClient } | null = null;
  private readonly serverUrl: string;

  constructor(opts?: { url?: string }) {
    this.serverUrl = opts?.url ?? DEFAULT_URL;
  }

  // ─── Connection ──────────────────────────────────────────────

  async connect(config: ConnectionConfig): Promise<Session> {
    const url = config.url ?? this.serverUrl;
    debug('connecting to %s', url);
    const rpc = new RpcClient(url, config.timeout);
    await rpc.connect();
    debug('websocket connected');

    const platform = config.platform;
    let device: DeviceInfo;
    if (config.deviceId) {
      device = await this.findDeviceById(config.deviceId);
    } else {
      device = await this.resolveDevice(platform, config.deviceName);
    }
    debug('resolved device %s (platform=%s, type=%s)', device.id, platform, device.type);

    this.ensureAgentInstalled(device);

    this.session = { deviceId: device.id, platform, rpc };
    return { deviceId: device.id, platform };
  }

  private async findDeviceById(deviceId: string): Promise<DeviceInfo> {
    const allDevices = await this.listDevices();
    const device = allDevices.find((d) => d.id === deviceId);
    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }
    return device;
  }

  private async resolveDevice(
    platform: Platform,
    deviceName?: RegExp | string,
  ): Promise<DeviceInfo> {
    const allDevices = await this.listDevices();
    debug('found %d devices, resolving for platform=%s deviceName=%s', allDevices.length, platform, deviceName);

    const online = allDevices.filter(
      (d) => d.platform === platform && d.state === 'online',
    );

    let candidates = online.filter(
      (d) => d.type === 'simulator' || d.type === 'emulator',
    );
    if (candidates.length === 0) {
      candidates = online;
    }

    if (deviceName) {
      const pattern = typeof deviceName === 'string' ? new RegExp(deviceName) : deviceName;
      candidates = candidates.filter((d) => pattern.test(d.name));
      if (candidates.length === 0) {
        const available = online.map((d) => d.name).join(', ');
        throw new Error(
          `No online ${platform} device matching ${deviceName} found.\n` +
            (available ? `Available: ${available}` : `No online ${platform} devices found.`),
        );
      }
    }

    if (candidates.length === 0) {
      throw new Error(
        `No online ${platform} devices found.\n\n` +
          (platform === 'ios'
            ? `Start a simulator in Xcode, or boot one with:\n  xcrun simctl boot "<simulator name>"`
            : `Start an emulator in Android Studio, or boot one with:\n  emulator -avd <avd_name>`),
      );
    }

    return candidates[0];
  }

  private ensureAgentInstalled(device: DeviceInfo): void {
    const binary = resolveMobilecliBinary();
    debug('running: %s agent status --device %s', binary, device.id);
    const statusOutput = execFileSync(binary, ['agent', 'status', '--device', device.id], { encoding: 'utf8' });
    debug('agent status output: %s', statusOutput.trim());
    const statusResponse = JSON.parse(statusOutput) as MobilecliAgentStatusResponse;
    if (statusResponse.status === 'ok') {
      return;
    }
    if (device.type === 'simulator' || device.type === 'emulator') {
      debug('agent not installed on %s %s, installing automatically', device.type, device.id);
      debug('running: %s agent install --device %s --verbose', binary, device.id);
      const installOutput = execFileSync(binary, ['agent', 'install', '--device', device.id, '--verbose'], { encoding: 'utf8' });
      debug('agent install output: %s', installOutput.trim());
      return;
    }
    throw new Error(`agent not installed, run \`npx mobilewright install --device ${device.id}\` to get started`);
  }

  async disconnect(): Promise<void> {
    await this.requireSession().rpc.disconnect();
    this.session = null;
  }

  // ─── Element Operations ──────────────────────────────────────

  async getViewHierarchy(): Promise<ViewNode[]> {
    const result = await this.call<MobilecliUIDumpResponse>('device.dump.ui');
    return result.elements.map(elementToViewNode);
  }

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

  // ─── Screen Operations ───────────────────────────────────────

  async screenshot(opts?: ScreenshotOptions): Promise<Buffer> {
    const result = await this.call<MobilecliScreenshotResponse>('device.screenshot', {
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
    const result = await this.call<MobilecliDeviceInfoResponse>('device.info');
    const info = result.device;
    return info.screenSize ?? { width: 0, height: 0, scale: 1 };
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
      ...(opts.timeLimit !== undefined && { timeLimit: opts.timeLimit }),
    });
  }

  async stopRecording(): Promise<RecordingResult> {
    return this.call<RecordingResult>('device.screenrecord.stop');
  }

  // ─── App Operations ──────────────────────────────────────────

  async launchApp(bundleId: string, opts?: LaunchOptions): Promise<void> {
    await this.call('device.apps.launch', {
      bundleId,
      ...(opts?.locales && { locales: opts.locales }),
    });
  }

  async terminateApp(bundleId: string): Promise<void> {
    await this.call('device.apps.terminate', { bundleId });
  }

  async listApps(): Promise<AppInfo[]> {
    // iOS returns a flat array, Android returns { apps: [...] }. Support both
    // until the Android mobilecli response is aligned.
    const result = await this.call<MobilecliAppEntry[] | { apps: MobilecliAppEntry[] }>('device.apps.list');
    const apps = Array.isArray(result) ? result : result.apps;

    return apps.map((app) => ({
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
    const binary = resolveMobilecliBinary();
    const output = execFileSync(binary, ['devices'], { encoding: 'utf8' });
    const response = JSON.parse(output) as MobilecliDevicesResponse;
    let devices = response.data.devices;

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
