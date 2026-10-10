import createDebug from 'debug';
import type { Locator } from '@playwright/test';
import type { Bounds, WebViewSession } from '@mobilewright/protocol';
import type { StepFn } from './locator.js';
import { retryUntil } from './poll.js';
import { sleep } from './sleep.js';
import { runStep } from './stackTrace.js';
import {
  getByRoleSelector,
  getByTextSelector,
  getByLabelSelector,
  getByPlaceholderSelector,
  getByAltTextSelector,
  getByTitleSelector,
  getByTestIdSelector,
  TEST_ID_ATTR,
  evaluateWithEngine,
} from './playwright-engine.js';
import { buildExpectEvaluate, missingElementVerdict, type FrameExpectParams, type ExpectResult, type ExpectedTextValue } from './web-expect-matcher.js';

const DEFAULT_TIMEOUT = 5_000;
const EXPECT_POLL_INTERVAL = 100;
// How long fill() waits for a tapped field to take keyboard focus, and how often it looks.
const FOCUS_TIMEOUT = 1_500;
const FOCUS_POLL_INTERVAL = 150;
// fill() types this many times before reporting that the text did not reach the field.
const FILL_ATTEMPTS = 2;

// Device-level input for a webview page: where the webview sits on screen, and
// native taps and typing. Present when the page comes from
// screen.getByWebView().page(); tap() and fill() use it to send real input.
export interface WebViewNativeInput {
  // The webview's bounds in the driver's screen coordinates.
  bounds(): Promise<Bounds>;
  tap(x: number, y: number): Promise<void>;
  typeText(text: string): Promise<void>;
}

// In-page body (with `el` bound to the element) that scrolls the element into
// view and returns its center in the top window's CSS pixels — adding the
// offsets of any iframes it sits in — plus the top window's CSS width, which
// maps CSS pixels onto the webview's native bounds.
export const SCREEN_POINT_BODY = `if (!el) { return null; }
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  let x = r.left + r.width / 2;
  let y = r.top + r.height / 2;
  let win = el.ownerDocument.defaultView;
  while (win && win !== window && win.frameElement) {
    const frame = win.frameElement;
    const f = frame.getBoundingClientRect();
    x += f.left + frame.clientLeft;
    y += f.top + frame.clientTop;
    win = win.parent;
  }
  return { x, y, viewportWidth: window.innerWidth };`;

// The options Playwright's web-first matchers pass to Locator._expect(), and the
// result shape they read back (see playwright/lib/matchers). Mirrors
// playwright-core's private contract (pinned to 1.58.2) so `expect()` from
// @playwright/test can drive a MobileWebViewLocator directly.
interface PlaywrightExpectOptions {
  isNot?: boolean;
  timeout?: number;
  expectedText?: ExpectedTextValue[];
  expectedNumber?: number;
  expectedValue?: unknown;
  expressionArg?: unknown;
}

interface PlaywrightExpectResult {
  matches: boolean;
  received?: unknown;
  timedOut: boolean;
}

const debug = createDebug('mw:web-locator');

// Playwright's injected engine throws this when a strict selector matches >1
// element. Detected by message text because it crosses the in-page boundary as
// a plain serialized error.
function isStrictModeViolation(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return message.includes('strict mode violation');
}

export class MobileWebViewLocator {
  // Playwright's web-first matchers gate on `receiver._apiName` (see expectTypes
  // in playwright/lib/matchers/expect.js), a plain instance property every real
  // Locator sets in its constructor. Report it so expect() from @playwright/test
  // accepts a MobileWebViewLocator.
  _apiName = 'Locator';
  _stepFn: StepFn | null = null;
  _nativeInput: WebViewNativeInput | null = null;

  constructor(
    protected readonly session: WebViewSession,
    // A Playwright selector string (e.g. 'internal:role=button[name="OK"i]' or a
    // raw CSS selector). Resolved in-page by the imported Playwright engine.
    protected readonly selector: string,
  ) {}

