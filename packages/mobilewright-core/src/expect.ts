import type { Locator, StepFn } from './locator.js';
import { LocatorError } from './locator.js';
import { Page } from './page.js';
import { WebLocator } from './web-locator.js';
import { retryUntil } from './poll.js';
import { filterStack, runStep } from './stackTrace.js';
import { textValue, type FrameExpectParams } from './web-expect-matcher.js';

const DEFAULT_TIMEOUT = 5_000;

export interface ExpectOptions {
  timeout?: number;
}

/**
 * Playwright-style expect for mobile locators, web locators, pages, and plain values.
 *
 * Usage:
 *   expect(locator).toBeVisible()
 *   expect(page).toHaveURL(/dashboard/)
 *   expect(webLocator).toHaveText('Hello')
 *   expect(42).toBe(42)
 */
export function expect(actual: Page): PageAssertions;
export function expect(actual: WebLocator): WebLocatorAssertions;
export function expect(actual: Locator): LocatorAssertions;
export function expect<T>(actual: T): ValueAssertions<T>;
export function expect(actual: unknown): any {
  if (actual instanceof Page) { return new PageAssertions(actual, false); }
  if (actual instanceof WebLocator) { return new WebLocatorAssertions(actual, false); }
  if (actual && typeof actual === 'object' && 'tap' in actual && 'getText' in actual) {
    return new LocatorAssertions(actual as Locator, false);
  }
  return new ValueAssertions(actual, false);
}

// Minimal interface satisfied by both Locator and WebLocator (after getText/getValue aliases).
interface LocatorLike {
  isVisible(opts?: { timeout?: number }): Promise<boolean>;
  isEnabled(opts?: { timeout?: number }): Promise<boolean>;
  isChecked(opts?: { timeout?: number }): Promise<boolean>;
  isSelected?(opts?: { timeout?: number }): Promise<boolean>;
  isFocused?(opts?: { timeout?: number }): Promise<boolean>;
  getText(opts?: { timeout?: number }): Promise<string>;
  getValue(opts?: { timeout?: number }): Promise<string>;
  count(): Promise<number>;
  expectTimeout?: number;
  _stepFn?: StepFn | null;
}

// Wrap an assertion body as a reporter step titled after the matcher, shared by
// all assertion classes so the title/negation convention lives in one place.
function wrapAssertion<T>(
  stepFn: StepFn | null | undefined,
  negated: boolean,
  method: string,
  fn: () => Promise<T>,
): Promise<T> {
  const title = negated ? `expect.not.${method}()` : `expect.${method}()`;
  return runStep(stepFn, title, fn);
}

// Poll until `predicate` holds (or the timeout elapses), re-raising any failure
// as an ExpectError. The predicate must already account for negation.
async function retryAssertion<T>(
  poll: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeout: number,
  failMessage: string | (() => string),
): Promise<void> {
  try {
    await retryUntil(poll, predicate, timeout, failMessage);
  } catch (e) {
    throw new ExpectError(e instanceof Error ? e.message : String(e));
  }
}

class LocatorAssertions {
  constructor(
    protected readonly locator: LocatorLike,
    protected readonly negated: boolean,
  ) {}

  get not(): LocatorAssertions {
    return new LocatorAssertions(this.locator, !this.negated);
  }

  private assertionTimeout(opts?: ExpectOptions): number {
    return opts?.timeout ?? this.locator.expectTimeout ?? DEFAULT_TIMEOUT;
  }

  protected _wrapAssertion<T>(method: string, fn: () => Promise<T>): Promise<T> {
    return wrapAssertion(this.locator._stepFn, this.negated, method, fn);
  }

  async toBeVisible(opts?: ExpectOptions): Promise<void> {
    return this._wrapAssertion('toBeVisible', async () => {
      await this.assertBoolean('visible', () => this.locator.isVisible({ timeout: 0 }), opts);
    });
  }

  async toBeHidden(opts?: ExpectOptions): Promise<void> {
    return this._wrapAssertion('toBeHidden', async () => {
      await this.assertBoolean('hidden', async () => {
        const visible = await this.locator.isVisible({ timeout: 0 });
        return !visible;
      }, opts);
    });
  }

  async toBeEnabled(opts?: ExpectOptions): Promise<void> {
    return this._wrapAssertion('toBeEnabled', async () => {
      await this.assertBoolean('enabled', () => this.locator.isEnabled({ timeout: 0 }), opts);
    });
  }

