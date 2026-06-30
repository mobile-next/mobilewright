import type { Device } from '@mobilewright/core';
import type { DeviceInfo } from '@mobilewright/protocol';
import { logger } from './logger.js';

/** Platform launcher injected from mobilewright to avoid a circular dependency. */
export interface MobilewrightLauncher {
  /** List all connected/booted devices for this platform. */
  devices(): Promise<DeviceInfo[]>;
  /** Launch and connect to a specific device by id. */
  launch(opts: { deviceId: string; autoStart?: boolean; autoAppLaunch?: boolean }): Promise<Device>;
}

/** Discriminated union of error codes thrown by DeviceManager. */
export type DeviceErrorCode = 'blocked' | 'in_progress' | 'not_found' | 'connect_failed';

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
  /** True while an inspect operation is in progress; blocks concurrent select(). */
  #inspectInFlight = false;
  /** True while a select() call is awaiting launcher.launch(); blocks concurrent select(). */
  #selecting = false;
  /** True after close() is called; prevents new connections after shutdown. */
  #closed = false;

  /** @param ios iOS launcher from mobilewright. @param android Android launcher from mobilewright. */
  constructor({ ios, android }: { ios: MobilewrightLauncher; android: MobilewrightLauncher }) {
    this.#ios = ios;
    this.#android = android;
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
   * Throws DeviceError if an inspect is in flight, a select is already in progress,
   * or the previous device cannot be cleanly disconnected.
   */
  async select(deviceId: string, platform: 'ios' | 'android'): Promise<Device> {
    if (this.#closed) throw new DeviceError('DeviceManager is closed', 'connect_failed');
    if (this.#inspectInFlight) throw new DeviceError('Device switch blocked: inspect in progress', 'blocked');
    if (this.#selecting) throw new DeviceError('Device switch already in progress', 'in_progress');

    this.#selecting = true;
    try {
      if (this.#activeDevice) {
        logger.info(`Closing previous device ${this.#activeDeviceInfo?.id}`);
        try {
          await this.#activeDevice.close();
          this.#activeDevice = null;
          this.#activeDeviceInfo = null;
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
    if (this.#inspectInFlight || this.#selecting) return false;
    this.#inspectInFlight = true;
    return true;
  }

  /** Clear the inspect-in-flight flag set by beginInspect(). */
  endInspect(): void {
    this.#inspectInFlight = false;
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
        this.#activeDevice = null;
        this.#activeDeviceInfo = null;
      } catch (err) {
        logger.error(`Failed to close device ${this.#activeDeviceInfo?.id}: ${(err as Error).message}`);
        throw new DeviceError((err as Error).message, 'connect_failed');
      }
    }
  }

  /** The currently connected device, or null if none selected. */
  get device(): Device | null { return this.#activeDevice; }

  /** Id and platform of the currently connected device, or null if none selected. */
  get deviceInfo(): DeviceInfoRecord | null { return this.#activeDeviceInfo; }
}
