import type { Page as PlaywrightPage, Locator, Frame, Response, BrowserContext } from '@playwright/test';
import type { WebViewSession } from '@mobilewright/protocol';
import type { StepFn } from './locator.js';
import { sleep } from './sleep.js';
import { runStep } from './stackTrace.js';
import { MobileWebViewLocator } from './web-locator.js';
import { type ExpectedTextValue } from './web-expect-matcher.js';
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
const POLL_INTERVAL = 100;

// Apply Playwright's whitespace normalization (collapse runs, trim) when asked.
function normalizeText(value: string, normalize?: boolean): string {
  return normalize ? value.trim().replace(/\s+/g, ' ') : value;
}

// Match an actual string against one of Playwright's ExpectedTextValue entries
// (string/substring/regex, with optional case- and whitespace-insensitivity).
// Used for the document-level title assertion, which has no element to drive.
function matchExpectedText(actual: string, etv: ExpectedTextValue): boolean {
  const a = normalizeText(actual, etv.normalizeWhiteSpace);
  if (etv.regexSource !== undefined) {
    const flags = etv.ignoreCase ? `${etv.regexFlags ?? ''}i` : etv.regexFlags ?? '';
    return new RegExp(etv.regexSource, flags).test(a);
  }
  if (etv.string !== undefined) {
    let expected = normalizeText(etv.string, etv.normalizeWhiteSpace);
    let got = a;
    if (etv.ignoreCase) {
      expected = expected.toLowerCase();
      got = got.toLowerCase();
    }
    return etv.matchSubstring ? got.includes(expected) : got === expected;
  }
  return false;
}

interface FrameExpectOptions {
  isNot?: boolean;
  timeout?: number;
  expectedText?: ExpectedTextValue[];
}

interface FrameExpectResult {
  matches: boolean;
  received?: unknown;
  timedOut: boolean;
}

type UrlPredicate = (url: URL) => boolean;

// The minimal main-frame surface Playwright's page-level matchers reach for:
// expect(page).toHaveTitle() calls mainFrame()._expect('to.have.title', …) and
// expect(page).toHaveURL() calls mainFrame().waitForURL(predicate, …).
class MobileWebViewMainFrame {
  constructor(private readonly session: WebViewSession) {}

  async _expect(expression: string, options: FrameExpectOptions): Promise<FrameExpectResult> {
    // Both are document-level (no element): toHaveTitle → 'to.have.title',
    // toHaveURL (string/regex) → 'to.have.url'.
    const readValue =
      expression === 'to.have.title' ? (): Promise<string> => this.session.title()
        : expression === 'to.have.url' ? (): Promise<string> => this.session.url()
          : null;
    if (!readValue) {
      throw new Error(`MobileWebViewPage: page-level expectation "${expression}" is not supported`);
    }
    const isNot = options.isNot ?? false;
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const expected = options.expectedText?.[0];
    const deadline = Date.now() + timeout;
    let value = '';
    let matches = false;

    const check = async (): Promise<boolean> => {
      value = await readValue();
      matches = expected ? matchExpectedText(value, expected) : false;
      return matches !== isNot;
    };

    let reached = await check();
    while (!reached && Date.now() < deadline) {
      await sleep(POLL_INTERVAL);
      reached = await check();
    }
    return { matches, received: value, timedOut: !reached };
  }

  async waitForURL(match: string | RegExp | UrlPredicate, options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const deadline = Date.now() + timeout;
    const matches = (current: string): boolean => {
      if (typeof match === 'function') {
        return match(new URL(current));
      }
      if (match instanceof RegExp) {
        match.lastIndex = 0;
        return match.test(current);
      }
      return current === match;
    };

    let current = await this.session.url();
    while (!matches(current) && Date.now() < deadline) {
      await sleep(POLL_INTERVAL);
      current = await this.session.url();
    }
    if (!matches(current)) {
      throw new Error(`waitForURL: timed out waiting for URL to match "${String(match)}"`);
    }
  }
}

export class MobileWebViewPage {
  _stepFn: StepFn | null = null;
  private _url = 'about:blank';
  private readonly _frame: MobileWebViewMainFrame;

  static async attach(session: WebViewSession): Promise<MobileWebViewPage> {
    const page = new MobileWebViewPage(session);
    await page.injectEngine();
    page._url = await session.url();
    return page;
  }

  constructor(readonly session: WebViewSession) {
    this._frame = new MobileWebViewMainFrame(session);
  }

  // (Re)inject the Playwright engine into the current document. Runs at attach
  // and after every navigation, because navigating creates a fresh document that
  // drops window.__mwInjected.
  private async injectEngine(): Promise<void> {
    await this.session.evaluate(bootstrapScript());
  }

  // Wait for the navigation to settle before injecting, otherwise a redirect
  // (e.g. a server bounce to a mobile host) replaces the document after we
  // inject and drops window.__mwInjected. Also refresh the cached URL that the
  // synchronous url() returns.
  private async settleAndInject(): Promise<void> {
    await this.session.waitForLoadState('load');
    await this.injectEngine();
    this._url = await this.session.url();
  }

