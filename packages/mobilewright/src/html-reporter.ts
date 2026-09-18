/**
 * Playwright's HTML reporter, rebranded for Mobilewright.
 *
 * - Reports default to `mobilewright-report` instead of `playwright-report`
 * - The generated HTML is rebranded once the report is written
 * - The "To open last HTML report run" hint points at the mobilewright CLI
 */

import { createRequire } from 'node:module';

import { resolve } from 'node:path';

import { HTML_REPORT_DIR } from './constants.js';
import { brandReport } from './reporter.js';

const _require = createRequire(import.meta.url);

interface HtmlReporterLike {
  /** Absolute output folder, resolved by the base reporter in `onBegin`. */
  _outputFolder?: string;
  onExit(): Promise<void>;
}

const { html } = _require('playwright/lib/runner') as {
  html: { default: new (options: Record<string, unknown>) => HtmlReporterLike };
};

export default class MobilewrightHtmlReporter extends html.default {
  constructor(options: Record<string, unknown> = {}) {
    super({ outputFolder: HTML_REPORT_DIR, ...options });
  }

  override async onExit(): Promise<void> {
    try {
      brandReport(this._outputFolder ?? resolve(process.cwd(), HTML_REPORT_DIR));
    } catch {
      // Branding is best-effort — never fail a run over it.
    }

    // The hint is printed straight to stdout from a private helper, so the
    // only way to rebrand it is to rewrite the bytes while it is written.
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) =>
      (write as (...args: unknown[]) => boolean)(
        typeof chunk === 'string' ? chunk.replace('playwright show-report', 'mobilewright show-report') : chunk,
        ...rest,
      )) as typeof process.stdout.write;
    try {
      await super.onExit();
    } finally {
      process.stdout.write = write;
    }
  }
}
