import { spawn } from 'node:child_process';
import createDebug from 'debug';
import type {
  AppInfo,
  ConnectionConfig,
  DeviceInfo,
  DeviceSettings,
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
import { RestClient, type Region, type DeviceOs } from './rest-client.js';
import { DeviceControlSocket } from './device-control-socket.js';
import { CompanionSocket } from './companion-socket.js';
import { WdaClient } from './wda-client.js';

const debug = createDebug('mw:driver-saucelabs');

const DEFAULT_WDA_URL =
  process.env['SAUCE_IOS_WDA_URL'] ??
  'https://github.com/appium/WebDriverAgent/releases/download/v15.0.0/WebDriverAgentRunner-Runner.zip';

/** Prints the Sauce Labs live-view URL to the console on session creation when set to '1'. */
const SHOW_LIVE_VIEW = process.env['SAUCE_LIVE_VIEW'] === '1';

export interface SauceLabsDriverOptions {
  /** Falls back to SAUCE_USERNAME env var when omitted. */
  username?: string;
  /** Falls back to SAUCE_ACCESS_KEY env var when omitted. */
  accessKey?: string;
  region?: Region;
  /** ms to wait for session ACTIVE, default 300_000 */
  allocationTimeout?: number;
  /** ISO-8601 duration e.g. 'PT1H' */
  sessionDuration?: string;
  /** iOS only: custom WDA fork bundle ID passed to launchWebDriverAgent. Omit to use the Sauce Labs default WDA. */
  iosWdaBundleId?: string;
  /**
   * iOS only: overrides the WDA runner zip used for iOS sessions.
   * Accepts a `storage:<id>` ref for a file already uploaded to Sauce Storage,
   * or an `https://` URL that the driver will download and upload automatically.
   * When omitted the driver uses the URL from the `SAUCE_IOS_WDA_URL` env var,
   * falling back to the pinned default WDA release.
   */
  iosWdaStorageRef?: string;
}

// ─── Hardware button → socket key mapping ────────────────────────────────────

const BUTTON_KEY: Partial<Record<HardwareButton, string>> = {
  HOME: 'Sauce_Home_Key',
  BACK: 'Sauce_Back_Key',
  APP_SWITCH: 'Sauce_Menu_Key',
};

// Android key events via shell
const BUTTON_KEYEVENT: Partial<Record<HardwareButton, number>> = {
  POWER: 26,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  LOCK: 26,
  ENTER: 66,
  DPAD_UP: 19,
  DPAD_DOWN: 20,
  DPAD_LEFT: 21,
  DPAD_RIGHT: 22,
  DPAD_CENTER: 23,
};

// WDA button names for iOS
const BUTTON_WDA: Partial<Record<HardwareButton, string>> = {
  VOLUME_UP: 'volumeUp',
  VOLUME_DOWN: 'volumeDown',
  POWER: 'power',
  LOCK: 'power',
};

// ─── Internal session state ───────────────────────────────────────────────────

interface ActiveSession {
  sauceSessionId: string;
  /** True if this driver created the Sauce Labs session (and must delete it on disconnect);
   * false if it only attached to a session created elsewhere (e.g. by the device pool allocator). */
  ownsSession: boolean;
  platform: Platform;
  deviceId: string;
  resolutionWidth: number;
  resolutionHeight: number;
  pixelsPerPoint: number;
  currentOrientation: 'PORTRAIT' | 'LANDSCAPE';
  ioSocket: DeviceControlSocket;
  companionSocket: CompanionSocket;
  wdaClient: WdaClient | null;
}

/** Polls a Sauce Labs session every 5 seconds until it is ACTIVE with control links, or throws
 * on timeout or terminal error. */
export async function waitForActiveSession(
  rest: RestClient,
  sessionId: string,
  timeout: number,
  opts: { skipInitialDelay?: boolean } = {},
): Promise<import('./rest-client.js').Session> {
  const pollInterval = 5_000;
  const deadline = Date.now() + timeout;

  // Device allocation takes at least several seconds — sleep before the first poll,
  // unless the caller already knows the session is likely active (e.g. attaching to
  // a session the pool already waited on).
  if (!opts.skipInitialDelay) {
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  while (Date.now() < deadline) {
    const s = await rest.getSession(sessionId);
    const hasLinks = !!(s.links?.ioWebsocketUrl && s.links?.eventsWebsocketUrl);
    debug('polling session %s state=%s links=%s', sessionId, s.state, hasLinks);
    if (s.state === 'ACTIVE' && hasLinks) return s;
    if (s.state === 'ERRORED' || s.state === 'CLOSED') {
      throw new Error(`Session ${sessionId} reached terminal state: ${s.state}`);
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }
  throw new Error(`Timed out waiting for session ${sessionId} to become ACTIVE`);
}

function resolveCredentials(options: SauceLabsDriverOptions): { username: string; accessKey: string } {
  const username = options.username ?? process.env['SAUCE_USERNAME'];
  const accessKey = options.accessKey ?? process.env['SAUCE_ACCESS_KEY'];
  if (!username) throw new Error('Sauce Labs username is required. Set options.username or SAUCE_USERNAME env var.');
  if (!accessKey) throw new Error('Sauce Labs access key is required. Set options.accessKey or SAUCE_ACCESS_KEY env var.');
  return { username, accessKey };
}

// ─── Helper parsers ───────────────────────────────────────────────────────────

function parseOrientation(value: string | undefined): 'PORTRAIT' | 'LANDSCAPE' {
  return value?.toUpperCase() === 'LANDSCAPE' ? 'LANDSCAPE' : 'PORTRAIT';
}

function sauceOrientationToProtocol(o: 'PORTRAIT' | 'LANDSCAPE'): Orientation {
  return o === 'LANDSCAPE' ? 'landscape' : 'portrait';
}

function protocolOrientationToSauce(o: Orientation): 'PORTRAIT' | 'LANDSCAPE' {
  return o === 'landscape' ? 'LANDSCAPE' : 'PORTRAIT';
}

// Parse Android `pm list packages -3` output into AppInfo[]
function parsePmListPackages(stdout: string): AppInfo[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('package:'))
    .map((line) => ({ bundleId: line.slice('package:'.length).trim() }));
}

// Parse foreground app from `dumpsys window windows | grep mCurrentFocus` output.
// Format: mCurrentFocus=Window{... <package>/<activity>}
// Fallback: `dumpsys activity activities | grep mResumedActivity`
// Format: mResumedActivity=ActivityRecord{... <package>/<activity>}
function parseForegroundApp(stdout: string): AppInfo {
  for (const line of stdout.split('\n')) {
    // mCurrentFocus format (window manager, reliable across all Android versions)
    const winMatch = line.match(/mCurrentFocus=Window\{[^}]+ ([^/\s}]+)\//);
    if (winMatch) return { bundleId: winMatch[1] };
    // mResumedActivity format (activity manager)
    const actMatch = line.match(/mResumedActivity[=: ]+ActivityRecord\{[^ ]+ [^ ]+ ([^/]+)\//);
    if (actMatch) return { bundleId: actMatch[1] };
  }
  return { bundleId: '' };
}

// ─── Driver ───────────────────────────────────────────────────────────────────

/** Mobilewright driver that controls real devices via the Sauce Labs Real Device Cloud API. */
export class SauceLabsDriver implements MobilewrightDriver {
  private session: ActiveSession | null = null;
  private readonly options: SauceLabsDriverOptions;
  private readonly username: string;
  private readonly accessKey: string;
  private recordingOptions: RecordingOptions | null = null;
  private lastInstalledStorageRef: string | null = null;

  constructor(options: SauceLabsDriverOptions = {}) {
    this.options = options;
    const { username, accessKey } = resolveCredentials(options);
    this.username = username;
    this.accessKey = accessKey;
  }

  // ─── Connection ─────────────────────────────────────────────────────────────

  /**
   * Reserves a device on Sauce Labs and waits for the session to become ACTIVE, without
   * opening any device control sockets. Intended for the device pool allocator, which only
   * needs to resolve and hold a device — the returned sessionId is later passed to connect()
   * via `ConnectionConfig.sessionId` so the actual test worker can attach to the same session
   * instead of allocating a second device. Pair with `releaseSession()`.
   */
  static async allocateSession(
    options: SauceLabsDriverOptions,
    config: Pick<ConnectionConfig, 'platform' | 'deviceName'>,
  ): Promise<{ sessionId: string; deviceId: string }> {
    const { username, accessKey } = resolveCredentials(options);
    const rest = new RestClient(username, accessKey, options.region ?? 'us-west-1');
    const os: DeviceOs = config.platform === 'android' ? 'ANDROID' : 'IOS';

    debug('allocateSession platform=%s', config.platform);
    const creation = await rest.createSession({
      device: {
        os,
        ...(config.deviceName
          ? { deviceName: typeof config.deviceName === 'string' ? config.deviceName : config.deviceName.source }
          : {}),
      },
      ...(options.sessionDuration
        ? { configuration: { sessionDuration: options.sessionDuration } }
        : {}),
    });
    debug('allocateSession created id=%s state=%s', creation.id, creation.state);

    const active = await waitForActiveSession(rest, creation.id, options.allocationTimeout ?? 300_000);
    const deviceId = active.device?.descriptor ?? creation.id;
    debug('allocateSession ACTIVE id=%s deviceId=%s', creation.id, deviceId);
    return { sessionId: creation.id, deviceId };
  }

  /** Deletes a session previously created via `allocateSession()`, releasing the device back to Sauce Labs. */
  static async releaseSession(options: SauceLabsDriverOptions, sessionId: string): Promise<void> {
    const { username, accessKey } = resolveCredentials(options);
    const rest = new RestClient(username, accessKey, options.region ?? 'us-west-1');
    await rest.deleteSession(sessionId);
  }

  /**
   * Opens the device control and companion WebSocket channels for a Sauce Labs session.
   * Creates a new session unless `config.sessionId` is given, in which case it attaches to
   * an already-active session (e.g. one created via `allocateSession()`) instead of
   * allocating a second device.
   */
  async connect(config: ConnectionConfig): Promise<Session> {
    const rest = this.makeRest();

    const platform = config.platform;
    const os: DeviceOs = platform === 'android' ? 'ANDROID' : 'IOS';

    let sauceSessionId: string;
    const ownsSession = !config.sessionId;
    if (config.sessionId) {
      debug('attaching to existing session %s', config.sessionId);
      sauceSessionId = config.sessionId;
    } else {
      debug('creating session platform=%s', platform);
      const creation = await rest.createSession({
        device: {
          os,
          ...(config.deviceName
            ? { deviceName: typeof config.deviceName === 'string' ? config.deviceName : config.deviceName.source }
            : {}),
        },
        ...(this.options.sessionDuration
          ? { configuration: { sessionDuration: this.options.sessionDuration } }
          : {}),
      });
      debug('session created id=%s state=%s', creation.id, creation.state);
      sauceSessionId = creation.id;
    }

    // Everything below can fail before this.session is assigned, at which point disconnect()
    // has nothing to clean up — so any failure in this block must release whatever we created
    // (owned session, connected sockets) directly instead of leaking it.
    let ioSocket: DeviceControlSocket | undefined;
    let companionSocket: CompanionSocket | undefined;
    try {
      // Poll until ACTIVE. Attached sessions were already waited on by the allocator, so skip
      // the unconditional pre-poll delay in that case.
      const sauceSession = await waitForActiveSession(
        rest,
        sauceSessionId,
        this.options.allocationTimeout ?? 300_000,
        { skipInitialDelay: !ownsSession },
      );
      debug('session ACTIVE, descriptor=%s', sauceSession.device?.descriptor);

      const descriptor = sauceSession.device?.descriptor ?? sauceSessionId;
      // waitForActiveSession() guarantees links are present before returning.
      const links = sauceSession.links!;

      if (SHOW_LIVE_VIEW && links.liveViewUrl) {
        console.log(`📱 Sauce Labs live view (${descriptor}): 🔗 ${links.liveViewUrl}`);
      }

      // Fetch device descriptor for screen metrics
      let resolutionWidth = 1080;
      let resolutionHeight = 1920;
      let pixelsPerPoint = 1;
      let defaultOrientation: 'PORTRAIT' | 'LANDSCAPE' = 'PORTRAIT';

      try {
        const descriptors = await rest.listDevices();
        const desc = descriptors.find((d) => d.id === descriptor);
        if (desc) {
          resolutionWidth = desc.resolutionWidth ?? resolutionWidth;
          resolutionHeight = desc.resolutionHeight ?? resolutionHeight;
          pixelsPerPoint = desc.pixelsPerPoint ?? pixelsPerPoint;
          defaultOrientation = parseOrientation(desc.defaultOrientation);
        }
      } catch (err) {
        debug('failed to fetch device descriptor: %s', (err as Error).message);
      }

      ioSocket = new DeviceControlSocket(links.ioWebsocketUrl, this.username, this.accessKey);
      companionSocket = new CompanionSocket(links.eventsWebsocketUrl, this.username, this.accessKey);
      await Promise.all([ioSocket.connect(), companionSocket.connect()]);

      let wdaStorageRef: string | undefined;
      if (platform === 'ios') {
        const wdaSource = this.options.iosWdaStorageRef ?? DEFAULT_WDA_URL;
        if (wdaSource.startsWith('storage:')) {
          wdaStorageRef = wdaSource;
        } else {
          debug('uploading WDA from URL: %s', wdaSource);
          wdaStorageRef = await rest.uploadWdaToStorage(wdaSource);
          debug('WDA ready at %s', wdaStorageRef);
        }
      }

      this.session = {
        sauceSessionId,
        ownsSession,
        platform,
        deviceId: descriptor,
        resolutionWidth,
        resolutionHeight,
        pixelsPerPoint,
        currentOrientation: defaultOrientation,
        ioSocket,
        companionSocket,
        wdaClient: platform === 'ios' ? new WdaClient(rest, sauceSessionId, this.options.iosWdaBundleId, wdaStorageRef) : null,
      };

      companionSocket.onOrientationFinish((orientation) => {
        debug('orientation changed to %s', orientation);
        if (this.session) {
          this.session.currentOrientation = orientation;
        }
      });

      return { deviceId: descriptor, platform, sessionId: sauceSessionId };
    } catch (err) {
      await ioSocket?.disconnect().catch(() => {});
      await companionSocket?.disconnect().catch(() => {});
      if (ownsSession) {
        await rest.deleteSession(sauceSessionId).catch((deleteErr) =>
          debug('session cleanup error after connect failure: %s', (deleteErr as Error).message),
        );
      }
      throw err;
    }
  }

  /**
   * Closes the WDA session (iOS) and disconnects both WebSockets. Only deletes the underlying
   * Sauce Labs session (releasing the device) when this driver created it — a driver attached
   * via `ConnectionConfig.sessionId` leaves the session alive for other callers to reuse.
   */
  async disconnect(): Promise<void> {
    const session = this.requireSession();
    const rest = this.makeRest();

    if (session.wdaClient) {
      await session.wdaClient.close().catch((err) => debug('wda close error: %s', err.message));
    }

    await Promise.all([
      session.ioSocket.disconnect(),
      session.companionSocket.disconnect(),
    ]);

    if (session.ownsSession) {
      await rest.deleteSession(session.sauceSessionId);
    }
    this.session = null;
    debug('disconnected (ownsSession=%s)', session.ownsSession);
  }

  // ─── Device settings ─────────────────────────────────────────────────────────

  /** Applies device-level settings; the animations toggle is Android-only and silently ignored on iOS. */
  async applyDeviceSettings(settings: DeviceSettings): Promise<void> {
    const { sauceSessionId, platform } = this.requireSession();
    const rest = this.makeRest();
    if (settings.animations !== undefined && platform === 'android') {
      await rest.applySettings(sauceSessionId, {
        animations: settings.animations === 'on',
      });
    }
    // animations not supported on iOS — silently no-op
  }

  // ─── UI hierarchy ─────────────────────────────────────────────────────────────

  /** Returns the full UI tree — parsed from a uiautomator dump on Android, or from WDA's XML source on iOS. */
  async getViewHierarchy(): Promise<ViewNode[]> {
    const session = this.requireSession();
    const rest = this.makeRest();
    if (session.platform === 'android') {
      const stdout = await rest.executeShellCommand(session.sauceSessionId, 'uiautomator dump /dev/tty');
      return parseUiautomatorXml(stdout);
    } else {
      const wda = this.requireWda(session);
      return wda.getSource();
    }
  }

  // ─── Input ───────────────────────────────────────────────────────────────────

  /**
   * Canvas size and orientation flag used to normalize touch coordinates for
   * sendTouch(). WDA reports iOS element bounds in points, so the canvas is
   * scaled down from resolutionWidth/resolutionHeight (pixels) by pixelsPerPoint
   * to match; Android's uiautomator bounds are already pixel-space and need no
   * scaling.
   */
  private touchFrame(session: ActiveSession): { cw: number; ch: number; orientation: 0 | 1 } {
    const scale = session.platform === 'ios' ? (session.pixelsPerPoint || 1) : 1;
    const w = session.resolutionWidth / scale;
    const h = session.resolutionHeight / scale;
    const orientation: 0 | 1 = session.currentOrientation === 'LANDSCAPE' ? 1 : 0;
    return orientation === 1 ? { cw: h, ch: w, orientation } : { cw: w, ch: h, orientation };
  }

  /** Sends a touch-down then touch-up at the given logical coordinates over the device control socket. */
  async tap(x: number, y: number): Promise<void> {
    const session = this.requireSession();
    const { cw, ch, orientation } = this.touchFrame(session);
    session.ioSocket.sendTouch('d', [{ x, y, index: 0 }], cw, ch, orientation);
    session.ioSocket.sendTouch('u', [{ x, y, index: 0 }], cw, ch, orientation);
  }

  /** Performs two taps at the same coordinates with a 100 ms gap between them. */
  async doubleTap(x: number, y: number): Promise<void> {
    await this.tap(x, y);
    await new Promise((r) => setTimeout(r, 100));
    await this.tap(x, y);
  }

  /** Holds a touch-down for the given duration (ms) before lifting, simulating a long press. */
  async longPress(x: number, y: number, duration = 500): Promise<void> {
    const session = this.requireSession();
    const { cw, ch, orientation } = this.touchFrame(session);
    session.ioSocket.sendTouch('d', [{ x, y, index: 0 }], cw, ch, orientation);
    await new Promise((r) => setTimeout(r, duration));
    session.ioSocket.sendTouch('u', [{ x, y, index: 0 }], cw, ch, orientation);
  }

  /** Types text via socket key events for ASCII; falls back to adb `input text` for non-ASCII on Android, or character-by-character on iOS. */
  async typeText(text: string): Promise<void> {
    const session = this.requireSession();
    const ascii = /^[\x00-\x7F]*$/.test(text);
    if (ascii) {
      for (const char of text) {
        session.ioSocket.sendKey(char === ' ' ? 'Space' : char);
      }
    } else if (session.platform === 'android') {
      const rest = this.makeRest();
      const shellText = text.replace(/'/g, '\'\\\'\'');
      await rest.executeShellCommand(session.sauceSessionId, `input text '${shellText}'`);
    } else {
      // iOS non-ASCII fallback: type character by character via socket; non-ASCII chars may not work
      for (const char of text) {
        session.ioSocket.sendKey(char);
      }
    }
  }

  /** Sends each key name sequentially through the device control socket. */
  async pressKeys(keys: string[]): Promise<void> {
    const { ioSocket } = this.requireSession();
    for (const key of keys) {
      ioSocket.sendKey(key);
    }
  }

  /** Selects all text and deletes it using Ctrl+A and Backspace key events. */
  async clearText(): Promise<void> {
    const { ioSocket } = this.requireSession();
    ioSocket.sendKey('a');
    ioSocket.sendKey('Backspace');
  }

  /** Interpolates a swipe in the given direction as a series of touch-move events spread across the specified duration. */
  async swipe(direction: SwipeDirection, opts?: SwipeOptions): Promise<void> {
    const session = this.requireSession();
    const { ioSocket } = session;
    const { cw, ch, orientation } = this.touchFrame(session);

    const centerX = cw / 2;
    const centerY = ch / 2;
    const startX = opts?.startX ?? centerX;
    const startY = opts?.startY ?? centerY;

    const isHorizontal = direction === 'left' || direction === 'right';
    const defaultDistance = (isHorizontal ? cw : ch) * 0.5;
    const distance = opts?.distance ?? defaultDistance;

    let endX = startX;
    let endY = startY;
    switch (direction) {
      case 'up':    endY = startY - distance; break;
      case 'down':  endY = startY + distance; break;
      case 'left':  endX = startX - distance; break;
      case 'right': endX = startX + distance; break;
    }

    const steps = 10;
    const duration = opts?.duration ?? 300;
    const stepDelay = Math.round(duration / steps);

    ioSocket.sendTouch('d', [{ x: startX, y: startY, index: 0 }], cw, ch, orientation);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mx = startX + (endX - startX) * t;
      const my = startY + (endY - startY) * t;
      await new Promise((r) => setTimeout(r, stepDelay));
      ioSocket.sendTouch('m', [{ x: mx, y: my, index: 0 }], cw, ch, orientation);
    }
    ioSocket.sendTouch('u', [{ x: endX, y: endY, index: 0 }], cw, ch, orientation);
  }

  /** Replays a multi-pointer gesture by dispatching touch events for each pointer at their recorded timestamps. */
  async gesture(gestures: GestureSequence): Promise<void> {
    const session = this.requireSession();
    const { ioSocket } = session;
    const { cw, ch, orientation } = this.touchFrame(session);
    const pointers = gestures.pointers;

    // Collect all unique timestamps, sorted
    const timestamps = Array.from(
      new Set(pointers.flatMap((pts) => pts.map((p) => p.time ?? 0))),
    ).sort((a, b) => a - b);

    let prevTime = 0;
    for (const time of timestamps) {
      if (time > prevTime) {
        await new Promise((r) => setTimeout(r, time - prevTime));
      }
      prevTime = time;

      const points = pointers
        .map((ptr, index) => {
          const pt = ptr.find((p) => (p.time ?? 0) === time);
          return pt ? { x: pt.x, y: pt.y, index } : null;
        })
        .filter((p): p is NonNullable<typeof p> => p !== null);

      if (points.length > 0) {
        const isFirst = time === timestamps[0];
        const isLast = time === timestamps[timestamps.length - 1];
        const action = isFirst ? 'd' : isLast ? 'u' : 'm';
        ioSocket.sendTouch(action, points, cw, ch, orientation);
      }
    }
  }

  /** Presses a hardware button — via socket for HOME/BACK, adb keyevent for Android-only keys, and WDA for iOS-specific buttons. */
  async pressButton(button: HardwareButton): Promise<void> {
    const session = this.requireSession();

    const socketKey = BUTTON_KEY[button];
    if (socketKey) {
      session.ioSocket.sendKey(socketKey);
      return;
    }

    if (session.platform === 'android') {
      const keyEvent = BUTTON_KEYEVENT[button];
      if (keyEvent !== undefined) {
        const rest = this.makeRest();
        await rest.executeShellCommand(session.sauceSessionId, `input keyevent ${keyEvent}`);
        return;
      }
      throw new Error(`Unsupported hardware button on Android: ${button}`);
    }

    // iOS: buttons not in the socket key mapping (checked above) go to WDA.
    const wdaName = BUTTON_WDA[button];
    if (wdaName) {
      const wda = this.requireWda(session);
      await wda.pressButton(wdaName);
      return;
    }
    throw new Error(`Unsupported hardware button on iOS: ${button}`);
  }

  // ─── Screen ──────────────────────────────────────────────────────────────────

  /** Captures the current screen via the Sauce Labs REST API and returns the raw PNG bytes. */
  async screenshot(_opts?: ScreenshotOptions): Promise<Buffer> {
    const { sauceSessionId } = this.requireSession();
    const rest = this.makeRest();
    return rest.takeScreenshot(sauceSessionId);
  }

  /** Returns logical screen dimensions in points, accounting for pixel density and swapping width/height when in landscape. */
  async getScreenSize(): Promise<ScreenSize> {
    const { resolutionWidth, resolutionHeight, pixelsPerPoint, currentOrientation } = this.requireSession();
    const scale = pixelsPerPoint || 1;
    if (currentOrientation === 'LANDSCAPE') {
      return { width: resolutionHeight / scale, height: resolutionWidth / scale, scale };
    }
    return { width: resolutionWidth / scale, height: resolutionHeight / scale, scale };
  }

  /** Returns the current device orientation, kept up-to-date by events received on the companion socket. */
  async getOrientation(): Promise<Orientation> {
    return sauceOrientationToProtocol(this.requireSession().currentOrientation);
  }

  /** Requests an orientation change via the REST API; the actual change is confirmed asynchronously through the companion socket. */
  async setOrientation(orientation: Orientation): Promise<void> {
    const { sauceSessionId } = this.requireSession();
    const rest = this.makeRest();
    await rest.applySettings(sauceSessionId, {
      orientation: protocolOrientationToSauce(orientation),
    });
    // currentOrientation is updated asynchronously via companion socket
  }

  // ─── Apps ────────────────────────────────────────────────────────────────────

  /** Launches an app; on Android re-installs with launchAfterInstall for reliability when a storage ref is available. */
  async launchApp(bundleId: string, opts?: LaunchOptions): Promise<void> {
    const { sauceSessionId, platform } = this.requireSession();
    const rest = this.makeRest();
    if (platform === 'android') {
      // The launchApp REST endpoint does not reliably bring the app to the
      // foreground. Re-installing with launchAfterInstall:true is the reliable
      // path. If no previous install ref is available, fall back to the REST
      // launchApp call.
      const storageRef = this.lastInstalledStorageRef;
      if (storageRef) {
        const result = await rest.installApp(sauceSessionId, storageRef, { launchAfterInstall: true });
        const installationId = result.installationId;
        if (installationId) {
          const deadline = Date.now() + 120_000;
          let finished = false;
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 3_000));
            const { appInstallations } = await rest.listAppInstallations(sauceSessionId);
            const entry = appInstallations.find((a) => a.installationId === installationId);
            if (!entry) continue;
            debug('launchApp install+launch %s status=%s', installationId, entry.status);
            if (entry.status === 'FINISHED') {
              finished = true;
              break;
            }
            if (entry.status === 'ERROR') throw new Error(`App launch via install failed for ${storageRef}: ${JSON.stringify(entry)}`);
          }
          if (!finished) {
            throw new Error(`Timed out waiting for app launch to complete: ${storageRef}`);
          }
        }
      } else {
        await rest.launchApp(sauceSessionId, {
          packageName: bundleId,
          ...(opts?.activity ? { activityName: opts.activity } : {}),
        });
      }
    } else {
      await rest.launchApp(sauceSessionId, { bundleId });
    }
  }

  /** Force-stops an app via adb on Android, or terminates it through WDA on iOS. */
  async terminateApp(bundleId: string): Promise<void> {
    const session = this.requireSession();
    const rest = this.makeRest();
    if (session.platform === 'android') {
      await rest.executeShellCommand(session.sauceSessionId, `am force-stop ${bundleId}`);
    } else {
      const wda = this.requireWda(session);
      await wda.terminateApp(bundleId);
    }
  }

  /** Uploads the app to Sauce Storage if not already there, then installs it on the device and polls until the installation completes. */
  async installApp(filePathOrStorageRef: string): Promise<void> {
    const { sauceSessionId } = this.requireSession();
    const rest = this.makeRest();
    const storageRef = filePathOrStorageRef.startsWith('storage:')
      ? filePathOrStorageRef
      : filePathOrStorageRef.startsWith('https://')
        ? await rest.uploadUrlToStorage(filePathOrStorageRef)
        : await rest.uploadToStorage(filePathOrStorageRef);
    this.lastInstalledStorageRef = storageRef;
    const result = await rest.installApp(sauceSessionId, storageRef);
    const installationId = result.installationId;
    if (!installationId) return;

    // installApp is non-blocking; poll until FINISHED or ERROR.
    const deadline = Date.now() + 120_000;
    const pollInterval = 3_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollInterval));
      const { appInstallations } = await rest.listAppInstallations(sauceSessionId);
      const entry = appInstallations.find((a) => a.installationId === installationId);
      if (!entry) continue;
      debug('install %s status=%s', installationId, entry.status);
      if (entry.status === 'FINISHED') return;
      if (entry.status === 'ERROR') throw new Error(`App installation failed for ${storageRef}: ${JSON.stringify(entry)}`);
    }
    throw new Error(`Timed out waiting for app installation to complete: ${storageRef}`);
  }

  /** Removes an installed app from the device using the appropriate identifier for the platform. */
  async uninstallApp(bundleId: string): Promise<void> {
    const { sauceSessionId, platform } = this.requireSession();
    const rest = this.makeRest();
    if (platform === 'android') {
      await rest.uninstallApp(sauceSessionId, { packageName: bundleId });
    } else {
      await rest.uninstallApp(sauceSessionId, { bundleId });
    }
  }

  /** Lists installed third-party apps via `pm list packages` on Android, or WDA's app list on iOS. */
  async listApps(): Promise<AppInfo[]> {
    const session = this.requireSession();
    const rest = this.makeRest();
    if (session.platform === 'android') {
      const stdout = await rest.executeShellCommand(session.sauceSessionId, 'pm list packages -3');
      return parsePmListPackages(stdout);
    } else {
      const wda = this.requireWda(session);
      return wda.listApps();
    }
  }

  /** Returns the currently active app — parsed from `dumpsys window` on Android, or from WDA's activeAppInfo on iOS. */
  async getForegroundApp(): Promise<AppInfo> {
    const session = this.requireSession();
    const rest = this.makeRest();
    if (session.platform === 'android') {
      // Use full dumpsys output (no grep) to avoid empty stdout on grep exit-code != 0.
      const stdout = await rest.executeShellCommand(session.sauceSessionId, 'dumpsys window');
      debug('getForegroundApp window stdout length=%d', stdout.length);
      const app = parseForegroundApp(stdout);
      debug('getForegroundApp bundleId=%s', app.bundleId);
      return app;
    } else {
      const wda = this.requireWda(session);
      return wda.getActiveAppInfo();
    }
  }

  // ─── Device ──────────────────────────────────────────────────────────────────

  /** Fetches the device catalog and live availability status, returning devices optionally filtered by platform and state. */
  async listDevices(opts?: ListDevicesOptions): Promise<DeviceInfo[]> {
    const rest = this.makeRest();
    const [descriptors, statusResp] = await Promise.all([
      rest.listDevices(),
      rest.listDeviceStatus(),
    ]);

    const statusMap = new Map<string, string>();
    for (const s of statusResp.devices) {
      statusMap.set(s.descriptor, s.state);
    }

    let devices: DeviceInfo[] = descriptors
      .filter((d) => {
        if (opts?.platform) {
          const os = d.os.toLowerCase() as Platform;
          if (os !== opts.platform) return false;
        }
        return true;
      })
      .map((d) => {
        const rawState = statusMap.get(d.id) ?? 'AVAILABLE';
        const state = rawState === 'IN_USE' ? 'offline' as const : 'online' as const;
        return {
          id: d.id,
          name: d.name,
          platform: (d.os.toLowerCase() === 'android' ? 'android' : 'ios') as Platform,
          type: 'real' as const,
          state,
          model: d.name,
          osVersion: d.osVersion,
        };
      });

    if (opts?.state) {
      devices = devices.filter((d) => d.state === opts.state);
    }

    return devices;
  }

  /** Opens the given URL in the device's default browser via the Sauce Labs REST API. */
  async openUrl(url: string): Promise<void> {
    const { sauceSessionId } = this.requireSession();
    const rest = this.makeRest();
    await rest.openUrl(sauceSessionId, url);
  }

  // ─── Recording ───────────────────────────────────────────────────────────────

  /** Starts buffering MJPEG frames received from the device control socket for later encoding. */
  async startRecording(opts: RecordingOptions): Promise<void> {
    const { ioSocket } = this.requireSession();
    this.recordingOptions = opts;
    ioSocket.startFrameCapture();
  }

  /** Stops frame capture and encodes the buffered MJPEG frames into an MP4 file at the path specified in `startRecording`. */
  async stopRecording(): Promise<RecordingResult> {
    const { ioSocket } = this.requireSession();
    const opts = this.recordingOptions;
    if (!opts) throw new Error('stopRecording called without a prior startRecording');
    this.recordingOptions = null;

    const frames = ioSocket.stopFrameCapture();
    const endTs = ioSocket.getCaptureEndTs();
    if (frames.length === 0) {
      return { output: opts.output, duration: 0 };
    }

    await encodeFramesToMp4(frames, endTs, opts.output);
    const duration = (endTs - frames[0].ts) / 1000;

    return { output: opts.output, duration };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** Asserts an active session exists and returns it, throwing if `connect()` has not been called. */
  private requireSession(): ActiveSession {
    if (!this.session) throw new Error('No active session. Call connect() first.');
    return this.session;
  }

  /** Creates a REST client configured with the current credentials and region. */
  private makeRest(): RestClient {
    return new RestClient(
      this.username,
      this.accessKey,
      this.options.region ?? 'us-west-1',
    );
  }

  /** Returns the WDA client for the session, throwing if it is not available (non-iOS session). */
  private requireWda(session: ActiveSession): WdaClient {
    if (!session.wdaClient) throw new Error('WDA client is only available on iOS');
    return session.wdaClient;
  }
}

