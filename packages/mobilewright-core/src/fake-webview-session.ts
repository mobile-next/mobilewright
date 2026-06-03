import type { WebViewSession } from '@mobilewright/protocol';

// Shared test double for WebViewSession. Page and WebLocator only drive a
// session through evaluate()/goto()/url()/title(), so this records those calls
// and returns canned values; everything else is a no-op.

export interface FakeWebViewSession {
  session: WebViewSession;
  evaluateCalls: string[];
  gotoCalls: string[];
}

export interface FakeWebViewSessionOptions {
  // Values returned by successive evaluate() calls, indexed by call order.
  // Calls past the end of the list resolve to undefined.
  evaluateResponses?: unknown[];
  // When present, every evaluate() resolves to this value regardless of order.
  // Takes precedence over evaluateResponses.
  evaluateAlways?: unknown;
  url?: string;
  title?: string;
}

export function fakeWebViewSession(opts: FakeWebViewSessionOptions = {}): FakeWebViewSession {
  const evaluateCalls: string[] = [];
  const gotoCalls: string[] = [];
  let callIndex = 0;

  const session: WebViewSession = {
    evaluate: async (expr: string) => {
      evaluateCalls.push(expr);
      if ('evaluateAlways' in opts) {
        return opts.evaluateAlways as any;
      }
      const responses = opts.evaluateResponses ?? [];
      const idx = callIndex++;
      return (idx < responses.length ? responses[idx] : undefined) as any;
    },
    goto: async (url: string) => { gotoCalls.push(url); },
    goBack: async () => {},
    goForward: async () => {},
    url: async () => opts.url ?? 'https://example.com',
    title: async () => opts.title ?? 'Example',
    reload: async () => {},
    waitForLoadState: async () => {},
    close: async () => {},
  };

  return { session, evaluateCalls, gotoCalls };
}
