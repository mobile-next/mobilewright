import { test, expect } from '@playwright/test';
import { conformanceSpecs } from './specs/index.js';

// Playwright runner: drive the exact same conformance specs against a real
// browser. This is the parity oracle — if a spec passes here but fails under
// mobilewright (conformance.test.ts), mobilewright diverges from Playwright.
for (const spec of conformanceSpecs) {
  test(spec.name, async ({ page }) => {
    await spec.run(page, expect);
  });
}
