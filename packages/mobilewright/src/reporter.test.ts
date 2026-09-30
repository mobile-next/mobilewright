import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { brandReport } from './reporter.js';

/** Writes `index.html` into a throwaway report folder and brands it. */
function brand(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mw-report-'));
  try {
    writeFileSync(join(dir, 'index.html'), body, 'utf-8');
    brandReport(dir);
    return readFileSync(join(dir, 'index.html'), 'utf-8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('brandReport replaces the title', () => {
  const html = brand('<html><head><title>Playwright Test Report</title></head><body></body></html>');
  expect(html).toContain('<title>Mobilewright Test Report</title>');
});

// The bundler picks the quoting of the JS-side document.title fallback, and a
// missed form lets the page rename itself back to "Playwright" once it loads.
for (const quote of ['\'', '"', '`']) {
  test(`brandReport replaces the document.title fallback quoted with ${quote}`, () => {
    const html = brand(
      `<html><head></head><body><script>document.title=${quote}Playwright Test Report${quote}</script></body></html>`,
    );
    expect(html).toContain(`document.title=${quote}Mobilewright Test Report${quote}`);
    expect(html).not.toContain('Playwright Test Report');
  });
}

// With `doNotInlineAssets` the bundle is written to report.js instead of being
// inlined, so the title fallback has to be rewritten there too.
test('brandReport replaces the document.title fallback in a non-inlined report.js', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mw-report-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<html><head></head><body></body></html>', 'utf-8');
    writeFileSync(join(dir, 'report.js'), 'x?0:document.title=`Playwright Test Report`;', 'utf-8');
    brandReport(dir);
    expect(readFileSync(join(dir, 'report.js'), 'utf-8')).toBe(
      'x?0:document.title=`Mobilewright Test Report`;',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
