import { test } from '@mobilewright/test';
import { expect } from '@playwright/test';
import { openWebviewPage } from './harness.js';
import { conformanceSpecs } from './specs/index.js';

// mobilewright runner: drive the shared conformance specs against a real
// on-device webview, using Playwright's own expect (which the MobileWebViewPage /
// MobileWebViewLocator satisfy). Each spec body lives in ./specs and also runs
// under Playwright via conformance.pw.ts — same files, two runtimes.
for (const spec of conformanceSpecs) {
  test(spec.name, async ({ device, screen }) => {
    const page = await openWebviewPage({ device, screen });
    await spec.run(page, expect);
  });
}
