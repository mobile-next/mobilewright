import type {
  AppInfo,
  ConnectionConfig,
  DeviceInfo,
  GestureSequence,
  HardwareButton,
  LaunchOptions,
  ListDevicesOptions,
  MobilewrightDriver,
  Orientation,
  RecordingOptions,
  RecordingResult,
  ScreenSize,
  ScreenshotOptions,
  Session,
  SwipeDirection,
  SwipeOptions,
  ViewNode,
} from '@mobilewright/protocol';

export interface MobileUseDriverOptions {
  region?: string;
  username?: string;
  password?: string;
}

export class MobileUseDriver implements MobilewrightDriver {
  private readonly options: MobileUseDriverOptions;

  constructor(options: MobileUseDriverOptions = {}) {
    this.options = options;
  }

  // ─── Connection ──────────────────────────────────────────────

  async connect(config: ConnectionConfig): Promise<Session> {
    console.log('[mobile-use] connect', config);
    return { deviceId: config.deviceId, platform: config.platform ?? 'ios' };
  }

  async disconnect(): Promise<void> {
    console.log('[mobile-use] disconnect');
  }

  // ─── UI hierarchy ───────────────────────────────────────────

  async getViewHierarchy(): Promise<ViewNode[]> {
    console.log('[mobile-use] getViewHierarchy');
    return [];
  }

  // ─── Input ──────────────────────────────────────────────────

  async tap(x: number, y: number): Promise<void> {
    console.log('[mobile-use] tap', { x, y });
  }

  async doubleTap(x: number, y: number): Promise<void> {
    console.log('[mobile-use] doubleTap', { x, y });
  }

  async longPress(x: number, y: number, duration?: number): Promise<void> {
    console.log('[mobile-use] longPress', { x, y, duration });
  }

  async typeText(text: string): Promise<void> {
    console.log('[mobile-use] typeText', { text });
  }

  async swipe(direction: SwipeDirection, opts?: SwipeOptions): Promise<void> {
    console.log('[mobile-use] swipe', { direction, opts });
  }

  async gesture(gestures: GestureSequence): Promise<void> {
    console.log('[mobile-use] gesture', { gestures });
  }

  async pressButton(button: HardwareButton): Promise<void> {
    console.log('[mobile-use] pressButton', { button });
  }

  // ─── Screen ─────────────────────────────────────────────────

  async screenshot(opts?: ScreenshotOptions): Promise<Buffer> {
    console.log('[mobile-use] screenshot', { opts });
    return Buffer.alloc(0);
  }

  async getScreenSize(): Promise<ScreenSize> {
    console.log('[mobile-use] getScreenSize');
    return { width: 0, height: 0 };
  }

  async getOrientation(): Promise<Orientation> {
    console.log('[mobile-use] getOrientation');
    return 'portrait';
  }

  async setOrientation(orientation: Orientation): Promise<void> {
    console.log('[mobile-use] setOrientation', { orientation });
  }

  // ─── Recording ──────────────────────────────────────────────

  async startRecording(opts: RecordingOptions): Promise<void> {
    console.log('[mobile-use] startRecording', { opts });
  }

  async stopRecording(): Promise<RecordingResult> {
    console.log('[mobile-use] stopRecording');
    return { output: '' };
  }

  // ─── Apps ───────────────────────────────────────────────────

  async launchApp(bundleId: string, opts?: LaunchOptions): Promise<void> {
    console.log('[mobile-use] launchApp', { bundleId, opts });
  }

  async terminateApp(bundleId: string): Promise<void> {
    console.log('[mobile-use] terminateApp', { bundleId });
  }

  async listApps(): Promise<AppInfo[]> {
    console.log('[mobile-use] listApps');
    return [];
  }

  async getForegroundApp(): Promise<AppInfo> {
    console.log('[mobile-use] getForegroundApp');
    return { bundleId: '' };
  }

  async installApp(path: string): Promise<void> {
    console.log('[mobile-use] installApp', { path });
  }

  async uninstallApp(bundleId: string): Promise<void> {
    console.log('[mobile-use] uninstallApp', { bundleId });
  }

  // ─── Device ─────────────────────────────────────────────────

  async listDevices(opts?: ListDevicesOptions): Promise<DeviceInfo[]> {
    console.log('[mobile-use] listDevices', { opts });
    return [];
  }

  async openUrl(url: string): Promise<void> {
    console.log('[mobile-use] openUrl', { url });
  }
}
