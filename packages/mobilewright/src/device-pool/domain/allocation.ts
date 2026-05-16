import { randomBytes } from 'node:crypto';
import type { Platform } from '@mobilewright/protocol';

export interface AllocationParams {
  allocationId: string;
  deviceId: string;
  platform: Platform;
  slotIndex: number;
}

export interface AllocationCreateParams {
  deviceId: string;
  platform: Platform;
  slotIndex: number;
}

export class Allocation {
  readonly allocationId: string;
  readonly deviceId: string;
  readonly platform: Platform;
  readonly slotIndex: number;

  constructor(params: AllocationParams) {
    this.allocationId = params.allocationId;
    this.deviceId = params.deviceId;
    this.platform = params.platform;
    this.slotIndex = params.slotIndex;
  }

  static create(params: AllocationCreateParams): Allocation {
    const id = `alloc-${randomBytes(8).toString('hex')}`;
    return new Allocation({ allocationId: id, ...params });
  }
}
