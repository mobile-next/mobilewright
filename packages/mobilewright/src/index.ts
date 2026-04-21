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
