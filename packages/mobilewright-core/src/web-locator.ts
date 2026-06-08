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
import { buildExpectEvaluate, type FrameExpectParams, type ExpectResult, type ExpectedTextValue } from './web-expect-matcher.js';

const DEFAULT_TIMEOUT = 5_000;
const EXPECT_POLL_INTERVAL = 100;

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
  _stepFn: StepFn | null = null;

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

  async click(opts?: { timeout?: number }): Promise<void> {
    return this._step('locator.click()', async () => {
      await this.pollActionable(['visible', 'enabled'], opts?.timeout ?? DEFAULT_TIMEOUT);
      await this.actOnFirst('el.click();', 'locator.click()');
    });
  }

  async fill(text: string, opts?: { timeout?: number }): Promise<void> {
    return this._step(`locator.fill(${JSON.stringify(text)})`, async () => {
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
    return this.evalEngine<ExpectResult>(buildExpectEvaluate(this.selector, params));
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
      lastMatches = result.matches;
      received = result.received;
      return result.matches !== isNot;
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

// Playwright's web-first matchers gate on `receiver.constructor.name === 'Locator'`
// (see expectTypes in playwright/lib/util). Report that name so expect() from
// @playwright/test accepts a MobileWebViewLocator, while the exported class name stays
// distinct for our own code.
Object.defineProperty(MobileWebViewLocator, 'name', { value: 'Locator', configurable: true });

// Declaration-merge the rest of Playwright's Locator surface in as ambient: the
// members we implement above are signature-checked against it; the rest are
// typed as present (so the object is a drop-in Playwright Locator) and throw a
// TypeError at runtime if called, since a webview can't support them.
export interface MobileWebViewLocator extends Locator {}

// Back-compat alias for internal callers that still import WebLocator.
export { MobileWebViewLocator as WebLocator };
