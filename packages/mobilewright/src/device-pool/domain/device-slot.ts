import type { Platform } from '@mobilewright/protocol';

export type DeviceSlotState = 'allocating' | 'available' | 'allocated';

export class DeviceSlotStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceSlotStateError';
  }
}

export class DeviceSlot {
  private _state: DeviceSlotState = 'allocating';
  private _deviceId?: string;
  private _platform?: Platform;
  private _allocationId?: string;
  private readonly _installedApps = new Set<string>();

  get state(): DeviceSlotState {
    return this._state;
  }

  get deviceId(): string | undefined {
    return this._deviceId;
  }

  get platform(): Platform | undefined {
    return this._platform;
  }

  get allocationId(): string | undefined {
    return this._allocationId;
  }

  markAvailable(deviceId: string, platform: Platform): void {
    if (this._state !== 'allocating') {
      throw new DeviceSlotStateError(
        `markAvailable requires state 'allocating', got '${this._state}'`,
      );
    }
    this._state = 'available';
    this._deviceId = deviceId;
    this._platform = platform;
  }

  claim(allocationId: string): void {
    if (this._state !== 'available') {
      throw new DeviceSlotStateError(
        `claim requires state 'available', got '${this._state}'`,
      );
    }
    this._state = 'allocated';
    this._allocationId = allocationId;
  }

  release(): void {
    if (this._state !== 'allocated') {
      throw new DeviceSlotStateError(
        `release requires state 'allocated', got '${this._state}'`,
      );
    }
    this._state = 'available';
    this._allocationId = undefined;
  }

  recordAppInstalled(bundleId: string): void {
    this._installedApps.add(bundleId);
  }

  isAppInstalled(bundleId: string): boolean {
    return this._installedApps.has(bundleId);
  }
}