  // Build a MobileWebViewLocator from a selector, carrying step instrumentation forward.
  private derive(selector: string): MobileWebViewLocator {
    const loc = new MobileWebViewLocator(this.session, selector);
    loc._stepFn = this._stepFn;
    loc._nativeInput = this._nativeInput;
    return loc;
  }

  // Compose a child selector within this locator's scope, Playwright-style.
  private child(childSelector: string): MobileWebViewLocator {
    return this.derive(`${this.selector} >> ${childSelector}`);
  }

  private async _step<T>(title: string, fn: () => Promise<T>): Promise<T> {
    return runStep(this._stepFn, title, fn);
  }

  // JS expression resolving to the first match via the imported Playwright
  // engine. strict=true: a selector matching >1 element throws a strict-mode
  // violation in-page, matching Playwright's strict locators.
  private firstEl(): string {
    const sel = JSON.stringify(this.selector);
    return `window.__mwInjected.querySelector(window.__mwInjected.parseSelector(${sel}), document, true)`;
  }

  private firstElExpr(body: string): string {
    return `(() => { const el = ${this.firstEl()}; ${body} })()`;
  }

  // Every engine-dependent evaluate goes through here so it self-heals: if a
  // page-initiated navigation dropped window.__mwInjected, the engine is
  // re-injected and the call retried once.
  private evalEngine<T = void>(expr: string): Promise<T> {
    return evaluateWithEngine<T>(this.session, expr);
  }

  private evalOnFirst<T = void>(body: string): Promise<T> {
    return this.evalEngine<T>(this.firstElExpr(body));
  }

  // Run a mutating action against the first match. Throws in-page when the
  // element is absent so the action rejects instead of silently no-op'ing.
  private actOnFirst(action: string, what: string): Promise<void> {
    const notFound = JSON.stringify(`${what}: element not found`);
    return this.evalEngine<void>(
      `(() => { const el = ${this.firstEl()}; if (!el) { throw new Error(${notFound}); } ${action} })()`,
    );
  }

  // Poll a boolean predicate, retrying until true or timeout. timeout 0 checks
  // once. Transient errors (missing element, mid-navigation) count as false, but
  // strict-mode violations propagate — matching Playwright's isVisible.
  private async pollBoolean(js: string, timeout: number, what: string): Promise<boolean> {
    const read = async (): Promise<boolean> => {
      try {
        return await this.evalEngine<boolean>(js);
      } catch (e) {
        if (isStrictModeViolation(e)) { throw e; }
        const message = e instanceof Error ? e.message : String(e);
        debug('"%s" check evaluation failed, treating as false: %s', what, message);
        return false;
      }
    };
    if (timeout === 0) {
      return read();
    }
    try {
      let result = false;
      await retryUntil(
        async () => { result = await read(); return result; },
        (v) => v,
        timeout,
        `MobileWebViewLocator: timed out waiting for element to be ${what}`,
      );
      return result;
    } catch (e) {
      if (isStrictModeViolation(e)) { throw e; }
      return false;
    }
  }

  // Resolve the element (waiting up to timeout) and read an injected element
  // state. Throws "<what>: element not found" when no element resolves —
  // matching Playwright's isEnabled/isChecked, which require an attached element.
  private async readElementState(state: 'enabled' | 'checked', timeout: number, what: string): Promise<boolean> {
    const sel = JSON.stringify(this.selector);
    const stateArg = JSON.stringify(state);
    const js = `(() => { const is = window.__mwInjected; const el = is.querySelector(is.parseSelector(${sel}), document, true); if (!el) { return null; } return is.elementState(el, ${stateArg}).matches; })()`;
    let result = false;
    await retryUntil(
      async () => {
        const matches = await this.evalEngine<boolean | null>(js);
        if (matches === null) { return false; }
        result = matches;
        return true;
      },
      (found) => found,
      timeout,
      `${what}: element not found`,
    );
    return result;
  }

