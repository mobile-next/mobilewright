import createDebug from 'debug';
import type { Bounds, WebViewSession } from '@mobilewright/protocol';
import type { StepFn } from './locator.js';
import { retryUntil } from './poll.js';
import { runStep } from './stackTrace.js';

const DEFAULT_TIMEOUT = 5_000;

const debug = createDebug('mw:web-locator');

export type WebLocatorStrategy =
  | { kind: 'css'; selector: string }
  | { kind: 'role'; role: string; name?: string | RegExp; exact?: boolean }
  | { kind: 'text'; text: string | RegExp; exact?: boolean }
  | { kind: 'label'; label: string | RegExp; exact?: boolean }
  | { kind: 'placeholder'; text: string | RegExp; exact?: boolean }
  | { kind: 'testId'; testId: string }
  | { kind: 'altText'; text: string | RegExp; exact?: boolean }
  | { kind: 'title'; text: string | RegExp; exact?: boolean }
  | { kind: 'nth'; parent: WebLocatorStrategy; index: number }
  | { kind: 'chain'; parent: WebLocatorStrategy; child: WebLocatorStrategy };

// Serialise a string-or-RegExp value to a JS expression fragment.
// RegExps become their literal form (/pat/flags); strings become JSON.
function serializeTextArg(value: string | RegExp): string {
  return value instanceof RegExp ? value.toString() : JSON.stringify(value);
}

// Builds a JS expression (usable in session.evaluate) that evaluates to an
// array of DOM elements matching the strategy, searched within `root` (a JS
// expression for the scope, defaulting to the whole document). Delegates to
// window.__mw.* helpers injected by DOM_SELECTOR_ENGINE.
function buildFindAll(strategy: WebLocatorStrategy, root: string = 'document'): string {
  switch (strategy.kind) {
    case 'css':
      return `Array.from(${root}.querySelectorAll(${JSON.stringify(strategy.selector)}))`;

    case 'testId':
      return `Array.from(${root}.querySelectorAll('[data-testid=${JSON.stringify(strategy.testId)}]'))`;

    case 'role': {
      const nameArg = strategy.name === undefined ? 'undefined' : serializeTextArg(strategy.name);
      const exactArg = strategy.exact === true ? 'true' : 'false';
      return `window.__mw.findByRole(${root}, ${JSON.stringify(strategy.role)}, ${nameArg}, ${exactArg})`;
    }

    case 'text':
      return `window.__mw.findByText(${root}, ${serializeTextArg(strategy.text)}, ${strategy.exact === true})`;

    case 'label':
      return `window.__mw.findByLabel(${root}, ${serializeTextArg(strategy.label)}, ${strategy.exact === true})`;

    case 'placeholder':
      return `window.__mw.findByAttr(${root}, 'placeholder', ${serializeTextArg(strategy.text)}, ${strategy.exact === true})`;

    case 'altText':
      return `window.__mw.findByAttr(${root}, 'alt', ${serializeTextArg(strategy.text)}, ${strategy.exact === true})`;

    case 'title':
      return `window.__mw.findByAttr(${root}, 'title', ${serializeTextArg(strategy.text)}, ${strategy.exact === true})`;

    case 'nth': {
      const all = buildFindAll(strategy.parent, root);
      return `(arr => { const i = ${strategy.index} < 0 ? arr.length + ${strategy.index} : ${strategy.index}; return i >= 0 && i < arr.length ? [arr[i]] : []; })(${all})`;
    }

    case 'chain': {
      // Scope the child query within each parent match, then flatten and
      // de-duplicate (a node nested under two matched parents appears once).
      const parents = buildFindAll(strategy.parent, root);
      const childOf = buildFindAll(strategy.child, 'p');
      return `[...new Set((${parents}).flatMap(p => ${childOf}))]`;
    }
  }
}

export class WebLocator {
  _stepFn: StepFn | null = null;

  constructor(
    protected readonly session: WebViewSession,
    protected readonly strategy: WebLocatorStrategy,
  ) {}

  // Build a WebLocator from a strategy, carrying step instrumentation forward.
  private derive(strategy: WebLocatorStrategy): WebLocator {
    const loc = new WebLocator(this.session, strategy);
    loc._stepFn = this._stepFn;
    return loc;
  }

  // Build a child WebLocator scoped within this locator's matches by composing
  // the current strategy with the incoming one, so the query stays scoped.
  private child(strategy: WebLocatorStrategy): WebLocator {
    return this.derive({ kind: 'chain', parent: this.strategy, child: strategy });
  }

  private async _step<T>(title: string, fn: () => Promise<T>): Promise<T> {
    return runStep(this._stepFn, title, fn);
  }

  // JS expression evaluating to the first matched element (or undefined).
  private firstEl(): string {
    return `(${buildFindAll(this.strategy)})[0]`;
  }

  // Wrap a statement list in an IIFE with `el` bound to the first match.
  // Use a `return` inside `body` to produce a value.
  private firstElExpr(body: string): string {
    return `(() => { const el = ${this.firstEl()}; ${body} })()`;
  }

  // Evaluate `firstElExpr(body)` in the page and return its result.
  private evalOnFirst<T = void>(body: string): Promise<T> {
    return this.session.evaluate<T>(this.firstElExpr(body));
  }

