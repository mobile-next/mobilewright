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
  WebViewInfo,
} from './types.js';

export interface WebViewSession {
  /** Evaluate a JavaScript expression in the webview and return its result. */
  evaluate<T = unknown>(expr: string): Promise<T>;
  /** Navigate the webview to the given URL. */
  goto(url: string): Promise<void>;
  /** Navigate back one entry in the webview's history. */
  goBack(): Promise<void>;
  /** Navigate forward one entry in the webview's history. */
  goForward(): Promise<void>;
  /** Return the webview's current URL. */
  url(): Promise<string>;
  /** Return the webview's current document title. */
  title(): Promise<string>;
  /** Reload the webview's current page. */
  reload(): Promise<void>;
  /** Wait until the webview reaches the given load state (default 'load'). */
  waitForLoadState(state?: 'load' | 'domcontentloaded'): Promise<void>;
  /** Detach from the webview and release its session. */
  close(): Promise<void>;
}

export interface WebViewBridge {
  /** List the webviews currently available on the device. */
  listWebViews(): Promise<WebViewInfo[]>;
  /** Attach to the webview with the given id and return a session for driving it. */
  attachWebView(id: string): Promise<WebViewSession>;
}

export interface MobilewrightDriver {
  // Connection
  /** Connect to the device described by `config` and start a session. */
  connect(config: ConnectionConfig): Promise<Session>;
  /** End the active session and release the device. */
  disconnect(): Promise<void>;

  // UI hierarchy
  /** Fetch the current on-screen view hierarchy as a forest of nodes. */
  getViewHierarchy(): Promise<ViewNode[]>;

  // Input
  /** Tap once at the given screen coordinates. */
  tap(x: number, y: number): Promise<void>;
  /** Double-tap at the given screen coordinates. */
  doubleTap(x: number, y: number): Promise<void>;
  /** Press and hold at the given coordinates for `duration` ms (driver default if omitted). */
  longPress(x: number, y: number, duration?: number): Promise<void>;
  /** Type the given text into the currently-focused field. */
  typeText(text: string): Promise<void>;
  /** Press one or more key combinations in order, e.g. ["ctrl+a", "backspace"]. */
  pressKeys(keys: string[]): Promise<void>;
  /** Clear the currently-focused text field, using the platform's select-all chord. */
  clearText(): Promise<void>;
  /** Swipe in the given direction, optionally from a start point and with extra options. */
  swipe(direction: SwipeDirection, opts?: SwipeOptions): Promise<void>;
  /** Perform a custom multi-touch gesture sequence. */
  gesture(gestures: GestureSequence): Promise<void>;
  /** Press a hardware button (e.g. home, back, volume). */
  pressButton(button: HardwareButton): Promise<void>;

  // Screen
  /** Capture a screenshot of the device screen as a PNG buffer. */
  screenshot(opts?: ScreenshotOptions): Promise<Buffer>;
  /** Return the device screen size in points. */
  getScreenSize(): Promise<ScreenSize>;
  /** Return the device's current orientation. */
  getOrientation(): Promise<Orientation>;
  /** Rotate the device to the given orientation. */
  setOrientation(orientation: Orientation): Promise<void>;

  // Apps
  /** Launch the app with the given bundle id, optionally with launch options. */
  launchApp(bundleId: string, opts?: LaunchOptions): Promise<void>;
  /** Terminate the running app with the given bundle id. */
  terminateApp(bundleId: string): Promise<void>;
  /** List the apps installed on the device. */
  listApps(): Promise<AppInfo[]>;
  /** Return the app currently in the foreground. */
  getForegroundApp(): Promise<AppInfo>;
  /** Install the app package located at the given path. */
  installApp(path: string): Promise<void>;
  /** Uninstall the app with the given bundle id. */
  uninstallApp(bundleId: string): Promise<void>;

  // Device
  /** List the devices available to this driver. */
  listDevices(opts?: ListDevicesOptions): Promise<DeviceInfo[]>;
  /** Open the given URL on the device (deep link or web URL). */
  openUrl(url: string): Promise<void>;

  // Recording
  /** Start screen recording with the given options. */
  startRecording(opts: RecordingOptions): Promise<void>;
  /** Stop screen recording and return the recording result. */
  stopRecording(): Promise<RecordingResult>;

  // WebView (optional — drivers that don't support it omit this)
  /** Bridge for inspecting and driving webviews; absent on drivers without webview support. */
  webViewBridge?: WebViewBridge;
}