  async toBeDisabled(opts?: ExpectOptions): Promise<void> {
    return this._wrapAssertion('toBeDisabled', async () => {
      await this.assertBoolean('disabled', async () => {
        const enabled = await this.locator.isEnabled({ timeout: 0 });
        return !enabled;
      }, opts);
    });
  }

  async toBeSelected(opts?: ExpectOptions): Promise<void> {
    return this._wrapAssertion('toBeSelected', async () => {
      const isSelected = this.locator.isSelected?.bind(this.locator);
      if (!isSelected) {
        throw new ExpectError('toBeSelected() is not supported for this locator');
      }
      await this.assertBoolean('selected', () => isSelected({ timeout: 0 }), opts);
    });
  }

  async toBeFocused(opts?: ExpectOptions): Promise<void> {
    return this._wrapAssertion('toBeFocused', async () => {
      const isFocused = this.locator.isFocused?.bind(this.locator);
      if (!isFocused) {
        throw new ExpectError('toBeFocused() is not supported for this locator');
      }
      await this.assertBoolean('focused', () => isFocused({ timeout: 0 }), opts);
    });
  }

  async toBeChecked(opts?: ExpectOptions): Promise<void> {
    return this._wrapAssertion('toBeChecked', async () => {
      await this.assertBoolean('checked', () => this.locator.isChecked({ timeout: 0 }), opts);
    });
  }

  async toHaveText(expected: string | RegExp, opts?: ExpectOptions): Promise<void> {
    return this._wrapAssertion('toHaveText', async () => {
      await this.assertText(
        (text) => expected instanceof RegExp ? expected.test(text) : text === expected,
        expected, opts,
      );
    });
  }

  async toContainText(expected: string, opts?: ExpectOptions): Promise<void> {
    return this._wrapAssertion('toContainText', async () => {
      await this.assertText(
        (text) => text.includes(expected),
        expected, opts,
      );
    });
  }

  async toHaveCount(expected: number, opts?: ExpectOptions): Promise<void> {
    return this._wrapAssertion('toHaveCount', async () => {
      let lastCount = 0;
      await this.retryAssertion(
        async () => { lastCount = await this.locator.count(); return lastCount; },
        (count) => {
          const matches = count === expected;
          return this.negated ? !matches : matches;
        },
        this.assertionTimeout(opts),
        () => this.negated
          ? `Expected element count NOT to be ${expected}, but got ${lastCount}`
          : `Expected element count to be ${expected}, but got ${lastCount}`,
      );
    });
  }

  async toBeEmpty(opts?: ExpectOptions): Promise<void> {
    return this._wrapAssertion('toBeEmpty', () =>
      this.assertStringMatch(
        () => this.locator.getValue({ timeout: 0 }),
        (value) => value === '',
        'Expected element to be empty, but no matching element was found',
        (value) => this.negated
          ? 'Expected element NOT to be empty, but it was'
          : `Expected element to be empty, but got "${value}"`,
        opts,
      ),
    );
  }

  async toHaveValue(expected: string | RegExp, opts?: ExpectOptions): Promise<void> {
    return this._wrapAssertion('toHaveValue', () =>
      this.assertStringMatch(
        () => this.locator.getValue({ timeout: 0 }),
        (value) => expected instanceof RegExp ? expected.test(value) : value === expected,
        `Expected element to have value "${expected}", but no matching element was found`,
        (value) => this.negated
          ? `Expected element NOT to have value "${expected}", but got "${value}"`
          : `Expected element to have value "${expected}", but got "${value}"`,
        opts,
      ),
    );
  }

  protected async assertBoolean(
    name: string,
    poll: () => Promise<boolean>,
    opts?: ExpectOptions,
  ): Promise<void> {
    await this.retryAssertion(
      poll,
      (result) => (this.negated ? !result : result),
      this.assertionTimeout(opts),
      this.negated
        ? `Expected element to NOT be ${name}, but it was`
        : `Expected element to be ${name}, but it was not`,
    );
  }

  protected async assertText(
    predicate: (text: string) => boolean,
    expected: string | RegExp,
    opts?: ExpectOptions,
  ): Promise<void> {
    await this.assertStringMatch(
      () => this.locator.getText({ timeout: 0 }),
      predicate,
      `Expected element to have text "${expected}", but no matching element was found`,
      (text) => this.negated
        ? `Expected element NOT to have text "${expected}", but got "${text}"`
        : `Expected element to have text "${expected}", but got "${text}"`,
      opts,
    );
  }

