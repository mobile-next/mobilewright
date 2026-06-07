import { test, expect as playwrightExpect } from '@playwright/test';
import type { WebViewSession } from '@mobilewright/protocol';
import { WebLocator } from './web-locator.js';

// A bootstrap re-injection is the only evaluate that assigns window.__mwInjected.
function isEngineBootstrap(expr: string): boolean {
  return expr.includes('__mwInjected =');
}

interface RecordingSession {
  session: WebViewSession;
  calls: string[];
}

// A session that fails the first engine-dependent evaluate with the exact error
// a dropped engine produces (as a page-initiated navigation would), then
// succeeds. Records every expression it was asked to evaluate.
function sessionThatLosesEngineOnce(finalResult: unknown): RecordingSession {
  const calls: string[] = [];
  let failedOnce = false;
  const session: WebViewSession = {
    evaluate: async <T>(expr: string): Promise<T> => {
      calls.push(expr);
      if (isEngineBootstrap(expr)) {
        return undefined as T;
      }
      if (!failedOnce) {
        failedOnce = true;
        throw new Error('Cannot read properties of undefined (reading \'querySelectorAll\')');
      }
      return finalResult as T;
    },
    goto: async () => {},
    goBack: async () => {},
    goForward: async () => {},
    url: async () => '',
    title: async () => '',
    reload: async () => {},
    waitForLoadState: async () => {},
    close: async () => {},
  };
  return { session, calls };
}

// A session whose evaluate always fails for a reason unrelated to the engine.
function sessionThatAlwaysFails(message: string): RecordingSession {
  const calls: string[] = [];
  const session: WebViewSession = {
    evaluate: async <T>(expr: string): Promise<T> => {
      calls.push(expr);
      throw new Error(message);
    },
    goto: async () => {},
    goBack: async () => {},
    goForward: async () => {},
    url: async () => '',
    title: async () => '',
    reload: async () => {},
    waitForLoadState: async () => {},
    close: async () => {},
  };
  return { session, calls };
}

test('re-injects the engine and retries when the page dropped window.__mwInjected', async () => {
  const { session, calls } = sessionThatLosesEngineOnce(3);
  const locator = new WebLocator(session, 'internal:role=link');

  const count = await locator.count();

  playwrightExpect(count).toBe(3);
  // The engine was re-injected after the first call failed...
  const reinjected = calls.filter(isEngineBootstrap).length;
  playwrightExpect(reinjected).toBe(1);
  // ...and the original count expression was retried (so it ran twice total).
  // (Match the count expr exactly — the bootstrap script also mentions
  // querySelectorAll internally.)
  const countEvals = calls.filter((c) => c.startsWith('window.__mwInjected.querySelectorAll'));
  playwrightExpect(countEvals.length).toBe(2);
});

test('does not re-inject when an evaluate fails for an unrelated reason', async () => {
  const { session, calls } = sessionThatAlwaysFails('some unrelated boom');
  const locator = new WebLocator(session, 'internal:role=link');

  let threw = false;
  try {
    await locator.count();
  } catch {
    threw = true;
  }

  playwrightExpect(threw).toBe(true);
  const reinjected = calls.filter(isEngineBootstrap).length;
  playwrightExpect(reinjected).toBe(0);
});