// ─── uiautomator XML parser ──────────────────────────────────────────────────

function parseUiautomatorXml(xml: string): ViewNode[] {
  const root: ViewNode[] = [];
  const stack: ViewNode[][] = [root];
  const tagRe = /<(\/?)(\w[\w.]*)\s*([^>]*)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(xml)) !== null) {
    const [, closing, tag, attrsRaw] = match;

    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }

    const attrs = parseAttrsFromXml(attrsRaw);
    const isSelfClosing = attrsRaw.trimEnd().endsWith('/');

    // bounds="[x1,y1][x2,y2]"
    let bx = 0, by = 0, bw = 0, bh = 0;
    // noinspection RegExpRedundantEscape
    const boundsMatch = (attrs['bounds'] ?? '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (boundsMatch) {
      bx = Number(boundsMatch[1]);
      by = Number(boundsMatch[2]);
      bw = Number(boundsMatch[3]) - bx;
      bh = Number(boundsMatch[4]) - by;
    }

    const node: ViewNode = {
      type: attrs['class'] ?? tag,
      label: attrs['content-desc'] || undefined,
      identifier: attrs['resource-id'] || undefined,
      resourceId: attrs['resource-id'] || undefined,
      text: attrs['text'] || undefined,
      isVisible: true,
      isEnabled: attrs['enabled'] !== 'false',
      isSelected: attrs['selected'] === 'true',
      isFocused: attrs['focused'] === 'true',
      isChecked: attrs['checked'] === 'true',
      bounds: { x: bx, y: by, width: bw, height: bh },
      children: [],
      raw: { ...attrs },
    };

    stack[stack.length - 1].push(node);
    if (!isSelfClosing) {
      stack.push(node.children);
    }
  }

  return root;
}

