import { test, expect as playwrightExpect } from '@playwright/test';
import type { StepFn } from './locator.js';
import { Page } from './page.js';
import { WebLocator } from './web-locator.js';
import { expect } from './expect.js';
import { fakeWebViewSession } from './fake-webview-session.js';

// A step function that records the title of every step it wraps, then runs the body.
function recordingStepFn(): { stepFn: StepFn; titles: string[] } {
  const titles: string[] = [];
  const stepFn: StepFn = (title, body) => {
    titles.push(title);
    return body();
  };
  return { stepFn, titles };
}

// ─── Mock helpers ────────────────────────────────────────────

function sessionWithResponses(...evaluateResponses: unknown[]) {
  return fakeWebViewSession({ evaluateResponses, url: 'https://example.com/home', title: 'Home' });
}

function sessionWithUrl(currentUrl: string) {
  return fakeWebViewSession({ url: currentUrl, title: 'Page Title' });
}

// ─── Page.attach ─────────────────────────────────────────────

test.describe('Page.attach()', () => {
  test('injects only the engine bootstrap on attach (no hand-rolled DOM engine)', async () => {
    const { session, evaluateCalls } = sessionWithResponses();
    await Page.attach(session);
    playwrightExpect(evaluateCalls).toHaveLength(1);
    playwrightExpect(evaluateCalls[0]).toContain('window.__mwInjected = new (module.exports.InjectedScript())(globalThis,');
    playwrightExpect(evaluateCalls.some(c => c.includes('window.__mw.findBy'))).toBe(false);
  });

  test('returns a Page instance', async () => {
    const { session } = sessionWithResponses();
    const page = await Page.attach(session);
    playwrightExpect(page instanceof Page).toBe(true);
  });

  test('injects the Playwright engine bootstrap so window.__mwInjected exists', async () => {
    const { session, evaluateCalls } = sessionWithResponses();
    await Page.attach(session);
    const injectedBootstrap = evaluateCalls.some((c) =>
      c.includes('window.__mwInjected = new (module.exports.InjectedScript())(globalThis,'),
    );
    playwrightExpect(injectedBootstrap).toBe(true);
  });
});

// ─── Page-level methods ───────────────────────────────────────

test.describe('Page.url()', () => {
  test('returns the current page URL from the session', async () => {
    const { session } = sessionWithUrl('https://app.example.com/dashboard');
    const page = await Page.attach(session);
    playwrightExpect(await page.url()).toBe('https://app.example.com/dashboard');
  });
});

test.describe('Page.title()', () => {
  test('returns the page title from the session', async () => {
    const { session } = sessionWithUrl('https://example.com');
    const page = await Page.attach(session);
    playwrightExpect(await page.title()).toBe('Page Title');
  });
});

test.describe('Page.goto()', () => {
  test('calls session.goto with the given URL', async () => {
    const { session, gotoCalls } = sessionWithUrl('https://example.com');
    const page = await Page.attach(session);
    await page.goto('https://example.com/login');
    playwrightExpect(gotoCalls).toContain('https://example.com/login');
  });

  test('re-injects the engine after navigating (a new document drops window.__mwInjected)', async () => {
    const { session, evaluateCalls } = sessionWithResponses();
    const page = await Page.attach(session);
    await page.goto('https://example.com/login');
    // Engine bootstrap is injected once at attach and once more after goto.
    const injections = evaluateCalls.filter((c) =>
      c.includes('window.__mwInjected = new (module.exports.InjectedScript())(globalThis,'),
    );
    playwrightExpect(injections).toHaveLength(2);
  });
});

test.describe('Page.reload()', () => {
  test('calls session.reload', async () => {
    let reloaded = false;
    const { session } = sessionWithUrl('https://example.com');
    (session as any).reload = async () => { reloaded = true; };
    const page = await Page.attach(session);
    await page.reload();
    playwrightExpect(reloaded).toBe(true);
  });
});