  // Wait for the element to be visible, then return a value read from it.
  private async readFromFirst<T>(valueExpr: string, opts?: { timeout?: number }): Promise<T> {
    await this.pollUntilVisible(opts?.timeout ?? DEFAULT_TIMEOUT);
    return this.evalOnFirst<T>(`return ${valueExpr};`);
  }

  private async readStringProp(prop: string, opts?: { timeout?: number }): Promise<string> {
    return this.readFromFirst<string>(`el?.${prop} ?? ''`, opts);
  }

  // ─── Chaining ────────────────────────────────────────────────

  locator(selector: string): MobileWebViewLocator {
    return this.child(selector);
  }

  getByRole(role: string, opts?: { name?: string | RegExp; exact?: boolean }): MobileWebViewLocator {
    return this.child(getByRoleSelector(role, { name: opts?.name, exact: opts?.exact }));
  }

  getByText(text: string | RegExp, opts?: { exact?: boolean }): MobileWebViewLocator {
    return this.child(getByTextSelector(text, { exact: opts?.exact }));
  }

  getByLabel(label: string | RegExp, opts?: { exact?: boolean }): MobileWebViewLocator {
    return this.child(getByLabelSelector(label, { exact: opts?.exact }));
  }

  getByPlaceholder(text: string | RegExp, opts?: { exact?: boolean }): MobileWebViewLocator {
    return this.child(getByPlaceholderSelector(text, { exact: opts?.exact }));
  }

  getByTestId(testId: string): MobileWebViewLocator {
    return this.child(getByTestIdSelector(TEST_ID_ATTR, testId));
  }

  getByAltText(text: string | RegExp): MobileWebViewLocator {
    return this.child(getByAltTextSelector(text));
  }

  getByTitle(text: string | RegExp): MobileWebViewLocator {
    return this.child(getByTitleSelector(text));
  }

  // ─── Collection ──────────────────────────────────────────────

  first(): MobileWebViewLocator {
    return this.nth(0);
  }

  last(): MobileWebViewLocator {
    return this.nth(-1);
  }

  nth(index: number): MobileWebViewLocator {
    return this.derive(`${this.selector} >> nth=${index}`);
  }

  async count(): Promise<number> {
    const sel = JSON.stringify(this.selector);
    return this.evalEngine<number>(
      `window.__mwInjected.querySelectorAll(window.__mwInjected.parseSelector(${sel}), document).length`,
    );
  }

  // Aliases matching native Locator's API so LocatorAssertions works with MobileWebViewLocator
  async getText(opts?: { timeout?: number }): Promise<string> {
    return this.textContent(opts);
  }

  async getValue(opts?: { timeout?: number }): Promise<string> {
    return this.inputValue(opts);
  }

  async all(): Promise<MobileWebViewLocator[]> {
    const n = await this.count();
    return Array.from({ length: n }, (_, i) => this.nth(i));
  }

  // ─── State queries ───────────────────────────────────────────

  async isVisible(opts?: { timeout?: number }): Promise<boolean> {
    const sel = JSON.stringify(this.selector);
    const js = `(() => { const is = window.__mwInjected; const el = is.querySelector(is.parseSelector(${sel}), document, true); if (!el) { return false; } return is.elementState(el, 'visible').matches; })()`;
    return this.pollBoolean(js, opts?.timeout ?? DEFAULT_TIMEOUT, 'visible');
  }

  async isHidden(opts?: { timeout?: number }): Promise<boolean> {
    const visible = await this.isVisible({ timeout: opts?.timeout ?? 0 });
    return !visible;
  }

  async isEnabled(opts?: { timeout?: number }): Promise<boolean> {
    return this.readElementState('enabled', opts?.timeout ?? 0, 'locator.isEnabled()');
  }

  async isDisabled(opts?: { timeout?: number }): Promise<boolean> {
    const enabled = await this.isEnabled(opts);
    return !enabled;
  }

