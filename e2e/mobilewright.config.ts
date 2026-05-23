import { defineConfig } from 'mobilewright';
import type { DriverConfig, MobilewrightConfig } from 'mobilewright';

function resolveDriver(): DriverConfig {
  const name = process.env['MOBILEWRIGHT_DRIVER'] ?? 'mobilecli';
  console.log(`Using driver: ${name}`);

  switch (name) {
    case 'mobilenext':
      if (!process.env['MOBILENEXT_API_KEY']) {
        throw new Error('MOBILENEXT_API_KEY is required for mobilenext driver');
      }
      
      return {
        type: 'mobilenext',
        apiKey: process.env['MOBILENEXT_API_KEY'],
      };

    case 'mobilecli': 
    return { type: 'mobilecli' };

    default:
      throw new Error(`Unknown driver: ${name}. Use ['mobilecli' or 'mobilenext']`);
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

  // supports mobilecli and mobilenext drivers
  driver: resolveDriver(),

  // filter used devices with regexp
  // deviceName: /Max/,
});

export default config;