  // Build a MobileWebViewLocator scoped to this page, carrying step instrumentation forward.
  private locatorFor(selector: string): MobileWebViewLocator {
    const loc = new MobileWebViewLocator(this.session, selector);
    loc._stepFn = this._stepFn;
    return loc;
  }

  private async _step<T>(title: string, fn: () => Promise<T>): Promise<T> {
    return runStep(this._stepFn, title, fn);
  }

  // ─── Locator factories ───────────────────────────────────────

  locator(selector: string): Locator {
    return this.locatorFor(selector);
  }

  getByRole(role: string, opts?: { name?: string | RegExp; exact?: boolean }): Locator {
    return this.locatorFor(getByRoleSelector(role, { name: opts?.name, exact: opts?.exact }));
  }

  getByText(text: string | RegExp, opts?: { exact?: boolean }): Locator {
    return this.locatorFor(getByTextSelector(text, { exact: opts?.exact }));
  }

  getByLabel(label: string | RegExp, opts?: { exact?: boolean }): Locator {
    return this.locatorFor(getByLabelSelector(label, { exact: opts?.exact }));
  }

  getByPlaceholder(text: string | RegExp, opts?: { exact?: boolean }): Locator {
    return this.locatorFor(getByPlaceholderSelector(text, { exact: opts?.exact }));
  }

  getByTestId(testId: string): Locator {
    return this.locatorFor(getByTestIdSelector(TEST_ID_ATTR, testId));
  }

  getByAltText(text: string | RegExp): Locator {
    return this.locatorFor(getByAltTextSelector(text));
  }

  getByTitle(text: string | RegExp): Locator {
    return this.locatorFor(getByTitleSelector(text));
  }

  // ─── Page-level methods ──────────────────────────────────────

  // Synchronous, matching Playwright's Page.url(); returns the last-known URL,
  // refreshed after each navigation we drive.
  url(): string {
    return this._url;
  }

  async title(): Promise<string> {
    return this.session.title();
  }

  mainFrame(): Frame {
    return this._frame as unknown as Frame;
  }

  // Minimal context — expect(page).toHaveURL() reads context()._options.baseURL.
  context(): BrowserContext {
    return { _options: {} } as unknown as BrowserContext;
  }

  async goto(url: string): Promise<Response | null> {
    return this._step(`page.goto(${JSON.stringify(url)})`, async () => {
      await this.session.goto(url);
      await this.settleAndInject();
      return null;
    });
  }

  async reload(): Promise<Response | null> {
    return this._step('page.reload()', async () => {
      await this.session.reload();
      await this.settleAndInject();
      return null;
    });
  }

  async goBack(): Promise<Response | null> {
    return this._step('page.goBack()', async () => {
      await this.session.goBack();
      await this.settleAndInject();
      return null;
    });
  }

  async goForward(): Promise<Response | null> {
    return this._step('page.goForward()', async () => {
      await this.session.goForward();
      await this.settleAndInject();
      return null;
    });
  }

  // Typed to Playwright's exact (overloaded) evaluate signature; we only support
  // a string expression or a zero-arg function.
  evaluate = (async (pageFunction: unknown, arg?: unknown): Promise<unknown> => {
    const expr = typeof pageFunction === 'function'
      ? `(${pageFunction.toString()})(${arg !== undefined ? JSON.stringify(arg) : ''})`
      : String(pageFunction);
    return this.session.evaluate(expr);
  }) as unknown as PlaywrightPage['evaluate'];

  async waitForURL(
    url: string | RegExp | UrlPredicate,
    opts?: { timeout?: number },
  ): Promise<void> {
    return this._step(`page.waitForURL(${String(url)})`, async () => {
      await this._frame.waitForURL(url, opts);
      this._url = await this.session.url();
    });
  }

  async waitForLoadState(
    state: 'load' | 'domcontentloaded' | 'networkidle' = 'load',
  ): Promise<void> {
    return this._step(`page.waitForLoadState(${state})`, async () => {
      await this.session.waitForLoadState(state === 'networkidle' ? 'load' : state);
    });
  }

  async content(): Promise<string> {
    return this.session.evaluate<string>('document.documentElement.outerHTML');
  }

  async close(): Promise<void> {
    await this.session.close();
  }
}

// Playwright's matchers gate on `receiver.constructor.name === 'Page'`
// (expectTypes in playwright/lib/util). Report that name so expect() from
// @playwright/test accepts a MobileWebViewPage.
Object.defineProperty(MobileWebViewPage, 'name', { value: 'Page', configurable: true });

// Declaration-merge the rest of Playwright's Page surface in as ambient: the
// members we implement are signature-checked against it; the rest are typed as
// present (drop-in Playwright Page) and throw a TypeError at runtime if called.
export interface MobileWebViewPage extends PlaywrightPage {}

// Back-compat alias for internal callers that still import Page.
export { MobileWebViewPage as Page };
