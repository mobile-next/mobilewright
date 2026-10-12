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

// Defines the injected module and stashes a live InjectedScript instance on
// window. browserName is detected in-page so WKWebView is configured as webkit
// (not chromium).
function engineScript(): string {
  return `(() => {
    const module = {};
    ${INJECTED_SOURCE}
    const detectBrowserName = ${detectBrowserName.toString()};
    const options = Object.assign(${JSON.stringify(BOOTSTRAP_OPTIONS_BASE)}, { browserName: detectBrowserName(navigator.userAgent) });
    window.__mwInjected = new (module.exports.InjectedScript())(globalThis, options);
  })()`;
}

// Thrown in-page when an iframe needs the engine but its source was not sent yet.
export const FRAME_ENGINE_SOURCE_MISSING = 'mobilewright: engine source for iframes not loaded';

// A self-contained IIFE evaluated once per page (at Page.attach). It installs the
// engine on window so every later evaluate() can reference it without needing a
// JSHandle, plus the small frame helper that lets selectors cross into iframes.
// The whole script is one expression, because a webview bridge evaluates
// expressions.
export function bootstrapScript(): string {
  return `(() => { ${engineScript()}; (${installFrameScope.toString()})(window, ${JSON.stringify(FRAME_ENGINE_SOURCE_MISSING)}); })()`;
}

// Hands the frame helper the engine source it injects into iframes. Sent only
// the first time a selector enters an iframe (see evaluateWithEngine), so pages
// without iframes never pay for a second copy of the engine.
export function frameEngineSourceScript(): string {
  return `(() => { window.__mwEngineSource = ${JSON.stringify(engineScript())}; })()`;
}

// Playwright's marker for entering an iframe's document: frameLocator('#f')
// .locator('button') is the selector '#f >> internal:control=enter-frame >> button'.
export const ENTER_FRAME = ' >> internal:control=enter-frame >> ';

// Split a selector at its enter-frame markers into the iframe selectors on the
// path (outermost first) and the selector to run inside the innermost frame.
export function splitFrames(selector: string): { frames: string[]; selector: string } {
  const parts = selector.split(ENTER_FRAME);
  return { frames: parts.slice(0, -1), selector: parts[parts.length - 1] };
}

// The in-page objects the frame helper touches, typed structurally because this
// package compiles without the DOM lib.
interface FrameEngine {
  parseSelector(selector: string): unknown;
  querySelector(selector: unknown, root: unknown, strict: boolean): { contentWindow?: FrameWindow | null } | null;
}

interface FrameWindow {
  document: unknown;
  eval(source: string): unknown;
  __mwInjected?: FrameEngine;
  __mwEngineSource?: string;
  __mwFrameScope?: (frames: string[]) => { is: FrameEngine; doc: unknown } | null;
}

// Runs in the page (serialized into bootstrapScript), so it must not reference
// anything outside its own body. Installs window.__mwFrameScope(frames): walks
// from the top document into each iframe in turn — each iframe selector is
// resolved by the engine of the document that contains it — and returns the
// innermost frame's engine and document, or null when an iframe on the path is
// not in the DOM (yet). The engine is injected into a frame the first time it
// is entered, and again after that frame navigates. Cross-origin iframes cannot
// be scripted from the page, so entering one throws. `sourceMissing` is the
// message thrown when the engine source has not been sent yet.
export function installFrameScope(root: FrameWindow, sourceMissing: string): void {
  root.__mwFrameScope = (frames: string[]) => {
    let win: FrameWindow = root;
    for (const frameSelector of frames) {
      const is = win.__mwInjected!;
      const frame = is.querySelector(is.parseSelector(frameSelector), win.document, true);
      const next = frame?.contentWindow;
      if (!next) {
        return null;
      }
      try {
        void next.document;
      } catch {
        throw new Error(`mobilewright: cannot enter cross-origin iframe ${frameSelector}; only same-origin iframes are supported`);
      }
      if (!next.__mwInjected) {
        if (root.__mwEngineSource === undefined) {
          throw new Error(sourceMissing);
        }
        next.eval(root.__mwEngineSource);
        if (!next.__mwInjected) {
          throw new Error(`mobilewright: could not inject the engine into iframe ${frameSelector}`);
        }
      }
      win = next;
    }
    return { is: win.__mwInjected!, doc: win.document };
  };
}

// Build an in-page expression that runs `build` against the engine and document
// that own `selector`. `build` receives JS expressions for the engine and the
// document, and the JSON-quoted selector to resolve there. A main-document
// selector runs against window.__mwInjected and document directly; one that
// crosses iframes enters them through window.__mwFrameScope first, and evaluates
// to `frameMissing` when an iframe on the path is absent.
export function scopedEngineExpr(
  selector: string,
  build: (is: string, doc: string, sel: string) => string,
  frameMissing: string,
): string {
  const { frames, selector: inner } = splitFrames(selector);
  const sel = JSON.stringify(inner);
  if (frames.length === 0) {
    return build('window.__mwInjected', 'document', sel);
  }
  return `(() => { const f = window.__mwFrameScope(${JSON.stringify(frames)}); if (!f) { return ${frameMissing}; } return ${build('f.is', 'f.doc', sel)}; })()`;
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
    message.includes('__mwFrameScope') ||
    // Chromium: "Cannot read properties of undefined (reading 'querySelectorAll')"
    new RegExp(`undefined \\(reading '${ENGINE_METHODS}'\\)`).test(message) ||
    // WebKit: "undefined is not an object (evaluating 'is.querySelectorAll')"
    new RegExp(`undefined is not an object \\(evaluating '[^']*${ENGINE_METHODS}`).test(message)
  );
}

function isFrameEngineSourceMissing(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return message.includes(FRAME_ENGINE_SOURCE_MISSING);
}

// Evaluate an expression that depends on the injected engine, re-injecting the
// engine and retrying once if it has gone missing. Keeps engine-dependent calls
// resilient to page-initiated navigations without paying the re-inject cost
// unless the engine is actually gone. Likewise sends the engine source for
// iframes, once, when a selector first enters one.
export async function evaluateWithEngine<T = unknown>(
  session: WebViewSession,
  expr: string,
): Promise<T> {
  let reinjected = false;
  let sentFrameSource = false;
  while (true) {
    try {
      return await session.evaluate<T>(expr);
    } catch (e) {
      if (!reinjected && isEngineMissing(e)) {
        reinjected = true;
        await session.evaluate(bootstrapScript());
      } else if (!sentFrameSource && isFrameEngineSourceMissing(e)) {
        sentFrameSource = true;
        await session.evaluate(frameEngineSourceScript());
      } else {
        throw e;
      }
    }
  }
}
