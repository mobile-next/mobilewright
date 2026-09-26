import type { Device } from '@mobilewright/core';
import type { DeviceInfo, ScreenSize } from '@mobilewright/protocol';
import { logger } from './logger.js';
import { timeoutAfter } from './timeout.js';

const DEFAULT_SCREEN_SIZE_TIMEOUT_MS = 10_000;

/** Platform launcher injected from mobilewright to avoid a circular dependency. */
export interface MobilewrightLauncher {
  /** List all connected/booted devices for this platform. */
  devices(): Promise<DeviceInfo[]>;
  /** Launch and connect to a specific device by id. */
  launch(opts: { deviceId: string; autoStart?: boolean; autoAppLaunch?: boolean }): Promise<Device>;
}

/** Discriminated union of error codes thrown by DeviceManager. */
export type DeviceErrorCode = 'in_progress' | 'not_found' | 'connect_failed';

/** Structured error thrown by DeviceManager for expected failure modes. */
export class DeviceError extends Error {
  /** Machine-readable error code indicating the failure reason. */
  readonly code: DeviceErrorCode;

  /** @param message Human-readable description. @param code Machine-readable failure reason. */
  constructor(message: string, code: DeviceErrorCode) {
    super(message);
    this.name = 'DeviceError';
    this.code = code;
  }
}

/** DeviceInfo tagged with its platform, returned by listDevices(). */
export type TaggedDeviceInfo = DeviceInfo & { platform: 'ios' | 'android' };

/** Options for {@link DeviceManager}. */
export interface DeviceManagerOptions {
  ios: MobilewrightLauncher;
  android: MobilewrightLauncher;
  /** How long a screen size call may take before it counts as failed and is asked again. */
  screenSizeTimeoutMs?: number;
}

/** Minimal device identity record held by DeviceManager while a device is active. */
export type DeviceInfoRecord = { id: string; platform: 'ios' | 'android' };

/**
 * Manages a single active device connection shared across the inspect lifecycle.
 * Coordinates concurrent select() and inspect operations via in-flight flags.
 */
export class DeviceManager {
  /** iOS launcher instance. */
  #ios: MobilewrightLauncher;
  /** Android launcher instance. */
  #android: MobilewrightLauncher;
  /** Currently connected device driver, or null when no device is selected. */
  #activeDevice: Device | null = null;
  /** Identity of the currently connected device, or null when no device is selected. */
  #activeDeviceInfo: DeviceInfoRecord | null = null;
  /** True while an inspect is in progress; only one runs at a time. */
  #inspectInFlight = false;
  /** Inspects and device actions currently using the active device; select() waits for them. */
  #operationsInFlight = 0;
  /** Resolves when #operationsInFlight drops to 0; null when nothing is running. */
  #operationsDone: Promise<void> | null = null;
  #resolveOperationsDone: (() => void) | null = null;
  /** True while a select() call is awaiting launcher.launch(); blocks concurrent select(). */
  #selecting = false;
  /**
   * The active device's screen size, fetched once per connection: it never changes while connected,
   * yet asking costs ~250ms. ponytail: stale after the device rotates; key by orientation if needed.
   */
  #screenSize: Promise<ScreenSize> | null = null;
  #screenSizeTimeoutMs: number;
  /** True after close() is called; prevents new connections after shutdown. */
  #closed = false;

  /** @param ios iOS launcher from mobilewright. @param android Android launcher from mobilewright. */
  constructor({ ios, android, screenSizeTimeoutMs = DEFAULT_SCREEN_SIZE_TIMEOUT_MS }: DeviceManagerOptions) {
    this.#ios = ios;
    this.#android = android;
    this.#screenSizeTimeoutMs = screenSizeTimeoutMs;
  }

  /**
   * List all connected/booted devices across both platforms.
   * Each platform is queried independently so a failure on one does not hide the other.
   */
  async listDevices(): Promise<TaggedDeviceInfo[]> {
    const [iosResult, androidResult] = await Promise.allSettled([
      this.#ios.devices(),
      this.#android.devices(),
    ]);
    if (iosResult.status === 'rejected') logger.warn(`iOS device list failed: ${iosResult.reason?.message}`);
    if (androidResult.status === 'rejected') logger.warn(`Android device list failed: ${androidResult.reason?.message}`);
    return [
      ...(iosResult.status === 'fulfilled' ? iosResult.value.map(d => ({ ...d, platform: 'ios' as const })) : []),
      ...(androidResult.status === 'fulfilled' ? androidResult.value.map(d => ({ ...d, platform: 'android' as const })) : []),
    ];
  }