  // Poll a string-valued read (getText/getValue) until `matches` holds (honoring
  // negation), distinguishing a genuinely-absent element from a value mismatch:
  // a LocatorError means "no matching element" and yields `notFoundMessage`,
  // while any resolved value that fails the match yields `mismatchMessage`.
  private async assertStringMatch(
    read: () => Promise<string>,
    matches: (value: string) => boolean,
    notFoundMessage: string,
    mismatchMessage: (value: string) => string,
    opts?: ExpectOptions,
  ): Promise<void> {
    let lastValue: string | null = null;
    await this.retryAssertion(
      async (): Promise<string | null> => {
        try {
          lastValue = await read();
          return lastValue;
        } catch (e) {
          if (!(e instanceof LocatorError)) {
            throw e;
          }
          lastValue = null;
          return null;
        }
      },
      (value) => {
        if (value === null) {
          return false;
        }
        return this.negated ? !matches(value) : matches(value);
      },
      this.assertionTimeout(opts),
      () => lastValue === null ? notFoundMessage : mismatchMessage(lastValue),
    );
  }

  protected retryAssertion<T>(
    poll: () => Promise<T>,
    predicate: (value: T) => boolean,
    timeout: number,
    failMessage: string | (() => string),
  ): Promise<void> {
    return retryAssertion(poll, predicate, timeout, failMessage);
  }
}

class ValueAssertions<T> {
  constructor(
    private readonly actual: T,
    private readonly negated: boolean,
  ) {}

  get not(): ValueAssertions<T> {
    return new ValueAssertions(this.actual, !this.negated);
  }

  toBe(expected: T): void {
    const pass = Object.is(this.actual, expected);
    this.assert(pass, `Expected ${fmt(expected)}, but received ${fmt(this.actual)}`);
  }

  toEqual(expected: T): void {
    const pass = JSON.stringify(this.actual) === JSON.stringify(expected);
    this.assert(pass, `Expected ${fmt(expected)}, but received ${fmt(this.actual)}`);
  }

  toBeTruthy(): void {
    this.assert(!!this.actual, `Expected truthy, but received ${fmt(this.actual)}`);
  }

  toBeFalsy(): void {
    this.assert(!this.actual, `Expected falsy, but received ${fmt(this.actual)}`);
  }

  toBeGreaterThan(expected: number): void {
    this.assert((this.actual as number) > expected, `Expected ${fmt(this.actual)} > ${expected}`);
  }

  toBeLessThan(expected: number): void {
    this.assert((this.actual as number) < expected, `Expected ${fmt(this.actual)} < ${expected}`);
  }

  toBeCloseTo(expected: number, precision = 2): void {
    const tolerance = Math.pow(10, -precision) / 2;
    const pass = Math.abs((this.actual as number) - expected) < tolerance;
    this.assert(pass, `Expected ${fmt(this.actual)} to be close to ${expected} (precision ${precision})`);
  }

  toContain(expected: unknown): void {
    const actual = this.actual as any;
    const pass = Array.isArray(actual)
      ? actual.includes(expected)
      : typeof actual === 'string' ? actual.includes(expected as string) : false;
    this.assert(pass, `Expected ${fmt(this.actual)} to contain ${fmt(expected)}`);
  }

  toBeNull(): void {
    this.assert(this.actual === null, `Expected null, but received ${fmt(this.actual)}`);
  }

  toBeUndefined(): void {
    this.assert(this.actual === undefined, `Expected undefined, but received ${fmt(this.actual)}`);
  }

  toMatch(pattern: RegExp | string): void {
    const str = String(this.actual);
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    this.assert(regex.test(str), `Expected ${fmt(this.actual)} to match ${regex}`);
  }

  toBeInstanceOf(expected: Function): void {
    const pass = this.actual instanceof expected;
    this.assert(pass, `Expected instance of ${expected.name}, but received ${fmt(this.actual)}`);
  }

  toBeDefined(): void {
    this.assert(this.actual !== undefined, 'Expected defined, but received undefined');
  }

  toBeGreaterThanOrEqual(expected: number): void {
    this.assert((this.actual as number) >= expected, `Expected ${fmt(this.actual)} >= ${expected}`);
  }

  toBeLessThanOrEqual(expected: number): void {
    this.assert((this.actual as number) <= expected, `Expected ${fmt(this.actual)} <= ${expected}`);
  }

  toBeNaN(): void {
    this.assert(Number.isNaN(this.actual), `Expected NaN, but received ${fmt(this.actual)}`);
  }

