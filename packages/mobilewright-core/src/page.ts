import type { WebViewSession } from '@mobilewright/protocol';
import type { StepFn } from './locator.js';
import { retryUntil } from './poll.js';
import { runStep } from './stackTrace.js';
import { WebLocator } from './web-locator.js';
import {
  bootstrapScript,
  getByRoleSelector,
  getByTextSelector,
  getByLabelSelector,
  getByPlaceholderSelector,
  getByTestIdSelector,
  getByAltTextSelector,
  getByTitleSelector,
  TEST_ID_ATTR,
} from './playwright-engine.js';

const DEFAULT_TIMEOUT = 5_000;

export class Page {
  _stepFn: StepFn | null = null;

  static async attach(session: WebViewSession): Promise<Page> {
    const page = new Page(session);
    await page.injectEngine();
    return page;
  }

  // (Re)inject the Playwright engine into the current document. Runs at attach
  // and after every navigation, because navigating creates a fresh document that
  // drops window.__mwInjected.
  private async injectEngine(): Promise<void> {
    await this.session.evaluate(bootstrapScript());
  }

  // Wait for the navigation to settle before injecting, otherwise a redirect
  // (e.g. a server bounce to a mobile host) replaces the document after we
  // inject and drops window.__mwInjected. Injecting once the load completes
  // targets the final document.
  private async settleAndInject(): Promise<void> {
    await this.session.waitForLoadState('load');
    await this.injectEngine();
  }

  constructor(readonly session: WebViewSession) {}

  // Build a WebLocator scoped to this page, carrying step instrumentation forward.
  private locatorFor(selector: string): WebLocator {
    const loc = new WebLocator(this.session, selector);
    loc._stepFn = this._stepFn;
    return loc;
  }

  private async _step<T>(title: string, fn: () => Promise<T>): Promise<T> {
    return runStep(this._stepFn, title, fn);
  }

  // ─── Locator factories ───────────────────────────────────────

  locator(selector: string): WebLocator {
    return this.locatorFor(selector);
  }

  getByRole(role: string, opts?: { name?: string | RegExp; exact?: boolean }): WebLocator {
    return this.locatorFor(getByRoleSelector(role, { name: opts?.name, exact: opts?.exact }));
  }

  getByText(text: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return this.locatorFor(getByTextSelector(text, { exact: opts?.exact }));
  }

  getByLabel(label: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return this.locatorFor(getByLabelSelector(label, { exact: opts?.exact }));
  }

  getByPlaceholder(text: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return this.locatorFor(getByPlaceholderSelector(text, { exact: opts?.exact }));
  }

  getByTestId(testId: string): WebLocator {
    return this.locatorFor(getByTestIdSelector(TEST_ID_ATTR, testId));
  }

  getByAltText(text: string | RegExp): WebLocator {
    return this.locatorFor(getByAltTextSelector(text));
  }

  getByTitle(text: string | RegExp): WebLocator {
    return this.locatorFor(getByTitleSelector(text));
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
      await this.settleAndInject();
    });
  }

  async reload(): Promise<void> {
    return this._step('page.reload()', async () => {
      await this.session.reload();
      await this.settleAndInject();
    });
  }

  async goBack(): Promise<void> {
    return this._step('page.goBack()', async () => {
      await this.session.goBack();
      await this.settleAndInject();
    });
  }

  async goForward(): Promise<void> {
    return this._step('page.goForward()', async () => {
      await this.session.goForward();
      await this.settleAndInject();
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
        (current) => {
          if (url instanceof RegExp) {
            url.lastIndex = 0;
            return url.test(current);
          }
          return current === url;
        },
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

  // screenshot() intentionally omitted until WebViewSession gains a capture
  // capability (a device.webview.screenshot RPC, or a native-screenshot crop to
  // the webview's nativeBounds). Adding it later is a non-breaking change.

  async close(): Promise<void> {
    await this.session.close();
  }
}
