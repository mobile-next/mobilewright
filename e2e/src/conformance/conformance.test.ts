import { test, expect } from '@mobilewright/test';
import { openWebviewPage } from './harness.js';
import { conformanceSpecs } from './specs/index.js';
import type { ConformancePage, ConformanceExpect } from './specs/index.js';

// mobilewright runner: drive the shared conformance specs against a real
// on-device webview. Each spec body lives in ./specs and also runs under
// Playwright via conformance.pw.ts — same files, two runtimes.
for (const spec of conformanceSpecs) {
  test(spec.name, async ({ device, screen }) => {
    const page = await openWebviewPage({ device, screen });
    await spec.run(page as unknown as ConformancePage, expect as unknown as ConformanceExpect);
  });
}
