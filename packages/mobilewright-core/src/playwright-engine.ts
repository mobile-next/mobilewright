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

// Options mirror what playwright-core passes when instantiating the engine.
// browserName 'chromium' is correct for Android System WebView; per-platform
// selection (iOS WKWebView → 'webkit') is a later slice.
const BOOTSTRAP_OPTIONS = {
  isUnderTest: false,
  sdkLanguage: 'javascript',
  testIdAttributeName: 'data-testid',
  stableRafCount: 1,
  browserName: 'chromium',
  isUtilityWorld: false,
  customEngines: [],
};

// A self-contained IIFE evaluated once per page (at Page.attach). It defines the
// injected module and stashes a live InjectedScript instance on window so every
// later evaluate() can reference it without needing a JSHandle.
export function bootstrapScript(): string {
  return `(() => {
    const module = {};
    ${INJECTED_SOURCE}
    window.__mwInjected = new (module.exports.InjectedScript())(globalThis, ${JSON.stringify(BOOTSTRAP_OPTIONS)});
  })();`;
}
