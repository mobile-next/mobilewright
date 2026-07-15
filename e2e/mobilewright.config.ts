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

    case 'saucelabs': {
      if (!process.env['SAUCE_USERNAME'] || !process.env['SAUCE_ACCESS_KEY']) {
        throw new Error('SAUCE_USERNAME and SAUCE_ACCESS_KEY are required for saucelabs driver');
      }
      const region = process.env['SAUCE_REGION'] ?? 'us-west-1';
      const validRegions = ['us-west-1', 'eu-central-1', 'us-east-4'] as const;
      if (!validRegions.includes(region as typeof validRegions[number])) {
        throw new Error(`Invalid SAUCE_REGION: ${region}. Valid values: ${validRegions.join(', ')}`);
      }
      return {
        type: 'saucelabs',
        region: region as typeof validRegions[number],
      };
    }

    case 'mobilecli':
      return { type: 'mobilecli' };

    default:
      throw new Error(`Unknown driver: ${name}. Use 'mobilecli', 'mobilenext', or 'saucelabs'`);
  }
}

const driver = process.env['MOBILEWRIGHT_DRIVER'] ?? 'mobilecli';
const isSauce = driver === 'saucelabs';
const sauceUse = isSauce
  ? { video: 'on' as const, screenshot: 'on' as const }
  : {};

const config: MobilewrightConfig = defineConfig({
  testDir: './src',
  testMatch: '**/*.test.ts',
  retries: 0,
  timeout: isSauce ? 400_000 : 60_000,
  reporter: 'html',

  // supports mobilecli, mobilenext, and Sauce drivers
  driver: resolveDriver(),

  // one project per platform. Tests under src/conformance run on both; tests
  // under src/ios or src/android are platform-specific and only run on the matching project.
  projects: [
    { name: 'ios', use: { platform: 'ios', ...sauceUse }, testIgnore: '**/android/**' },
    { name: 'android', use: { platform: 'android', ...sauceUse }, testIgnore: '**/ios/**' },
  ],

  // filter used devices with regexp
  // deviceName: /Max/,
});

export default config;
