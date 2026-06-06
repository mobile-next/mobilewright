import createDebug from 'debug';
import type { Bounds, WebViewSession } from '@mobilewright/protocol';
import type { StepFn } from './locator.js';
import { retryUntil } from './poll.js';
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
} from './playwright-engine.js';
import { buildExpectEvaluate, type FrameExpectParams, type ExpectResult } from './web-expect-matcher.js';

const DEFAULT_TIMEOUT = 5_000;

const debug = createDebug('mw:web-locator');

export class WebLocator {
  _stepFn: StepFn | null = null;

  constructor(
    protected readonly session: WebViewSession,
    // A Playwright selector string (e.g. 'internal:role=button[name="OK"i]' or a
    // raw CSS selector). Resolved in-page by the imported Playwright engine.
    protected readonly selector: string,
  ) {}

  // Build a WebLocator from a selector, carrying step instrumentation forward.
  private derive(selector: string): WebLocator {
    const loc = new WebLocator(this.session, selector);
    loc._stepFn = this._stepFn;
    return loc;
  }

  // Compose a child selector within this locator's scope, Playwright-style.
  private child(childSelector: string): WebLocator {
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

  private evalOnFirst<T = void>(body: string): Promise<T> {
    return this.session.evaluate<T>(this.firstElExpr(body));
  }

  // Run a mutating action against the first match. Throws in-page when the
  // element is absent so the action rejects instead of silently no-op'ing.
  private actOnFirst(action: string, what: string): Promise<void> {
    const notFound = JSON.stringify(`${what}: element not found`);
    return this.session.evaluate<void>(
      `(() => { const el = ${this.firstEl()}; if (!el) { throw new Error(${notFound}); } ${action} })()`,
    );
  }

  // Poll a boolean predicate, retrying until true or timeout. timeout 0 checks
  // once. Transient errors (missing element, mid-navigation) count as false, but
  // strict-mode violations propagate — matching Playwright's isVisible.
  private async pollBoolean(js: string, timeout: number, what: string): Promise<boolean> {
    const read = async (): Promise<boolean> => {
      try {
        return await this.session.evaluate<boolean>(js);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message.includes('strict mode violation')) { throw e; }
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
        `WebLocator: timed out waiting for element to be ${what}`,
      );
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes('strict mode violation')) { throw e; }
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
        const state = await this.session.evaluate<boolean | null>(js);
        if (state === null) { return false; }
        result = state;
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

  locator(selector: string): WebLocator {
    return this.child(selector);
  }

  getByRole(role: string, opts?: { name?: string | RegExp; exact?: boolean }): WebLocator {
    return this.child(getByRoleSelector(role, { name: opts?.name, exact: opts?.exact }));
  }

  getByText(text: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return this.child(getByTextSelector(text, { exact: opts?.exact }));
  }

  getByLabel(label: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return this.child(getByLabelSelector(label, { exact: opts?.exact }));
  }

  getByPlaceholder(text: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return this.child(getByPlaceholderSelector(text, { exact: opts?.exact }));
  }

  getByTestId(testId: string): WebLocator {
    return this.child(getByTestIdSelector(TEST_ID_ATTR, testId));
  }

  getByAltText(text: string | RegExp): WebLocator {
    return this.child(getByAltTextSelector(text));
  }

  getByTitle(text: string | RegExp): WebLocator {
    return this.child(getByTitleSelector(text));
  }

  // ─── Collection ──────────────────────────────────────────────

  first(): WebLocator {
    return this.nth(0);
  }

  last(): WebLocator {
    return this.nth(-1);
  }

  nth(index: number): WebLocator {
    return this.derive(`${this.selector} >> nth=${index}`);
  }

  async count(): Promise<number> {
    const sel = JSON.stringify(this.selector);
    return this.session.evaluate<number>(
      `window.__mwInjected.querySelectorAll(window.__mwInjected.parseSelector(${sel}), document).length`,
    );
  }

  // Aliases matching native Locator's API so LocatorAssertions works with WebLocator
  async getText(opts?: { timeout?: number }): Promise<string> {
    return this.textContent(opts);
  }

  async getValue(opts?: { timeout?: number }): Promise<string> {
    return this.inputValue(opts);
  }

  async all(): Promise<WebLocator[]> {
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
      `WebLocator: timed out waiting for state "${state}"`,
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
      () => this.session.evaluate<boolean>(
        `(async () => { const is = window.__mwInjected; const el = is.querySelector(is.parseSelector(${sel}), document, true); if (!el) { return false; } const missing = await is.checkElementStates(el, ${list}); return missing === undefined; })()`,
      ),
      (ready) => ready,
      timeout,
      'WebLocator: timed out waiting for element to be actionable',
    );
  }

  private async pollUntilVisible(timeout: number): Promise<void> {
    await retryUntil(
      () => this.isVisible({ timeout: 0 }),
      (v) => v,
      timeout,
      'WebLocator: timed out waiting for element to be visible',
    );
  }

  // Run Playwright's injected expect() matcher for this locator's selector and
  // return its raw verdict. The assertion layer (expect.ts) decides pass/fail
  // (pass = matches !== isNot) and handles retry/negation/messages.
  async _runInjectedExpect(params: FrameExpectParams): Promise<ExpectResult> {
    return this.session.evaluate<ExpectResult>(buildExpectEvaluate(this.selector, params));
  }

  // Default expect() timeout for assertions on this locator (none → fall back to
  // the assertion default). Present so LocatorAssertions-style timeout
  // resolution works uniformly across native and web locators.
  get expectTimeout(): number | undefined {
    return undefined;
  }
}