  async isChecked(opts?: { timeout?: number }): Promise<boolean> {
    return this.readElementState('checked', opts?.timeout ?? 0, 'locator.isChecked()');
  }

  // ─── Value queries ───────────────────────────────────────────

  async textContent(opts?: { timeout?: number }): Promise<string> {
    return this.readStringProp('textContent', opts);
  }

  async innerText(opts?: { timeout?: number }): Promise<string> {
    return this.readStringProp('innerText', opts);
  }

  async innerHTML(opts?: { timeout?: number }): Promise<string> {
    return this.readStringProp('innerHTML', opts);
  }

  async inputValue(opts?: { timeout?: number }): Promise<string> {
    return this.readStringProp('value', opts);
  }

  async getAttribute(name: string, opts?: { timeout?: number }): Promise<string | null> {
    return this.readFromFirst<string | null>(`el ? el.getAttribute(${JSON.stringify(name)}) : null`, opts);
  }

  async boundingBox(opts?: { timeout?: number }): Promise<Bounds | null> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
    await this.pollUntilVisible(timeout);
    return this.evalOnFirst<Bounds | null>(
      'if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height };',
    );
  }

  async waitFor(opts?: { state?: 'visible' | 'hidden' | 'attached' | 'detached'; timeout?: number }): Promise<void> {
    const state = opts?.state ?? 'visible';
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
    await retryUntil(
      async () => {
        const n = await this.count();
        const visible = n > 0 && await this.isVisible({ timeout: 0 });
        switch (state) {
          case 'visible': return visible;
          case 'hidden': return !visible;
          case 'attached': return n > 0;
          case 'detached': return n === 0;
        }
      },
      (result) => result,
      timeout,
      `MobileWebViewLocator: timed out waiting for state "${state}"`,
    );
  }

  // ─── Actions ─────────────────────────────────────────────────

  // A real touch: a native tap at the element's on-screen center, so the page
  // gets trusted touch, pointer and click events. Needs a page from
  // screen.getByWebView().page(); click() stays a synthetic el.click().
  async tap(opts?: { timeout?: number }): Promise<void> {
    return this._step('locator.tap()', () => this.nativeTap(opts?.timeout ?? DEFAULT_TIMEOUT));
  }

  async click(opts?: { timeout?: number }): Promise<void> {
    return this._step('locator.click()', async () => {
      await this.pollActionable(['visible', 'enabled'], opts?.timeout ?? DEFAULT_TIMEOUT);
      await this.actOnFirst('el.click();', 'locator.click()');
    });
  }

  // With device input (a page from screen.getByWebView().page()), fill() is real
  // input: it taps the field, clears it and types through the device keyboard,
  // so the page gets genuine key and input events, then checks that the text
  // arrived and types it once more if not. `verify: false` types once and skips
  // that check, for fields that act as soon as they are full (e.g. a one-time
  // code input that submits itself), where a second pass would do harm.
  // Without device input, fill() sets the value in-page.
  async fill(text: string, opts?: { timeout?: number; verify?: boolean }): Promise<void> {
    return this._step(`locator.fill(${JSON.stringify(text)})`, async () => {
      if (this._nativeInput) {
        await this.nativeFill(this._nativeInput, text, opts?.timeout ?? DEFAULT_TIMEOUT, opts?.verify ?? true);
        return;
      }
      await this.pollUntilVisible(opts?.timeout ?? DEFAULT_TIMEOUT);
      await this.actOnFirst(`el.focus(); el.value = ''; el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));`, 'locator.fill()');
    });
  }

  async type(text: string): Promise<void> {
    return this._step(`locator.type(${JSON.stringify(text)})`, async () => {
      await this.pollUntilVisible(DEFAULT_TIMEOUT);
      await this.actOnFirst(`el.focus(); el.value = (el.value || '') + ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true }));`, 'locator.type()');
    });
  }

  async press(key: string): Promise<void> {
    return this._step(`locator.press(${JSON.stringify(key)})`, async () => {
      await this.actOnFirst(`['keydown','keypress','keyup'].forEach(t => el.dispatchEvent(new KeyboardEvent(t, { key: ${JSON.stringify(key)}, bubbles: true })));`, 'locator.press()');
    });
  }

  async focus(): Promise<void> {
    return this._step('locator.focus()', async () => {
      await this.actOnFirst('el.focus();', 'locator.focus()');
    });
  }

  async hover(): Promise<void> {
    return this._step('locator.hover()', async () => {
      await this.pollUntilVisible(DEFAULT_TIMEOUT);
      await this.actOnFirst('el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));', 'locator.hover()');
    });
  }

  async scrollIntoViewIfNeeded(): Promise<void> {
    return this._step('locator.scrollIntoViewIfNeeded()', async () => {
      await this.actOnFirst('el.scrollIntoView({ block: "nearest" });', 'locator.scrollIntoViewIfNeeded()');
    });
  }

  // ─── Private helpers ─────────────────────────────────────────

  private requireNativeInput(what: string): WebViewNativeInput {
    if (!this._nativeInput) {
      throw new Error(`${what}: a real touch needs the page from screen.getByWebView().page(); use click() for a synthetic click`);
    }
    return this._nativeInput;
  }

  // Tap the element's on-screen center natively, once it is visible, enabled
  // and not moving. The CSS point is scaled by the webview's native width over
  // its CSS viewport width.
  private async nativeTap(timeout: number): Promise<void> {
    const native = this.requireNativeInput('locator.tap()');
    await this.pollActionable(['visible', 'enabled', 'stable'], timeout);
    const point = await this.evalOnFirst<{ x: number; y: number; viewportWidth: number } | null>(SCREEN_POINT_BODY);
    if (!point) {
      throw new Error('locator.tap(): element not found');
    }
    const box = await native.bounds();
    const scale = box.width / point.viewportWidth;
    await native.tap(Math.round(box.x + point.x * scale), Math.round(box.y + point.y * scale));
  }

  private async hasFocus(): Promise<boolean> {
    const deadline = Date.now() + FOCUS_TIMEOUT;
    while (true) {
      const focused = await this.evalOnFirst<boolean>('return !!el && el.ownerDocument.activeElement === el;').catch(() => false);
      if (focused || Date.now() >= deadline) {
        return focused;
      }
      await sleep(FOCUS_POLL_INTERVAL);
    }
  }

  // Tap the field, clear it in-page, and type through the device keyboard. A
  // slow device can drop keys typed before the field has keyboard focus, so
  // wait for focus (tapping once more if it does not come), and check the value
  // afterwards.
  private async nativeFill(native: WebViewNativeInput, text: string, timeout: number, verify: boolean): Promise<void> {
    const readValue = (): Promise<string | null> =>
      this.evalOnFirst<string | null>('return el ? String(el.value ?? \'\') : null;').catch(() => null);
    for (let attempt = 1; attempt <= FILL_ATTEMPTS; attempt++) {
      await this.nativeTap(timeout);
      if (!(await this.hasFocus())) {
        await this.nativeTap(timeout);
        await this.hasFocus();
      }
      await this.actOnFirst('if (el.value) { el.value = \'\'; el.dispatchEvent(new Event(\'input\', { bubbles: true })); }', 'locator.fill()');
      await native.typeText(text);
      if (!verify || (await readValue()) === text) {
        return;
      }
    }
    const value = await readValue();
    const holds = value == null ? 'nothing readable' : `${value.length} of ${text.length} characters`;
    throw new Error(`locator.fill(): the typed text did not reach the field after ${FILL_ATTEMPTS} attempts (it holds ${holds})`);
  }

  // Poll Playwright's own checkElementStates until the element satisfies all the
  // given states (it returns undefined when they all pass). Used by click to
  // gate on visible+enabled before a synthetic dispatch (slice-1 behavior).
  private async pollActionable(states: string[], timeout: number): Promise<void> {
    const sel = JSON.stringify(this.selector);
    const list = JSON.stringify(states);
    await retryUntil(
      () => this.evalEngine<boolean>(
        `(async () => { const is = window.__mwInjected; const el = is.querySelector(is.parseSelector(${sel}), document, true); if (!el) { return false; } const missing = await is.checkElementStates(el, ${list}); return missing === undefined; })()`,
      ),
      (ready) => ready,
      timeout,
      'MobileWebViewLocator: timed out waiting for element to be actionable',
    );
  }

  private async pollUntilVisible(timeout: number): Promise<void> {
    await retryUntil(
      () => this.isVisible({ timeout: 0 }),
      (v) => v,
      timeout,
      'MobileWebViewLocator: timed out waiting for element to be visible',
    );
  }

  // Run Playwright's injected expect() matcher for this locator's selector and
  // return its raw verdict. The assertion layer (expect.ts) decides pass/fail
  // (pass = matches !== isNot) and handles retry/negation/messages.
  async _runInjectedExpect(params: FrameExpectParams): Promise<ExpectResult> {
    const verdict = await this.evalEngine<ExpectResult | null>(buildExpectEvaluate(this.selector, params));
    return verdict ?? missingElementVerdict(params);
  }

  // The private hook Playwright's web-first matchers call: expect(locator).toBeX()
  // dispatches to locator._expect(expression, options). We run the same injected
  // matcher we already use, polling until the expectation holds (matches !== isNot)
  // or the timeout elapses, and return the { matches, received, timedOut } shape
  // the matchers read back. This makes `expect()` from @playwright/test drive a
  // MobileWebViewLocator with no mobilewright-specific assertion API.
  async _expect(expression: string, options: PlaywrightExpectOptions): Promise<PlaywrightExpectResult> {
    const isNot = options.isNot ?? false;
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const deadline = Date.now() + timeout;
    let lastMatches = false;
    let received: unknown;

    const check = async (): Promise<boolean> => {
      const result = await this._runInjectedExpect({
        expression,
        expressionArg: options.expressionArg,
        expectedText: options.expectedText,
        expectedNumber: options.expectedNumber,
        expectedValue: options.expectedValue,
        isNot,
        timeout: 0,
      });
      // The injected matcher can hand back a non-boolean verdict (e.g. no element
      // matched the selector yet). Coerce to a strict boolean so a stray undefined
      // never leaks back to Playwright as pass: undefined ("Unexpected return from
      // a matcher function"); treat anything but true as not-matched and keep polling.
      lastMatches = result.matches === true;
      received = result.received;
      return lastMatches !== isNot;
    };

    let reached = await check();
    while (!reached && Date.now() < deadline) {
      await sleep(EXPECT_POLL_INTERVAL);
      reached = await check();
    }
    return { matches: lastMatches, received, timedOut: !reached };
  }

  // Default expect() timeout for assertions on this locator (none → fall back to
  // the assertion default). Present so LocatorAssertions-style timeout
  // resolution works uniformly across native and web locators.
  get expectTimeout(): number | undefined {
    return undefined;
  }
}

// The actual expect() gate is _apiName (set above); this rename only affects
// constructor.name, which Playwright still uses when printing an unrecognized
// receiver in its error message. Keep it so those messages read naturally,
// while the exported class name stays distinct for our own code.
Object.defineProperty(MobileWebViewLocator, 'name', { value: 'Locator', configurable: true });

// Declaration-merge the rest of Playwright's Locator surface in as ambient: the
// members we implement above are signature-checked against it; the rest are
// typed as present (so the object is a drop-in Playwright Locator) and throw a
// TypeError at runtime if called, since a webview can't support them.
export interface MobileWebViewLocator extends Locator {}

// Back-compat alias for internal callers that still import WebLocator.
export { MobileWebViewLocator as WebLocator };