  toContainEqual(expected: unknown): void {
    const actual = this.actual as unknown[];
    const pass = Array.isArray(actual) && actual.some((item) => JSON.stringify(item) === JSON.stringify(expected));
    this.assert(pass, `Expected ${fmt(this.actual)} to contain equal ${fmt(expected)}`);
  }

  toHaveLength(expected: number): void {
    const actual = this.actual as any;
    const length = actual?.length ?? 0;
    this.assert(length === expected, `Expected length ${expected}, but received ${length}`);
  }

  toHaveProperty(key: string, value?: unknown): void {
    const actual = this.actual as any;
    const hasKey = actual != null && key in actual;
    const pass = value === undefined ? hasKey : hasKey && Object.is(actual[key], value);
    this.assert(pass, `Expected ${fmt(this.actual)} to have property "${key}"${value !== undefined ? ` with value ${fmt(value)}` : ''}`);
  }

  toMatchObject(expected: Record<string, unknown>): void {
    const actual = this.actual as Record<string, unknown>;
    const pass = actual != null && Object.keys(expected).every((key) => JSON.stringify(actual[key]) === JSON.stringify(expected[key]));
    this.assert(pass, `Expected ${fmt(this.actual)} to match object ${fmt(expected)}`);
  }

  toStrictEqual(expected: T): void {
    const pass = JSON.stringify(this.actual) === JSON.stringify(expected)
      && Object.getPrototypeOf(this.actual) === Object.getPrototypeOf(expected);
    this.assert(pass, `Expected ${fmt(expected)}, but received ${fmt(this.actual)}`);
  }

  toThrow(expected?: string | RegExp): void {
    if (typeof this.actual !== 'function') {
      throw new ExpectError(`Expected a function, but received ${fmt(this.actual)}`);
    }
    const fn = this.actual as () => unknown;
    let threw = false;
    let error: unknown;
    try {
      fn();
    } catch (e) {
      threw = true;
      error = e;
    }
    if (expected === undefined) {
      this.assert(threw, 'Expected function to throw');
    } else {
      const message = threw && error instanceof Error ? error.message : String(error);
      const matches = typeof expected === 'string' ? message.includes(expected) : expected.test(message);
      this.assert(threw && matches, `Expected function to throw matching ${fmt(expected)}, but got ${fmt(message)}`);
    }
  }

  private assert(pass: boolean, message: string): void {
    const ok = this.negated ? !pass : pass;
    if (!ok) {
      throw new ExpectError(this.negated ? `Negation failed: ${message}` : message);
    }
  }
}

// ─── PageAssertions ───────────────────────────────────────────

class PageAssertions {
  constructor(
    private readonly page: Page,
    private readonly negated: boolean,
  ) {}

  get not(): PageAssertions {
    return new PageAssertions(this.page, !this.negated);
  }

  private _wrapAssertion<T>(method: string, fn: () => Promise<T>): Promise<T> {
    return wrapAssertion(this.page._stepFn, this.negated, method, fn);
  }

  // Applies negation so callers pass the plain "does it match?" predicate.
  private matches(pass: boolean): boolean {
    return this.negated ? !pass : pass;
  }

  async toHaveURL(url: string | RegExp, opts?: ExpectOptions): Promise<void> {
    return this._wrapAssertion('toHaveURL', async () => {
      let last = '';
      await retryAssertion(
        async () => { try { last = await this.page.url(); } catch { last = ''; } return last; },
        (current) => this.matches(url instanceof RegExp ? url.test(current) : current === url),
        opts?.timeout ?? DEFAULT_TIMEOUT,
        () => `Expected page URL to ${this.negated ? 'not ' : ''}match "${url}", but got "${last}"`,
      );
    });
  }

  async toHaveTitle(title: string | RegExp, opts?: ExpectOptions): Promise<void> {
    return this._wrapAssertion('toHaveTitle', async () => {
      let last = '';
      await retryAssertion(
        async () => { try { last = await this.page.title(); } catch { last = ''; } return last; },
        (current) => this.matches(title instanceof RegExp ? title.test(current) : current === title),
        opts?.timeout ?? DEFAULT_TIMEOUT,
        () => `Expected page title to ${this.negated ? 'not ' : ''}match "${title}", but got "${last}"`,
      );
    });
  }
}

// ─── WebLocatorAssertions ─────────────────────────────────────
// Standalone: every web matcher routes through Playwright's injected expect()
// (window.__mwInjected.expect) for byte-exact matcher semantics. Native
// LocatorAssertions and PageAssertions are unaffected.