  // Evaluate a boolean predicate against the first matched element, retrying
  // until it is true or the timeout elapses. A timeout of 0 checks once.
  // An evaluation error is treated as false (the element is absent or the page
  // is mid-navigation) but logged via debug so genuine failures stay diagnosable.
  private async pollBoolean(js: string, timeout: number, what: string): Promise<boolean> {
    const read = async (): Promise<boolean> => {
      try {
        return await this.session.evaluate<boolean>(js);
      } catch (e) {
        debug('"%s" check evaluation failed, treating as false: %s', what, e instanceof Error ? e.message : e);
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
    } catch {
      return false;
    }
  }

  // Wait for the element to be visible, then return a value read from it.
  // `valueExpr` is a JS expression evaluated with `el` bound to the first match.
  private async readFromFirst<T>(valueExpr: string, opts?: { timeout?: number }): Promise<T> {
    await this.pollUntilVisible(opts?.timeout ?? DEFAULT_TIMEOUT);
    return this.evalOnFirst<T>(`return ${valueExpr};`);
  }

  // Read a string property (textContent/innerText/...) from the first match,
  // defaulting to '' when the element or property is absent.
  private async readStringProp(prop: string, opts?: { timeout?: number }): Promise<string> {
    return this.readFromFirst<string>(`el?.${prop} ?? ''`, opts);
  }

  // ─── Chaining ────────────────────────────────────────────────

  locator(selector: string): WebLocator {
    return this.child({ kind: 'css', selector });
  }

  getByRole(role: string, opts?: { name?: string | RegExp; exact?: boolean }): WebLocator {
    return this.child({ kind: 'role', role, name: opts?.name, exact: opts?.exact });
  }

  getByText(text: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return this.child({ kind: 'text', text, exact: opts?.exact });
  }

  getByLabel(label: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return this.child({ kind: 'label', label, exact: opts?.exact });
  }

  getByPlaceholder(text: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return this.child({ kind: 'placeholder', text, exact: opts?.exact });
  }

  getByTestId(testId: string): WebLocator {
    return this.child({ kind: 'testId', testId });
  }

  getByAltText(text: string | RegExp): WebLocator {
    return this.child({ kind: 'altText', text });
  }

  getByTitle(text: string | RegExp): WebLocator {
    return this.child({ kind: 'title', text });
  }

  // ─── Collection ──────────────────────────────────────────────

  first(): WebLocator {
    return this.nth(0);
  }

  last(): WebLocator {
    return this.nth(-1);
  }

  nth(index: number): WebLocator {
    // nth already references this.strategy as its parent, so derive directly
    // rather than going through child() (which would re-wrap the parent).
    return this.derive({ kind: 'nth', parent: this.strategy, index });
  }

  async count(): Promise<number> {
    return this.session.evaluate<number>(`(${buildFindAll(this.strategy)}).length`);
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
    const js = this.firstElExpr('if (!el) return false; const s = window.getComputedStyle(el); return s.display !== "none" && s.visibility !== "hidden";');
    return this.pollBoolean(js, opts?.timeout ?? DEFAULT_TIMEOUT, 'visible');
  }

  async isHidden(opts?: { timeout?: number }): Promise<boolean> {
    const visible = await this.isVisible({ timeout: opts?.timeout ?? 0 });
    return !visible;
  }

  async isEnabled(opts?: { timeout?: number }): Promise<boolean> {
    const js = this.firstElExpr('return !!el && !el.disabled;');
    return this.pollBoolean(js, opts?.timeout ?? 0, 'enabled');
  }

  async isDisabled(opts?: { timeout?: number }): Promise<boolean> {
    return !(await this.isEnabled(opts));
  }

  async isChecked(opts?: { timeout?: number }): Promise<boolean> {
    const js = this.firstElExpr('return !!el && (el.checked === true || el.getAttribute("aria-checked") === "true");');
    return this.pollBoolean(js, opts?.timeout ?? 0, 'checked');
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
      await this.pollUntilVisible(opts?.timeout ?? DEFAULT_TIMEOUT);
      await this.session.evaluate(`${this.firstEl()}?.click()`);
    });
  }

  async fill(text: string, opts?: { timeout?: number }): Promise<void> {
    return this._step(`locator.fill(${JSON.stringify(text)})`, async () => {
      await this.pollUntilVisible(opts?.timeout ?? DEFAULT_TIMEOUT);
      await this.evalOnFirst(`if (el) { el.focus(); el.value = ''; el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }`);
    });
  }

  async type(text: string): Promise<void> {
    return this._step(`locator.type(${JSON.stringify(text)})`, async () => {
      await this.pollUntilVisible(DEFAULT_TIMEOUT);
      await this.evalOnFirst(`if (el) { el.focus(); el.value = (el.value || '') + ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); }`);
    });
  }

  async press(key: string): Promise<void> {
    return this._step(`locator.press(${JSON.stringify(key)})`, async () => {
      await this.evalOnFirst(`if (el) { ['keydown','keypress','keyup'].forEach(t => el.dispatchEvent(new KeyboardEvent(t, { key: ${JSON.stringify(key)}, bubbles: true }))); }`);
    });
  }

  async focus(): Promise<void> {
    return this._step('locator.focus()', async () => {
      await this.session.evaluate(`${this.firstEl()}?.focus()`);
    });
  }

  async hover(): Promise<void> {
    return this._step('locator.hover()', async () => {
      await this.evalOnFirst('if (el) { el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true })); }');
    });
  }

  async scrollIntoViewIfNeeded(): Promise<void> {
    return this._step('locator.scrollIntoViewIfNeeded()', async () => {
      await this.session.evaluate(`${this.firstEl()}?.scrollIntoView({ block: 'nearest' })`);
    });
  }

  // ─── Private helpers ─────────────────────────────────────────

  private async pollUntilVisible(timeout: number): Promise<void> {
    await retryUntil(
      () => this.isVisible({ timeout: 0 }),
      (v) => v,
      timeout,
      'WebLocator: timed out waiting for element to be visible',
    );
  }
}
