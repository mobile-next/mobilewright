import type { Locator } from './locator.js';
import { sleep } from './sleep.js';

const DEFAULT_TIMEOUT = 5_000;
const POLL_INTERVAL = 100;

export interface ExpectOptions {
  timeout?: number;
}

/**
 * Playwright-style expect for mobile locators and plain values.
 *
 * Usage:
 *   expect(locator).toBeVisible()
 *   expect(locator).not.toBeVisible()
 *   expect(locator).toHaveText('Hello')
 *   expect(42).toBe(42)
 */
export function expect(actual: Locator): LocatorAssertions;
export function expect<T>(actual: T): ValueAssertions<T>;
export function expect(actual: unknown): any {
  if (actual && typeof actual === 'object' && 'tap' in actual && 'getText' in actual) {
    return new LocatorAssertions(actual as Locator, false);
  }
  return new ValueAssertions(actual, false);
}

class LocatorAssertions {
  constructor(
    private readonly locator: Locator,
    private readonly negated: boolean,
  ) {}

  get not(): LocatorAssertions {
    return new LocatorAssertions(this.locator, !this.negated);
  }

  async toBeVisible(opts?: ExpectOptions): Promise<void> {
    await this.assertBoolean('visible', () => this.locator.isVisible({ timeout: 0 }), opts);
  }

  async toBeHidden(opts?: ExpectOptions): Promise<void> {
    await this.assertBoolean('hidden', async () => {
      const visible = await this.locator.isVisible({ timeout: 0 });
      return !visible;
    }, opts);
  }

  async toBeEnabled(opts?: ExpectOptions): Promise<void> {
    await this.assertBoolean('enabled', () => this.locator.isEnabled({ timeout: 0 }), opts);
  }

  async toBeDisabled(opts?: ExpectOptions): Promise<void> {
    await this.assertBoolean('disabled', async () => {
      const enabled = await this.locator.isEnabled({ timeout: 0 });
      return !enabled;
    }, opts);
  }

  async toBeSelected(opts?: ExpectOptions): Promise<void> {
    await this.assertBoolean('selected', () => this.locator.isSelected({ timeout: 0 }), opts);
  }

  async toBeFocused(opts?: ExpectOptions): Promise<void> {
    await this.assertBoolean('focused', () => this.locator.isFocused({ timeout: 0 }), opts);
  }

  async toBeChecked(opts?: ExpectOptions): Promise<void> {
    await this.assertBoolean('checked', () => this.locator.isChecked({ timeout: 0 }), opts);
  }

  async toHaveText(expected: string | RegExp, opts?: ExpectOptions): Promise<void> {
    await this.assertText(
      (text) => expected instanceof RegExp ? expected.test(text) : text === expected,
      expected, opts,
    );
  }

  async toContainText(expected: string, opts?: ExpectOptions): Promise<void> {
    await this.assertText(
      (text) => text.includes(expected),
      expected, opts,
    );
  }

  async toHaveValue(expected: string | RegExp, opts?: ExpectOptions): Promise<void> {
    let lastValue = '';
    await this.retryUntil(
      async () => {
        try { lastValue = await this.locator.getValue({ timeout: 0 }); } catch { lastValue = ''; }
        return lastValue;
      },
      (value) => {
        const matches = expected instanceof RegExp ? expected.test(value) : value === expected;
        return this.negated ? !matches : matches;
      },
      opts?.timeout ?? DEFAULT_TIMEOUT,
      () => this.negated
        ? `Expected element NOT to have value "${expected}", but got "${lastValue}"`
        : `Expected element to have value "${expected}", but got "${lastValue}"`,
    );
  }

  private async assertBoolean(
    name: string,
    poll: () => Promise<boolean>,
    opts?: ExpectOptions,
  ): Promise<void> {
    await this.retryUntil(
      poll,
      (result) => (this.negated ? !result : result),
      opts?.timeout ?? DEFAULT_TIMEOUT,
      this.negated
        ? `Expected element to NOT be ${name}, but it was`
        : `Expected element to be ${name}, but it was not`,
    );
  }

  private async assertText(
    predicate: (text: string) => boolean,
    expected: string | RegExp,
    opts?: ExpectOptions,
  ): Promise<void> {
    let lastText = '';
    await this.retryUntil(
      async () => {
        try { lastText = await this.locator.getText({ timeout: 0 }); } catch { lastText = ''; }
        return lastText;
      },
      (text) => {
        const matches = predicate(text);
        return this.negated ? !matches : matches;
      },
      opts?.timeout ?? DEFAULT_TIMEOUT,
      () => this.negated
        ? `Expected element NOT to have text "${expected}", but got "${lastText}"`
        : `Expected element to have text "${expected}", but got "${lastText}"`,
    );
  }

  private async retryUntil<T>(
    poll: () => Promise<T>,
    predicate: (value: T) => boolean,
    timeout: number,
    failMessage: string | (() => string),
  ): Promise<void> {
    const deadline = Date.now() + timeout;

    while (true) {
      const value = await poll();
      if (predicate(value)) {
        return;
      }

      if (Date.now() >= deadline) {
        throw new ExpectError(typeof failMessage === 'function' ? failMessage() : failMessage);
      }

      await sleep(POLL_INTERVAL);
    }
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
    this.assert(this.actual !== undefined, `Expected defined, but received undefined`);
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
    const fn = this.actual as unknown as () => unknown;
    let threw = false;
    let error: unknown;
    try {
      fn();
    } catch (e) {
      threw = true;
      error = e;
    }
    if (expected === undefined) {
      this.assert(threw, `Expected function to throw`);
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

function fmt(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value);
}

export class ExpectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpectError';
  }
}
