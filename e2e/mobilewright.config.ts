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

  // supports mobilecli and mobilenext drivers
  driver: resolveDriver(),

  // one project per platform. Tests under src/conformance run on both; tests
  // under src/ios or src/android are platform-specific and only run on that
  // project (each project ignores the other platform's directory).
  projects: [
    { name: 'ios', use: { platform: 'ios' }, testIgnore: '**/android/**' },
    { name: 'android', use: { platform: 'android' }, testIgnore: '**/ios/**' },
  ],

  // filter used devices with regexp
  // deviceName: /Max/,
});

export default config;
