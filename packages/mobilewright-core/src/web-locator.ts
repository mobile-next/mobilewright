import type { WebViewSession } from '@mobilewright/protocol';
import type { StepFn } from './locator.js';
import { retryUntil } from './poll.js';
import { runStep } from './stackTrace.js';

const DEFAULT_TIMEOUT = 5_000;

export type WebLocatorStrategy =
  | { kind: 'css'; selector: string }
  | { kind: 'role'; role: string; name?: string | RegExp; exact?: boolean }
  | { kind: 'text'; text: string | RegExp; exact?: boolean }
  | { kind: 'label'; label: string | RegExp; exact?: boolean }
  | { kind: 'placeholder'; text: string | RegExp; exact?: boolean }
  | { kind: 'testId'; testId: string }
  | { kind: 'altText'; text: string | RegExp; exact?: boolean }
  | { kind: 'title'; text: string | RegExp; exact?: boolean }
  | { kind: 'nth'; parent: WebLocatorStrategy; index: number };

// Serialise a string-or-RegExp value to a JS expression fragment.
// RegExps become their literal form (/pat/flags); strings become JSON.
function serializeTextArg(value: string | RegExp): string {
  return value instanceof RegExp ? value.toString() : JSON.stringify(value);
}

// Builds a JS expression (usable in session.evaluate) that evaluates to an
// array of DOM elements matching the strategy. Delegates to window.__mw.*
// helpers injected by DOM_SELECTOR_ENGINE.
function buildFindAll(strategy: WebLocatorStrategy): string {
  switch (strategy.kind) {
    case 'css':
      return `Array.from(document.querySelectorAll(${JSON.stringify(strategy.selector)}))`;

    case 'testId':
      return `Array.from(document.querySelectorAll('[data-testid=${JSON.stringify(strategy.testId)}]'))`;

    case 'role': {
      const nameArg = strategy.name === undefined ? 'undefined' : serializeTextArg(strategy.name);
      const exactArg = strategy.exact === true ? 'true' : 'false';
      return `window.__mw.findByRole(document, ${JSON.stringify(strategy.role)}, ${nameArg}, ${exactArg})`;
    }

    case 'text':
      return `window.__mw.findByText(document, ${serializeTextArg(strategy.text)}, ${strategy.exact === true})`;

    case 'label':
      return `window.__mw.findByLabel(document, ${serializeTextArg(strategy.label)}, ${strategy.exact === true})`;

    case 'placeholder':
      return `window.__mw.findByAttr(document, 'placeholder', ${serializeTextArg(strategy.text)}, ${strategy.exact === true})`;

    case 'altText':
      return `window.__mw.findByAttr(document, 'alt', ${serializeTextArg(strategy.text)}, ${strategy.exact === true})`;

    case 'title':
      return `window.__mw.findByAttr(document, 'title', ${serializeTextArg(strategy.text)}, ${strategy.exact === true})`;

    case 'nth': {
      const all = buildFindAll(strategy.parent);
      return `(arr => { const i = ${strategy.index} < 0 ? arr.length + ${strategy.index} : ${strategy.index}; return i >= 0 && i < arr.length ? [arr[i]] : []; })(${all})`;
    }
  }
}

export class WebLocator {
  _stepFn: StepFn | null = null;

  constructor(
    protected readonly session: WebViewSession,
    protected readonly strategy: WebLocatorStrategy,
  ) {}

  // Build a child WebLocator, carrying step instrumentation forward.
  private child(strategy: WebLocatorStrategy): WebLocator {
    const loc = new WebLocator(this.session, strategy);
    loc._stepFn = this._stepFn;
    return loc;
  }

  private async _step<T>(title: string, fn: () => Promise<T>): Promise<T> {
    return runStep(this._stepFn, title, fn);
  }

