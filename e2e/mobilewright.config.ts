import { defineConfig } from 'mobilewright';
import type { DriverConfig, MobilewrightConfig } from 'mobilewright';

function resolveDriver(): DriverConfig | undefined {
  const name = process.env['MOBILEWRIGHT_DRIVER'] ?? 'mobilecli';
  if (name === 'mobile-use') {
    return {
      type: 'mobile-use',
      apiKey: process.env['MOBILEWRIGHT_API_KEY'],
      region: process.env['MOBILEWRIGHT_REGION'],
    };
  }
  return { type: 'mobilecli' };
}

const config: MobilewrightConfig = defineConfig({
  testDir: './src',
  platform: (process.env['MOBILEWRIGHT_PLATFORM'] as 'ios' | 'android') ?? 'ios',
  driver: resolveDriver(),
});
export default config;