function parseAttrsFromXml(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w-]+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

// ─── ffmpeg encoder ──────────────────────────────────────────────────────────

function resolveFFmpegPath(): string {
  try {
    // Prefer Playwright's bundled ffmpeg over the system one.
     
    const { registry } = require('playwright-core/lib/server/registry/index.js');
    return registry.findExecutable('ffmpeg').executablePath('javascript') as string;
  } catch {
    return 'ffmpeg';
  }
}

const FFMPEG_PATH = resolveFFmpegPath();

function encodeFramesToMp4(
  frames: { frame: Buffer; ts: number }[],
  endTs: number,
  output: string,
): Promise<void> {
  // Compute the real recording duration and derive the input framerate so that
  // the video length matches wall-clock time regardless of how many frames
  // arrived (screen may be static for long stretches between changes).
  const durationSec = Math.max((endTs - frames[0].ts) / 1000, 0.1);
  const inputFps = `${frames.length}/${durationSec.toFixed(3)}`;

  return new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn(FFMPEG_PATH, [
      '-y',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-r', inputFps,
      '-i', 'pipe:0',
      '-vcodec', 'libx264',
      '-pix_fmt', 'yuv420p',
      output,
    ], { stdio: ['pipe', 'ignore', 'ignore'] });

    ffmpeg.on('error', (err) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)));
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });

    const stdin = ffmpeg.stdin!;
    for (const { frame } of frames) {
      stdin.write(frame);
    }
    stdin.end();
  });
}