class WebLocatorAssertions {
  constructor(
    private readonly webLocator: WebLocator,
    private readonly negated: boolean,
  ) {}

  get not(): WebLocatorAssertions {
    return new WebLocatorAssertions(this.webLocator, !this.negated);
  }

  private assertionTimeout(opts?: ExpectOptions): number {
    return opts?.timeout ?? this.webLocator.expectTimeout ?? DEFAULT_TIMEOUT;
  }

  // Poll the injected matcher until matches !== isNot, or throw ExpectError.
  private runMatcher(
    method: string,
    params: Omit<FrameExpectParams, 'isNot' | 'timeout'>,
    opts?: ExpectOptions,
  ): Promise<void> {
    return wrapAssertion(this.webLocator._stepFn, this.negated, method, async () => {
      const isNot = this.negated;
      let received: unknown;
      let missingReceived = false;
      await retryAssertion(
        async () => {
          const result = await this.webLocator._runInjectedExpect({ ...params, isNot, timeout: 0 });
          received = result.received;
          missingReceived = result.missingReceived ?? false;
          return result.matches;
        },
        (matches) => matches !== isNot,
        this.assertionTimeout(opts),
        () => {
          const got = missingReceived ? 'no element' : fmt(received);
          return isNot
            ? `Expected ${method} NOT to match, but it did (received ${got})`
            : `Expected ${method} to match, but it did not (received ${got})`;
        },
      );
    });
  }

  toBeVisible(opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toBeVisible', { expression: 'to.be.visible' }, opts);
  }

  toBeHidden(opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toBeHidden', { expression: 'to.be.hidden' }, opts);
  }

  toBeEnabled(opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toBeEnabled', { expression: 'to.be.enabled' }, opts);
  }

  toBeDisabled(opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toBeDisabled', { expression: 'to.be.disabled' }, opts);
  }

  toBeEditable(opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toBeEditable', { expression: 'to.be.editable' }, opts);
  }

  toBeFocused(opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toBeFocused', { expression: 'to.be.focused' }, opts);
  }

  toBeAttached(opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toBeAttached', { expression: 'to.be.attached' }, opts);
  }

  toBeInViewport(opts?: ExpectOptions & { ratio?: number }): Promise<void> {
    return this.runMatcher('toBeInViewport', { expression: 'to.be.in.viewport', expectedNumber: opts?.ratio }, opts);
  }

  toBeChecked(opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toBeChecked', { expression: 'to.be.checked', expectedValue: { checked: true, indeterminate: false } }, opts);
  }

  toBeEmpty(opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toBeEmpty', { expression: 'to.be.empty' }, opts);
  }

  toHaveText(expected: string | RegExp, opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toHaveText', { expression: 'to.have.text', expectedText: [textValue(expected, { normalizeWhiteSpace: true })] }, opts);
  }

  toContainText(expected: string | RegExp, opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toContainText', { expression: 'to.have.text', expectedText: [textValue(expected, { normalizeWhiteSpace: true, matchSubstring: true })] }, opts);
  }

  toHaveValue(expected: string | RegExp, opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toHaveValue', { expression: 'to.have.value', expectedText: [textValue(expected)] }, opts);
  }

  toHaveCount(expected: number, opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toHaveCount', { expression: 'to.have.count', expectedNumber: expected }, opts);
  }

  toHaveAttribute(name: string, expected: string | RegExp, opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toHaveAttribute', { expression: 'to.have.attribute.value', expressionArg: name, expectedText: [textValue(expected)] }, opts);
  }

  toHaveClass(expected: string | RegExp, opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toHaveClass', { expression: 'to.have.class', expectedText: [textValue(expected)] }, opts);
  }

  toContainClass(expected: string | RegExp, opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toContainClass', { expression: 'to.contain.class', expectedText: [textValue(expected)] }, opts);
  }

  toHaveCSS(name: string, expected: string | RegExp, opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toHaveCSS', { expression: 'to.have.css', expressionArg: name, expectedText: [textValue(expected)] }, opts);
  }

  toHaveId(expected: string | RegExp, opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toHaveId', { expression: 'to.have.id', expectedText: [textValue(expected)] }, opts);
  }

  toHaveJSProperty(name: string, expected: unknown, opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toHaveJSProperty', { expression: 'to.have.property', expressionArg: name, expectedValue: expected }, opts);
  }
}

function fmt(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value);
}

export class ExpectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpectError';
    this.stack = filterStack(this.stack);
  }
}
