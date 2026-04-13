import type { Locator } from './locator.js';
import { sleep } from './sleep.js';

const DEFAULT_TIMEOUT = 5_000;
const POLL_INTERVAL = 100;

export interface ExpectOptions {
  timeout?: number;
}

/**
 * Playwright-style expect with auto-retry for mobile locators.
 *
 * Usage:
 *   expect(locator).toBeVisible()
 *   expect(locator).not.toBeVisible()
 *   expect(locator).toHaveText('Hello')
 */
export function expect(locator: Locator): LocatorAssertions {
  return new LocatorAssertions(locator, false);
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

export class ExpectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpectError';
  }
}
