import type {
  AppInfo,
  ConnectionConfig,
  DeviceInfo,
  GestureSequence,
  HardwareButton,
  LaunchOptions,
  ListDevicesOptions,
  Orientation,
  RecordingOptions,
  RecordingResult,
  ScreenSize,
  ScreenshotOptions,
  Session,
  SwipeDirection,
  SwipeOptions,
  ViewNode,
} from './types.js';

export interface MobilewrightDriver {
  // Connection
  connect(config: ConnectionConfig): Promise<Session>;
  disconnect(): Promise<void>;

  // UI hierarchy
  getViewHierarchy(): Promise<ViewNode[]>;

  // Input
  tap(x: number, y: number): Promise<void>;
  doubleTap(x: number, y: number): Promise<void>;
  longPress(x: number, y: number, duration?: number): Promise<void>;
  typeText(text: string): Promise<void>;
  swipe(direction: SwipeDirection, opts?: SwipeOptions): Promise<void>;
  gesture(gestures: GestureSequence): Promise<void>;
  pressButton(button: HardwareButton): Promise<void>;

  // Screen
  screenshot(opts?: ScreenshotOptions): Promise<Buffer>;
  getScreenSize(): Promise<ScreenSize>;
  getOrientation(): Promise<Orientation>;
  setOrientation(orientation: Orientation): Promise<void>;

  // Apps
  launchApp(bundleId: string, opts?: LaunchOptions): Promise<void>;
  terminateApp(bundleId: string): Promise<void>;
  listApps(): Promise<AppInfo[]>;
  getForegroundApp(): Promise<AppInfo>;
  installApp(path: string): Promise<void>;
  uninstallApp(bundleId: string): Promise<void>;

  // Device
  listDevices(opts?: ListDevicesOptions): Promise<DeviceInfo[]>;
  openUrl(url: string): Promise<void>;

  // Recording
  startRecording(opts: RecordingOptions): Promise<void>;
  stopRecording(): Promise<RecordingResult>;
}
