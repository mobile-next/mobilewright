import type { MobilewrightConfig, MobilewrightDriver } from 'mobilewright';
import { defineConfig } from 'mobilewright';
import { MobilecliDriver } from '@mobilewright/driver-mobilecli';
import { MobileNextDriver } from '@mobilewright/driver-mobilenext';

function resolveDriver(): MobilewrightDriver | undefined {
  const name = process.env['MOBILEWRIGHT_DRIVER'] ?? 'mobilecli';
  console.log(`Using driver: ${name}`);

  switch (name) {
    case 'mobilenext':
      if (!process.env['MOBILENEXT_API_KEY']) {
        throw new Error('MOBILENEXT_API_KEY is required for mobilenext driver');
      }
      return new MobileNextDriver({ apiKey: process.env['MOBILENEXT_API_KEY'] });

    case 'mobilecli':
      return new MobilecliDriver();

    default:
      throw new Error(`Unknown driver: ${name}. Use ['mobilecli' or 'mobilenext']`);
  }
}

const config: MobilewrightConfig = defineConfig({
  testDir: './src',
  testMatch: '**/*.test.ts',
  retries: 0,
  // Cloud device allocation (mobilenext) can take minutes on its own — matches
  // MobileNextDriver's default allocationTimeout so neither cap fights the other.
  timeout: 5 * 60_000,

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
