import type { WebViewSession } from '@mobilewright/protocol';
import type { StepFn } from './locator.js';
import { retryUntil } from './poll.js';
import { captureLocation } from './stackTrace.js';
import { WebLocator, type WebLocatorStrategy } from './web-locator.js';
import { DOM_SELECTOR_ENGINE } from './dom-selector-engine.js';

const DEFAULT_TIMEOUT = 5_000;

export class Page {
  _stepFn: StepFn | null = null;

  static async attach(session: WebViewSession): Promise<Page> {
    await session.evaluate(DOM_SELECTOR_ENGINE);
    return new Page(session);
  }

  constructor(readonly session: WebViewSession) {}

  // Build a WebLocator scoped to this page, carrying step instrumentation forward.
  private locatorFor(strategy: WebLocatorStrategy): WebLocator {
    const loc = new WebLocator(this.session, strategy);
    loc._stepFn = this._stepFn;
    return loc;
  }

  private async _step<T>(title: string, fn: () => Promise<T>): Promise<T> {
    if (this._stepFn) {
      const location = captureLocation();
      return this._stepFn(title, fn as () => Promise<unknown>, location) as Promise<T>;
    }
    return fn();
  }

  // ─── Locator factories ───────────────────────────────────────

  locator(selector: string): WebLocator {
    return this.locatorFor({ kind: 'css', selector });
  }

  getByRole(role: string, opts?: { name?: string | RegExp }): WebLocator {
    return this.locatorFor({ kind: 'role', role, name: opts?.name });
  }

  getByText(text: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return this.locatorFor({ kind: 'text', text, exact: opts?.exact });
  }

  getByLabel(label: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return this.locatorFor({ kind: 'label', label, exact: opts?.exact });
  }

  getByPlaceholder(text: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return this.locatorFor({ kind: 'placeholder', text, exact: opts?.exact });
  }

  getByTestId(testId: string): WebLocator {
    return this.locatorFor({ kind: 'testId', testId });
  }

  getByAltText(text: string | RegExp): WebLocator {
    return this.locatorFor({ kind: 'altText', text });
  }

  getByTitle(text: string | RegExp): WebLocator {
    return this.locatorFor({ kind: 'title', text });
  }

  // ─── Page-level methods ──────────────────────────────────────

  async url(): Promise<string> {
    return this.session.url();
  }

  async title(): Promise<string> {
    return this.session.title();
  }

  async goto(url: string): Promise<void> {
    return this._step(`page.goto(${JSON.stringify(url)})`, async () => {
      await this.session.goto(url);
    });
  }

  async reload(): Promise<void> {
    return this._step('page.reload()', async () => {
      await this.session.reload();
    });
  }

  async goBack(): Promise<void> {
    return this._step('page.goBack()', async () => {
      await this.session.goBack();
    });
  }

  async goForward(): Promise<void> {
    return this._step('page.goForward()', async () => {
      await this.session.goForward();
    });
  }

  async evaluate<T>(fn: string | (() => T)): Promise<T> {
    const expr = typeof fn === 'function' ? `(${fn.toString()})()` : fn;
    return this.session.evaluate<T>(expr);
  }

  async waitForURL(
    url: string | RegExp,
    opts?: { timeout?: number },
  ): Promise<void> {
    return this._step(`page.waitForURL(${url})`, async () => {
      await retryUntil(
        () => this.session.url(),
        (current) => url instanceof RegExp ? url.test(current) : current === url,
        opts?.timeout ?? DEFAULT_TIMEOUT,
        () => `waitForURL: timed out waiting for URL to match "${url}"`,
      );
    });
  }

  async waitForLoadState(
    state: 'load' | 'domcontentloaded' = 'load',
  ): Promise<void> {
    return this._step(`page.waitForLoadState(${state})`, async () => {
      await this.session.waitForLoadState(state);
    });
  }

  async content(): Promise<string> {
    return this.session.evaluate<string>('document.documentElement.outerHTML');
  }

  async screenshot(): Promise<Buffer> {
    throw new Error('page.screenshot() is not yet supported — requires a screenshot capability on WebViewSession');
  }

  async close(): Promise<void> {
    await this.session.close();
  }
}
