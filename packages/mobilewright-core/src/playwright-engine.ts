// Sole module that reaches into playwright-core internals. playwright-core's
// package `exports` map blocks its internal subpaths, and as of 1.60.0 those
// internals are no longer separate requirable files at all — they're bundled
// into one opaque lib/coreBundle.js. So this file gets the two pieces it needs
// two different ways: INJECTED_SOURCE (the InjectedScript engine — large, and
// gets real fixes on every Playwright release) is auto-extracted from the
// installed playwright-core at install time, see
// scripts/sync-playwright-injected-script.mjs and ./generated/injected-script-source.ts.
// The selector-string builders (small, stable wire-format helpers) are
// hand-vendored in ./selector-builders.ts. Playwright is Apache-2.0 (see NOTICE).
import type { WebViewSession } from '@mobilewright/protocol';
import { INJECTED_SOURCE } from './generated/injected-script-source.js';
import {
  getByRoleSelector,
  getByTextSelector,
  getByLabelSelector,
  getByPlaceholderSelector,
  getByAltTextSelector,
  getByTitleSelector,
  getByTestIdSelector,
} from './selector-builders.js';

export { INJECTED_SOURCE };
export const TEST_ID_ATTR = 'data-testid';
export {
  getByRoleSelector,
  getByTextSelector,
  getByLabelSelector,
  getByPlaceholderSelector,
  getByAltTextSelector,
  getByTitleSelector,
  getByTestIdSelector,
};

// WKWebView's UA contains "AppleWebKit" without "Chrome/"; Android System
// WebView / Chromium contains "Chrome/". Pinning browserName makes Playwright's
// engine-specific branches behave correctly per webview engine.
export function detectBrowserName(userAgent: string): 'webkit' | 'chromium' {
  return /AppleWebKit/.test(userAgent) && !/Chrome\//.test(userAgent) ? 'webkit' : 'chromium';
}

// Options mirror what playwright-core passes when instantiating the engine.
// browserName is resolved in-page (see bootstrapScript) from the live UA.
const BOOTSTRAP_OPTIONS_BASE = {
  isUnderTest: false,
  sdkLanguage: 'javascript',
  testIdAttributeName: TEST_ID_ATTR,
  stableRafCount: 1,
  isUtilityWorld: false,
  customEngines: [],
};

// A self-contained IIFE evaluated once per page (at Page.attach). It defines the
// injected module and stashes a live InjectedScript instance on window so every
// later evaluate() can reference it without needing a JSHandle. browserName is
// detected in-page so WKWebView is configured as webkit (not chromium).
export function bootstrapScript(): string {
  return `(() => {
    const module = {};
    ${INJECTED_SOURCE}
    const detectBrowserName = ${detectBrowserName.toString()};
    const options = Object.assign(${JSON.stringify(BOOTSTRAP_OPTIONS_BASE)}, { browserName: detectBrowserName(navigator.userAgent) });
    window.__mwInjected = new (module.exports.InjectedScript())(globalThis, options);
  })()`;
}

// A page can replace its own document after we injected the engine (a
// client-side redirect or reload that mobilewright didn't initiate), which drops
// window.__mwInjected. The next engine call then throws "... of undefined
// (reading 'querySelector...')". Detect that so we can re-inject and retry.
const ENGINE_METHODS = '(querySelector|querySelectorAll|parseSelector|expect|elementState|checkElementStates)';

export function isEngineMissing(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return (
    message.includes('__mwInjected') ||
    // Chromium: "Cannot read properties of undefined (reading 'querySelectorAll')"
    new RegExp(`undefined \\(reading '${ENGINE_METHODS}'\\)`).test(message) ||
    // WebKit: "undefined is not an object (evaluating 'is.querySelectorAll')"
    new RegExp(`undefined is not an object \\(evaluating '[^']*${ENGINE_METHODS}`).test(message)
  );
}

// Evaluate an expression that depends on the injected engine, re-injecting the
// engine and retrying once if it has gone missing. Keeps engine-dependent calls
// resilient to page-initiated navigations without paying the re-inject cost
// unless the engine is actually gone.
export async function evaluateWithEngine<T = unknown>(
  session: WebViewSession,
  expr: string,
): Promise<T> {
  try {
    return await session.evaluate<T>(expr);
  } catch (e) {
    if (!isEngineMissing(e)) {
      throw e;
    }
    await session.evaluate(bootstrapScript());
    return session.evaluate<T>(expr);
  }
}
