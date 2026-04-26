import type { AllocationCriteria, AllocateResult, DeviceAllocator } from '../application/ports.js';

export class MobileUseAllocator implements DeviceAllocator {
  async allocate(_criteria: AllocationCriteria): Promise<AllocateResult> {
    throw new Error(
      'mobile-use driver is not yet supported through the test runner. ' +
      'Use the public ios.launch() / android.launch() API for scripting, ' +
      'or switch to the mobilecli driver for tests.',
    );
  }

  async release(_deviceId: string): Promise<void> {
    // no-op; allocate never succeeds.
  }
}
