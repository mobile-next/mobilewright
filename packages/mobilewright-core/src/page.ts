import type { WebViewSession } from '@mobilewright/protocol';
import { retryUntil } from './poll.js';
import { WebLocator } from './web-locator.js';

const DEFAULT_TIMEOUT = 5_000;

export class Page {
  constructor(readonly session: WebViewSession) {}

  // ─── Locator factories ───────────────────────────────────────

  locator(selector: string): WebLocator {
    return new WebLocator(this.session, { kind: 'css', selector });
  }

  getByRole(role: string, opts?: { name?: string | RegExp }): WebLocator {
    return new WebLocator(this.session, { kind: 'role', role, name: opts?.name });
  }

  getByText(text: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return new WebLocator(this.session, { kind: 'text', text, exact: opts?.exact });
  }

  getByLabel(label: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return new WebLocator(this.session, { kind: 'label', label, exact: opts?.exact });
  }

  getByPlaceholder(text: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return new WebLocator(this.session, { kind: 'placeholder', text, exact: opts?.exact });
  }

  getByTestId(testId: string): WebLocator {
    return new WebLocator(this.session, { kind: 'testId', testId });
  }

  getByAltText(text: string | RegExp): WebLocator {
    return new WebLocator(this.session, { kind: 'altText', text });
  }

  getByTitle(text: string | RegExp): WebLocator {
    return new WebLocator(this.session, { kind: 'title', text });
  }

  // ─── Page-level methods ──────────────────────────────────────

  async url(): Promise<string> {
    return this.session.url();
  }

  async title(): Promise<string> {
    return this.session.title();
  }

  async goto(url: string): Promise<void> {
    await this.session.goto(url);
  }

  async reload(): Promise<void> {
    await this.session.reload();
  }

  async evaluate<T>(fn: string | (() => T)): Promise<T> {
    const expr = typeof fn === 'function' ? `(${fn.toString()})()` : fn;
    return this.session.evaluate<T>(expr);
  }

  async waitForURL(
    url: string | RegExp,
    opts?: { timeout?: number },
  ): Promise<void> {
    await retryUntil(
      () => this.session.url(),
      (current) => url instanceof RegExp ? url.test(current) : current === url,
      opts?.timeout ?? DEFAULT_TIMEOUT,
      () => `waitForURL: timed out waiting for URL to match "${url}"`,
    );
  }

  async waitForLoadState(
    state: 'load' | 'domcontentloaded' = 'load',
  ): Promise<void> {
    await this.session.waitForLoadState(state);
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