test.describe('Page.evaluate()', () => {
  test('passes a string expression to the session', async () => {
    // One leading placeholder: Page.attach() runs a single evaluate() injection
    // (the engine bootstrap) before the real call.
    const { session, evaluateCalls } = sessionWithResponses(undefined, 42);
    const page = await Page.attach(session);
    const result = await page.evaluate<number>('1 + 1');
    playwrightExpect(result).toBe(42);
    playwrightExpect(evaluateCalls).toContain('1 + 1');
  });

  test('serialises a function to a string before evaluating', async () => {
    const { session, evaluateCalls } = sessionWithResponses(undefined, 'hello');
    const page = await Page.attach(session);
    await page.evaluate(() => 'hello');
    const functionCall = evaluateCalls.find(c => c.includes('hello'));
    playwrightExpect(functionCall).toBeDefined();
  });
});

test.describe('Page.content()', () => {
  test('evaluates document.documentElement.outerHTML', async () => {
    const html = '<html><body>hello</body></html>';
    // One leading placeholder for Page.attach()'s single evaluate() injection.
    const { session, evaluateCalls } = sessionWithResponses(undefined, html);
    const page = await Page.attach(session);
    const content = await page.content();
    playwrightExpect(content).toBe(html);
    playwrightExpect(evaluateCalls.some(c => c.includes('outerHTML'))).toBe(true);
  });
});

test.describe('Page.waitForLoadState()', () => {
  test('delegates to session.waitForLoadState', async () => {
    let calledWith: string | undefined;
    const { session } = sessionWithUrl('https://example.com');
    (session as any).waitForLoadState = async (state: string) => { calledWith = state; };
    const page = await Page.attach(session);
    await page.waitForLoadState('domcontentloaded');
    playwrightExpect(calledWith).toBe('domcontentloaded');
  });
});

test.describe('Page.close()', () => {
  test('calls session.close', async () => {
    let closed = false;
    const { session } = sessionWithUrl('https://example.com');
    (session as any).close = async () => { closed = true; };
    const page = await Page.attach(session);
    await page.close();
    playwrightExpect(closed).toBe(true);
  });
});

test.describe('Page.waitForURL()', () => {
  test('resolves when URL matches a string', async () => {
    const { session } = sessionWithUrl('https://example.com/dashboard');
    const page = await Page.attach(session);
    await page.waitForURL('https://example.com/dashboard', { timeout: 1000 });
  });

  test('resolves when URL matches a regex', async () => {
    const { session } = sessionWithUrl('https://example.com/dashboard');
    const page = await Page.attach(session);
    await page.waitForURL(/dashboard/, { timeout: 1000 });
  });

  test('rejects when URL never matches within timeout', async () => {
    const { session } = sessionWithUrl('https://example.com/home');
    const page = await Page.attach(session);
    await playwrightExpect(
      page.waitForURL('https://example.com/other', { timeout: 200 }),
    ).rejects.toThrow();
  });

  test('resets a stateful (global) regex so a leftover lastIndex does not cause a miss', async () => {
    const { session } = sessionWithUrl('https://example.com/dashboard');
    const page = await Page.attach(session);

    // A /g regex keeps lastIndex between .test() calls. Simulate leftover state
    // pointing past where "dashboard" appears (index 20).
    const staleGlobalRegex = /dashboard/g;
    staleGlobalRegex.lastIndex = 25;

    // timeout 0 → the predicate runs exactly once, so waitForURL must reset
    // lastIndex itself; otherwise the search starts at 25 and misses the match.
    await page.waitForURL(staleGlobalRegex, { timeout: 0 });
  });
});

// ─── Page locator factories ───────────────────────────────────

