import { defineConfig, devices } from '@playwright/test';

// Runs the shared conformance specs (src/conformance/specs) against a real
// browser, as the parity oracle for the mobilewright on-device runner. Only
// picks up *.pw.ts so it never collides with the mobilewright *.test.ts files.
export default defineConfig({
  testDir: './src',
  testMatch: '**/*.pw.ts',
  timeout: 60_000,
  fullyParallel: true,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
