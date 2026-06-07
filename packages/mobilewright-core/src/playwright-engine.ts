// Sole module that reaches into playwright-core internals. Playwright's package
// `exports` map blocks these subpaths, so we resolve the package root and
// require the files by absolute path (an absolute require bypasses `exports`).
// Pinned to playwright-core@1.58.2 — if a future bump moves these paths, only
// this file breaks. Playwright is Apache-2.0 (see NOTICE).
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

type GetByRoleSelector = (
  role: string,
  options?: { name?: string | RegExp; exact?: boolean },
) => string;

const require = createRequire(import.meta.url);
const pkgRoot = dirname(require.resolve('playwright-core/package.json'));

type TextBuilder = (value: string | RegExp, options?: { exact?: boolean }) => string;

const injected = require(join(pkgRoot, 'lib/generated/injectedScriptSource.js')) as { source: string };
const locatorUtils = require(join(pkgRoot, 'lib/utils/isomorphic/locatorUtils.js')) as {
  getByRoleSelector: GetByRoleSelector;
  getByTextSelector: TextBuilder;
  getByLabelSelector: TextBuilder;
  getByPlaceholderSelector: TextBuilder;
  getByAltTextSelector: TextBuilder;
  getByTitleSelector: TextBuilder;
  getByTestIdSelector: (attrName: string, value: string | RegExp) => string;
};

export const INJECTED_SOURCE: string = injected.source;
export const TEST_ID_ATTR = 'data-testid';
export const getByRoleSelector: GetByRoleSelector = locatorUtils.getByRoleSelector;
export const getByTextSelector: TextBuilder = locatorUtils.getByTextSelector;
export const getByLabelSelector: TextBuilder = locatorUtils.getByLabelSelector;
export const getByPlaceholderSelector: TextBuilder = locatorUtils.getByPlaceholderSelector;
export const getByAltTextSelector: TextBuilder = locatorUtils.getByAltTextSelector;
export const getByTitleSelector: TextBuilder = locatorUtils.getByTitleSelector;
export const getByTestIdSelector = locatorUtils.getByTestIdSelector;

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