test.describe('Page locator factories', () => {
  test('locator() returns a WebLocator with css strategy', async () => {
    const { session } = sessionWithUrl('https://example.com');
    const page = await Page.attach(session);
    const loc = page.locator('.my-button');
    playwrightExpect(loc instanceof WebLocator).toBe(true);
  });

  test('getByRole() returns a WebLocator with role strategy', async () => {
    const { session } = sessionWithUrl('https://example.com');
    const page = await Page.attach(session);
    const loc = page.getByRole('button', { name: 'Sign In' });
    playwrightExpect(loc instanceof WebLocator).toBe(true);
  });

  test('getByTestId() returns a WebLocator with testId strategy', async () => {
    const { session } = sessionWithUrl('https://example.com');
    const page = await Page.attach(session);
    const loc = page.getByTestId('submit-btn');
    playwrightExpect(loc instanceof WebLocator).toBe(true);
  });
});

// ─── expect(page) assertions ─────────────────────────────────

test.describe('expect(page).toHaveURL()', () => {
  test('passes when URL matches string', async () => {
    const { session } = sessionWithUrl('https://example.com/dashboard');
    const page = await Page.attach(session);
    await expect(page).toHaveURL('https://example.com/dashboard');
  });

  test('passes when URL matches regex', async () => {
    const { session } = sessionWithUrl('https://example.com/dashboard');
    const page = await Page.attach(session);
    await expect(page).toHaveURL(/dashboard/);
  });

  test('fails when URL does not match', async () => {
    const { session } = sessionWithUrl('https://example.com/home');
    const page = await Page.attach(session);
    await playwrightExpect(
      expect(page).toHaveURL('https://example.com/other', { timeout: 200 }),
    ).rejects.toThrow();
  });

  test('not.toHaveURL passes when URL does not match', async () => {
    const { session } = sessionWithUrl('https://example.com/home');
    const page = await Page.attach(session);
    await expect(page).not.toHaveURL('https://example.com/other');
  });
});

test.describe('expect(page).toHaveTitle()', () => {
  test('passes when title matches string', async () => {
    const { session } = sessionWithUrl('https://example.com');
    (session as any).title = async () => 'Dashboard';
    const page = await Page.attach(session);
    await expect(page).toHaveTitle('Dashboard');
  });

  test('passes when title matches regex', async () => {
    const { session } = sessionWithUrl('https://example.com');
    (session as any).title = async () => 'My Dashboard';
    const page = await Page.attach(session);
    await expect(page).toHaveTitle(/Dashboard/);
  });
});

// ─── Step instrumentation ────────────────────────────────────

test.describe('Page step instrumentation', () => {
  test('navigation actions emit named steps', async () => {
    const { session } = sessionWithResponses();
    const { stepFn, titles } = recordingStepFn();
    const page = await Page.attach(session);
    page._stepFn = stepFn;

    await page.goto('https://example.com/login');
    await page.reload();
    await page.goBack();
    await page.goForward();
    await page.waitForLoadState('domcontentloaded');

    playwrightExpect(titles).toEqual([
      'page.goto("https://example.com/login")',
      'page.reload()',
      'page.goBack()',
      'page.goForward()',
      'page.waitForLoadState(domcontentloaded)',
    ]);
  });

  test('locator factories propagate the step function to web locators', async () => {
    const { session } = sessionWithResponses();
    const { stepFn } = recordingStepFn();
    const page = await Page.attach(session);
    page._stepFn = stepFn;

    playwrightExpect((page.locator('.btn') as WebLocator)._stepFn).toBe(stepFn);
    playwrightExpect((page.getByRole('button') as WebLocator)._stepFn).toBe(stepFn);
    playwrightExpect((page.getByTestId('submit') as WebLocator)._stepFn).toBe(stepFn);
  });

  test('page assertions emit expect steps', async () => {
    const { session } = sessionWithUrl('https://example.com/dashboard');
    const { stepFn, titles } = recordingStepFn();
    const page = await Page.attach(session);
    page._stepFn = stepFn;

    await expect(page).toHaveURL('https://example.com/dashboard');
    playwrightExpect(titles).toContain('expect.toHaveURL()');
  });

  test('actions run normally when no step function is set', async () => {
    const { session, gotoCalls } = sessionWithResponses();
    const page = await Page.attach(session);
    await page.goto('https://example.com/login');
    playwrightExpect(gotoCalls).toEqual(['https://example.com/login']);
  });
});
