// Platform launchers — the primary entry point
export { ios, android, type LaunchOptions } from './launchers.js';

// Assertions
export { expect } from '@mobilewright/core';

// Core classes (for advanced use)
export { Device, Screen, Locator } from '@mobilewright/core';

// Configuration
export { defineConfig, loadConfig, type MobilewrightConfig, type MobilewrightProjectConfig, type MobilewrightUseOptions, type DriverConfig, type DriverConfigMobilecli, type DriverConfigMobileUse } from './config.js';

// Errors
export { MobilewrightError } from './errors.js';

// Internal — used by @mobilewright/test fixtures. Not part of the public API.
export { createDevicePoolClient } from './device-pool/client-factory.js';
export { connectDevice, installAndLaunchApps } from './launchers.js';
export { toArray } from './config.js';
export type { DevicePoolClient, AllocationHandle, AllocationCriteria } from './device-pool/application/ports.js';