  /**
   * Connect to a device, closing any previous connection first.
   * Waits for in-flight inspects and device actions to finish (codegen refreshes back to back, so
   * an inspect is nearly always running) and refuses new ones until the switch is done, so nothing
   * uses a device while it is being closed.
   * Throws DeviceError if a select is already in progress or the previous device cannot be
   * cleanly disconnected.
   */
  async select(deviceId: string, platform: 'ios' | 'android'): Promise<Device> {
    if (this.#closed) {
      throw new DeviceError('DeviceManager is closed', 'connect_failed');
    }
    if (this.#selecting) {
      throw new DeviceError('Device switch already in progress', 'in_progress');
    }

    this.#selecting = true;
    try {
      await this.#operationsDone;
      if (this.#activeDevice) {
        logger.info(`Closing previous device ${this.#activeDeviceInfo?.id}`);
        try {
          await this.#activeDevice.close();
          this.#forgetActiveDevice();
        } catch (err) {
          logger.error(`Failed to close device ${this.#activeDeviceInfo?.id}: ${(err as Error).message}`);
          throw new DeviceError((err as Error).message, 'connect_failed');
        }
      }
      logger.info(`Connecting to ${platform} device ${deviceId}`);
      const launcher = platform === 'ios' ? this.#ios : this.#android;
      const launched = await launcher.launch({ deviceId, autoStart: true, autoAppLaunch: false });
      if (this.#closed) {
        try { await launched.close(); } catch {}
        throw new DeviceError('DeviceManager closed during connect', 'connect_failed');
      }
      this.#activeDevice = launched;
      this.#activeDeviceInfo = { id: deviceId, platform };
      logger.info(`Connected to ${deviceId}`);
      return this.#activeDevice;
    } catch (err) {
      if (err instanceof DeviceError) throw err;
      logger.error(`Failed to connect to ${deviceId}: ${(err as Error).message}`);
      throw new DeviceError((err as Error).message, 'connect_failed');
    } finally {
      this.#selecting = false;
    }
  }

  /**
   * Mark the start of an inspect operation.
   * Returns false if an inspect is already in flight or a device switch is in progress.
   */
  beginInspect(): boolean {
    if (this.#inspectInFlight || this.#selecting) {
      return false;
    }
    this.#inspectInFlight = true;
    this.#startOperation();
    return true;
  }

  /** Clear the inspect-in-flight flag set by beginInspect(), releasing a waiting select(). */
  endInspect(): void {
    if (!this.#inspectInFlight) {
      return;
    }
    this.#inspectInFlight = false;
    this.#endOperation();
  }

  /**
   * Run a device action (tap, button press, ...) on the active device. A device switch waits for it
   * before closing the device. Rejects with DeviceError 'not_found' without a device, and
   * 'in_progress' while a switch is underway.
   */
  async withDevice<T>(run: (device: Device) => Promise<T>): Promise<T> {
    if (this.#selecting) {
      throw new DeviceError('Device switch in progress', 'in_progress');
    }
    const device = this.#activeDevice;
    if (!device) {
      throw new DeviceError('No device selected', 'not_found');
    }
    this.#startOperation();
    try {
      return await run(device);
    } finally {
      this.#endOperation();
    }
  }

  #startOperation(): void {
    this.#operationsInFlight++;
    if (!this.#operationsDone) {
      this.#operationsDone = new Promise(resolve => { this.#resolveOperationsDone = resolve; });
    }
  }

  #endOperation(): void {
    this.#operationsInFlight--;
    if (this.#operationsInFlight === 0) {
      this.#resolveOperationsDone?.();
      this.#resolveOperationsDone = null;
      this.#operationsDone = null;
    }
  }

  /**
   * Close the active device connection. Safe to call with no active device.
   * Throws if the underlying driver close fails; state is only cleared on success.
   */
  async close(): Promise<void> {
    this.#closed = true;
    if (this.#activeDevice) {
      logger.info(`Closing device ${this.#activeDeviceInfo?.id}`);
      try {
        await this.#activeDevice.close();
        this.#forgetActiveDevice();
      } catch (err) {
        logger.error(`Failed to close device ${this.#activeDeviceInfo?.id}: ${(err as Error).message}`);
        throw new DeviceError((err as Error).message, 'connect_failed');
      }
    }
  }

  /** The active device's screen size, asked once per connection; a failed ask is retried next call. */
  screenSize(): Promise<ScreenSize> {
    const device = this.#activeDevice;
    if (!device) {
      return Promise.reject(new DeviceError('No device selected', 'not_found'));
    }
    if (!this.#screenSize) {
      // The timeout is on the cached promise itself: a call that hangs must count as failed so the
      // next caller asks again, instead of every caller waiting on it forever.
      const size = timeoutAfter(device.screenSize(), this.#screenSizeTimeoutMs);
      this.#screenSize = size;
      size.catch(() => {
        if (this.#screenSize === size) {
          this.#screenSize = null;
        }
      });
    }
    return this.#screenSize;
  }

  #forgetActiveDevice(): void {
    this.#activeDevice = null;
    this.#activeDeviceInfo = null;
    this.#screenSize = null;
  }

  /** The currently connected device, or null if none selected. */
  get device(): Device | null { return this.#activeDevice; }

  /** Id and platform of the currently connected device, or null if none selected. */
  get deviceInfo(): DeviceInfoRecord | null { return this.#activeDeviceInfo; }
}