  // Evaluate a boolean predicate against the first matched element, retrying
  // until it is true or the timeout elapses. A timeout of 0 checks once.
  // Any evaluation error is treated as false.
  private async pollBoolean(js: string, timeout: number, what: string): Promise<boolean> {
    const read = async (): Promise<boolean> => {
      try {
        return await this.session.evaluate<boolean>(js);
      } catch {
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
    return this.session.evaluate<T>(`(() => { const el = (${buildFindAll(this.strategy)})[0]; return ${valueExpr}; })()`);
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
    return this.child({ kind: 'nth', parent: this.strategy, index });
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
    const js = `(() => { const el = (${buildFindAll(this.strategy)})[0]; if (!el) return false; const s = window.getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; })()`;
    return this.pollBoolean(js, opts?.timeout ?? DEFAULT_TIMEOUT, 'visible');
  }

  async isHidden(opts?: { timeout?: number }): Promise<boolean> {
    const visible = await this.isVisible({ timeout: opts?.timeout ?? 0 });
    return !visible;
  }

  async isEnabled(opts?: { timeout?: number }): Promise<boolean> {
    const js = `(() => { const el = (${buildFindAll(this.strategy)})[0]; return !!el && !el.disabled; })()`;
    return this.pollBoolean(js, opts?.timeout ?? 0, 'enabled');
  }

  async isDisabled(opts?: { timeout?: number }): Promise<boolean> {
    return !(await this.isEnabled(opts));
  }

  async isChecked(opts?: { timeout?: number }): Promise<boolean> {
    const js = `(() => { const el = (${buildFindAll(this.strategy)})[0]; return !!el && (el.checked === true || el.getAttribute('aria-checked') === 'true'); })()`;
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

  async boundingBox(opts?: { timeout?: number }): Promise<{ x: number; y: number; width: number; height: number } | null> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
    await this.pollUntilVisible(timeout);
    return this.session.evaluate<{ x: number; y: number; width: number; height: number } | null>(
      `(() => { const el = (${buildFindAll(this.strategy)})[0]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`,
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
      await this.session.evaluate(`(${buildFindAll(this.strategy)})[0]?.click()`);
    });
  }

  async fill(text: string, opts?: { timeout?: number }): Promise<void> {
    return this._step(`locator.fill(${JSON.stringify(text)})`, async () => {
      await this.pollUntilVisible(opts?.timeout ?? DEFAULT_TIMEOUT);
      await this.session.evaluate(`(() => { const el = (${buildFindAll(this.strategy)})[0]; if (el) { el.focus(); el.value = ''; el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
    });
  }

  async type(text: string): Promise<void> {
    return this._step(`locator.type(${JSON.stringify(text)})`, async () => {
      await this.pollUntilVisible(DEFAULT_TIMEOUT);
      await this.session.evaluate(`(() => { const el = (${buildFindAll(this.strategy)})[0]; if (el) { el.focus(); el.value = (el.value || '') + ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
    });
  }

  async press(key: string): Promise<void> {
    return this._step(`locator.press(${JSON.stringify(key)})`, async () => {
      const el = `(${buildFindAll(this.strategy)})[0]`;
      await this.session.evaluate(`(() => { const el = ${el}; if (el) { ['keydown','keypress','keyup'].forEach(t => el.dispatchEvent(new KeyboardEvent(t, { key: ${JSON.stringify(key)}, bubbles: true }))); } })()`);
    });
  }

  async focus(): Promise<void> {
    return this._step('locator.focus()', async () => {
      await this.session.evaluate(`(${buildFindAll(this.strategy)})[0]?.focus()`);
    });
  }

  async hover(): Promise<void> {
    return this._step('locator.hover()', async () => {
      await this.session.evaluate(`(() => { const el = (${buildFindAll(this.strategy)})[0]; if (el) { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); } })()`);
    });
  }

  async scrollIntoViewIfNeeded(): Promise<void> {
    return this._step('locator.scrollIntoViewIfNeeded()', async () => {
      await this.session.evaluate(`(${buildFindAll(this.strategy)})[0]?.scrollIntoView({ block: 'nearest' })`);
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
