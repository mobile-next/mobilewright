import createDebug from 'debug';
import type {
  AppInfo,
  ConnectionConfig,
  LaunchOptions,
  MobilewrightDriver,
  Orientation,
  RecordingOptions,
  RecordingResult,
  Session,
} from '@mobilewright/protocol';
import { Screen } from './screen.js';
import type { LocatorOptions } from './locator.js';
import { retryUntil } from './poll.js';

const debug = createDebug('mw:device');

const LAUNCH_APP_TIMEOUT = 20_000;

export interface DeviceOptions {
  locatorDefaults?: LocatorOptions;
}

export class Device {
  readonly driver: MobilewrightDriver;
  private cleanupCallbacks: Array<() => Promise<void>> = [];
  private _screen: Screen | null = null;
  private readonly opts: DeviceOptions;

  constructor(driver: MobilewrightDriver, opts: DeviceOptions = {}) {
    this.driver = driver;
    this.opts = opts;
  }

  /** Register a callback to run on close(). Used by launchers for cleanup. */
  onClose(callback: () => Promise<void>): void {
    this.cleanupCallbacks.push(callback);
  }

  // ─── Connection lifecycle ────────────────────────────────────

  async connect(config: ConnectionConfig): Promise<Session> {
    return this.driver.connect(config);
  }

  async disconnect(): Promise<void> {
    await this.driver.disconnect();
  }

  /** Full cleanup: disconnect + run any registered cleanup callbacks. */
  async close(): Promise<void> {
    await this.disconnect();
    for (const cb of this.cleanupCallbacks) {
      await cb();
    }
    this.cleanupCallbacks = [];
  }

  get screen(): Screen {
    this._screen ??= new Screen(this.driver, this.opts.locatorDefaults);
    return this._screen;
  }

  // ─── Device control ──────────────────────────────────────────

  async getOrientation(): Promise<Orientation> {
    return this.driver.getOrientation();
  }

  async setOrientation(orientation: Orientation): Promise<void> {
    return this.driver.setOrientation(orientation);
  }

  async openUrl(url: string): Promise<void> {
    return this.driver.openUrl(url);
  }

  /** Alias for openUrl — matches Playwright's page.goto(). */
  async goto(url: string): Promise<void> {
    return this.openUrl(url);
  }

  // ─── App control ─────────────────────────────────────────────

  async launchApp(bundleId: string, opts?: LaunchOptions): Promise<void> {
    await this.driver.launchApp(bundleId, opts);
    if (opts?.noWaitAfter) {
      return;
    }
    debug('waiting for %s to reach foreground', bundleId);
    try {
      await retryUntil(
        () => this.getForegroundApp(),
        (app) => app.bundleId === bundleId,
        LAUNCH_APP_TIMEOUT,
        `launchApp: timed out waiting for "${bundleId}" to be in foreground`,
      );
      debug('%s is in foreground', bundleId);
    } catch (err) {
      if (String(err).includes('could not determine foreground app')) {
        // mobilecli's WebSocket RPC path for device.apps.foreground fails on
        // some Android devices even though the app launched successfully.
        // Warn and continue rather than failing the launch entirely.
        console.warn(`[mobilewright] warning: could not verify "${bundleId}" reached foreground — proceeding anyway. This is a known mobilecli issue on some Android devices.`);
        return;
      }
      throw err;
    }
  }

  async terminateApp(bundleId: string): Promise<void> {
    debug('terminating %s', bundleId);
    return this.driver.terminateApp(bundleId);
  }

  async listApps(): Promise<AppInfo[]> {
    return this.driver.listApps();
  }

  async getForegroundApp(): Promise<AppInfo> {
    return this.driver.getForegroundApp();
  }

  async installApp(path: string): Promise<void> {
    return this.driver.installApp(path);
  }

  async uninstallApp(bundleId: string): Promise<void> {
    return this.driver.uninstallApp(bundleId);
  }

  // ─── Recording ─────────────────────────────────────────────────

  async startRecording(opts: RecordingOptions): Promise<void> {
    return this.driver.startRecording(opts);
  }

  async stopRecording(): Promise<RecordingResult> {
    return this.driver.stopRecording();
  }
}
