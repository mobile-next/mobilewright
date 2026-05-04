import { defineConfig } from 'mobilewright';
import type { DriverConfig, MobilewrightConfig } from 'mobilewright';

function resolveDriver(): DriverConfig {
  const name = process.env['MOBILEWRIGHT_DRIVER'] ?? 'mobilecli';
  console.log(`Using driver: ${name}`);

  switch (name) {
    case 'mobile-use':
      if (!process.env['MOBILE_USE_API_KEY']) {
        throw new Error('MOBILE_USE_API_KEY is required for mobile-use driver');
      }
      
      return {
        type: 'mobile-use',
        apiKey: process.env['MOBILE_USE_API_KEY'],
      };

    case 'mobilecli': 
    return { type: 'mobilecli' };

    default:
      throw new Error(`Unknown driver: ${name}. Use ['mobilecli' or 'mobile-use']`);
  }
}

const config: MobilewrightConfig = defineConfig({
  testDir: './src',
  testMatch: '**/*.test.ts',
  retries: 0,
  timeout: 60_000,
  platform: 'ios',

  // parallel by test() instead of parallel by file
  fullyParallel: true,

  // supports mobilecli and mobile-use drivers
  driver: resolveDriver(),

  // filter used devices with regexp
  // deviceName: /Max/,
});

export default config;
