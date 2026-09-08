import type {
  AppInfo,
  ConnectionConfig,
  DeviceInfo,
  DeviceSettings,
  DeviceType,
  Geolocation,
  GestureSequence,
  HardwareButton,
  LaunchOptions,
  ListDevicesOptions,
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
  WebViewInfo,
} from './types.js';

/**
 * Thrown by `MobilewrightDriver.allocate` when no device is currently
 * available but one may become available later (e.g. all matching devices
 * are already taken). The device pool treats this as a temporary condition
 * and re-queues the waiter rather than rejecting it outright.
 */
export class NoDeviceAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoDeviceAvailableError';
  }
}

export interface AllocationCriteria {
  platform?: Platform;
  /** Regex source (`RegExp.prototype.source`) matched against device name. */
  deviceNamePattern?: string;
  deviceId?: string;
  /** Restrict to simulators, emulators, or real devices. */
  deviceType?: DeviceType;
  /** OS version constraint expression, e.g. "17", "26.0" or ">=17 <19". See `parseOsVersion`. */
  osVersion?: string;
}

export interface AllocatedDevice {
  deviceId: string;
  platform: Platform;
  /** Free-form label identifying which driver produced this allocation (e.g. "mobilecli"). Informational only. */
  driver?: string;
  model?: string;
  osVersion?: string;
  type?: DeviceType;
}

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

/**
 * Reserves and releases devices from a pool. Implemented by the same class
 * as `MobilewrightSession` for every driver in this repo, but the device-pool
 * coordinator only ever depends on this narrower shape — it never connects
 * to or controls a device directly.
 */
export interface DeviceAllocator {
  /**
   * Reserve a device matching `criteria`. Async because it may involve a
   * network round-trip (cloud pool) or local enumeration.
   * `takenDeviceIds` excludes devices already handed to other pool slots —
   * needed by drivers that enumerate devices locally (e.g. mobilecli), since
   * cloud drivers already guarantee exclusivity per allocation call and can
   * ignore it. Throws `NoDeviceAvailableError` when nothing currently
   * matches (a temporary condition the pool will retry). Drivers should
   * honor `signal` and abort promptly, but the pool also enforces its own
   * timeout independently of signal handling and will release any device
   * returned after that timeout instead of publishing it.
   */
  allocate(
    criteria: AllocationCriteria,
    takenDeviceIds: ReadonlySet<string>,
    signal?: AbortSignal,
  ): Promise<AllocatedDevice>;
  /** Release a device back to the pool. No-op for drivers with nothing to release. */
  release(deviceId: string): Promise<void>;

  // Lifecycle (optional — drivers with nothing to prepare/release omit these)
  /** Prepare this driver for use (e.g. start a local server process) before any device-pool workers connect. Called once by the coordinator at startup. */
  prepare?(): Promise<void>;
  /** Release resources acquired by `prepare()` (e.g. kill a spawned server). Called once at coordinator shutdown. */
  dispose?(): Promise<void>;
}

/** Connects to and controls a single already-allocated device. */
export interface MobilewrightSession {
  // Connection
  /** Connect to the device described by `config` and start a session. */
  connect(config: ConnectionConfig): Promise<Session>;
  /** End the active session and release the device. */
  disconnect(): Promise<void>;

  // Device settings
  /**
   * Apply device-level settings (animations, etc.) to the connected device.
   * Optional — drivers that don't support it omit it and callers no-op.
   * Fire-and-forget: settings are not restored on disconnect.
   */
  applyDeviceSettings?(settings: DeviceSettings): Promise<void>;

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
  /** Override the GPS location reported by the device; null clears the override. */
  setGeolocation(geolocation: Geolocation | null): Promise<void>;

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
  /** List the devices available to this driver, online and offline. */
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

/** A location in a test source file. */
export interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

/** Summary of a test run, delivered at `onRunStart`. */
export interface TestRunInfo {
  /** Total number of tests scheduled in this run. */
  totalTests: number;
}

/** Identifying information about a single test, delivered at `onTestEnd`. */
export interface TestInfo {
  /** Stable test id — matches `spec.id` in Playwright's JSON report. */
  id: string;
  title: string;
  /**
   * Full title path as Playwright reports it: root suite (empty string),
   * project name, file, describe blocks, then the test title. The project
   * entry distinguishes e.g. ios/android runs of the same test.
   */
  titlePath: string[];
  location?: SourceLocation;
}

/** A single step (or nested step) within a test result. */
export interface TestStepInfo {
  title: string;
  /** Playwright step category, e.g. 'test.step', 'expect', 'hook'. */
  category: string;
  duration: number;
  error?: string;
  location?: SourceLocation;
  steps: TestStepInfo[];
}

/** Outcome of a single test attempt, delivered at `onTestEnd`. */
export interface TestResultInfo {
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  retry: number;
  duration: number;
  errors: string[];
  steps: TestStepInfo[];
}

/** Outcome of an entire test run, delivered at `onRunEnd`. */
export interface RunResultInfo {
  status: 'passed' | 'failed' | 'timedout' | 'interrupted';
  startTime: Date;
  duration: number;
  /**
   * Lazily read Playwright's JSON report for this run, when available.
   * Transitional escape hatch — prefer the event hooks; this may be removed
   * once drivers no longer need the raw report.
   */
  jsonReport?(): Promise<unknown>;
}

/**
 * Optional test-lifecycle observer implemented by a driver. Hooks are invoked
 * in the runner process (same instance that performed allocation), forwarded
 * from Playwright's reporter events by mobilewright's internal shim reporter.
 * All hooks are optional; `onRunEnd` is awaited (uploads go there).
 */
export interface TestObserver {
  onRunStart?(run: TestRunInfo): void | Promise<void>;
  onTestEnd?(test: TestInfo, result: TestResultInfo): void;
  onRunEnd?(result: RunResultInfo): void | Promise<void>;
}

/**
 * The full driver contract: reserves devices from a pool AND controls a
 * connected one. Every driver in this repo implements both roles on one
 * class. `defineConfig({ driver })` needs both — the device-pool coordinator
 * process uses only the `DeviceAllocator` half, the connecting worker
 * process uses only the `MobilewrightSession` half, but both are constructed
 * from the same `driver` instance you configure.
 */
export type MobilewrightDriver = DeviceAllocator & MobilewrightSession & {
  /** Optional test-lifecycle observer — receives test run events (e.g. to upload results). */
  observer?: TestObserver;
};
