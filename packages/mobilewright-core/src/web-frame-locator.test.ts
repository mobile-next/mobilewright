import { test, expect as playwrightExpect } from '@playwright/test';
import type { WebViewSession } from '@mobilewright/protocol';
import { Page } from './page.js';
import { WebLocator } from './web-locator.js';
import { buildExpectEvaluate } from './web-expect-matcher.js';
import {
  bootstrapScript,
  evaluateWithEngine,
  FRAME_ENGINE_SOURCE_MISSING,
  getByRoleSelector,
  getByTestIdSelector,
  INJECTED_SOURCE,
  installFrameScope,
  scopedEngineExpr,
  splitFrames,
  TEST_ID_ATTR,
} from './playwright-engine.js';
import { fakeWebViewSession } from './fake-webview-session.js';

const ENTER = ' >> internal:control=enter-frame >> ';

// The expression count() sends for a locator, which shows how it resolves.
async function countExpr(locator: { count(): Promise<number> }, evaluateCalls: string[]): Promise<string> {
  await locator.count();
  return evaluateCalls[evaluateCalls.length - 1];
}

// ─── Selectors ────────────────────────────────────────────────

test.describe('frame locator selectors', () => {
  test('splitFrames separates the iframe path from the selector inside it', () => {
    playwrightExpect(splitFrames('button')).toEqual({ frames: [], selector: 'button' });
    playwrightExpect(splitFrames(`#app${ENTER}#nested${ENTER}button`)).toEqual({ frames: ['#app', '#nested'], selector: 'button' });
  });

  test('page.frameLocator() resolves its locators inside the iframe', async () => {
    const { session, evaluateCalls } = fakeWebViewSession({ evaluateAlways: 2 });
    const page = new Page(session);
    const button = page.frameLocator('#app').locator('button');

    playwrightExpect(await button.count()).toBe(2);
    const expr = evaluateCalls[0];
    playwrightExpect(expr).toContain('window.__mwFrameScope(["#app"])');
    playwrightExpect(expr).toContain('f.is.querySelectorAll(f.is.parseSelector("button"), f.doc)');
  });

  test('locator.contentFrame() and locator.frameLocator() match page.frameLocator()', async () => {
    const { session, evaluateCalls } = fakeWebViewSession({ evaluateAlways: 0 });
    const page = new Page(session);

    const viaPage = await countExpr(page.frameLocator('#app').locator('button'), evaluateCalls);
    const viaContentFrame = await countExpr(page.locator('#app').contentFrame().locator('button'), evaluateCalls);
    const viaLocator = await countExpr(page.locator('main').frameLocator('#app').locator('button'), evaluateCalls);

    playwrightExpect(viaContentFrame).toBe(viaPage);
    playwrightExpect(viaLocator).toContain('window.__mwFrameScope(["main >> #app"])');
  });

  test('getBy* inside a frame use the exact Playwright selectors', async () => {
    const { session, evaluateCalls } = fakeWebViewSession({ evaluateAlways: 0 });
    const frame = new Page(session).frameLocator('#app');

    const role = await countExpr(frame.getByRole('button', { name: 'OK' }), evaluateCalls);
    playwrightExpect(role).toContain(`parseSelector(${JSON.stringify(getByRoleSelector('button', { name: 'OK' }))})`);
    const testId = await countExpr(frame.getByTestId('save'), evaluateCalls);
    playwrightExpect(testId).toContain(`parseSelector(${JSON.stringify(getByTestIdSelector(TEST_ID_ATTR, 'save'))})`);
  });

  test('nested frame locators enter each iframe in turn', async () => {
    const { session, evaluateCalls } = fakeWebViewSession({ evaluateAlways: 0 });
    const page = new Page(session);
    const expr = await countExpr(page.frameLocator('#app').frameLocator('#nested').getByText('deep'), evaluateCalls);
    playwrightExpect(expr).toContain('window.__mwFrameScope(["#app","#nested"])');
  });

  test('first(), last() and nth() pick the iframe, not an element inside it', async () => {
    const { session, evaluateCalls } = fakeWebViewSession({ evaluateAlways: 0 });
    const frames = new Page(session).frameLocator('iframe');

    playwrightExpect(await countExpr(frames.first().locator('p'), evaluateCalls)).toContain('window.__mwFrameScope(["iframe >> nth=0"])');
    playwrightExpect(await countExpr(frames.last().locator('p'), evaluateCalls)).toContain('window.__mwFrameScope(["iframe >> nth=-1"])');
    playwrightExpect(await countExpr(frames.nth(2).locator('p'), evaluateCalls)).toContain('window.__mwFrameScope(["iframe >> nth=2"])');
  });

  test('owner() is the <iframe> element in the page document', async () => {
    const { session, evaluateCalls } = fakeWebViewSession({ evaluateAlways: 0 });
    const owner = new Page(session).frameLocator('#app').owner();
    const expr = await countExpr(owner, evaluateCalls);
    playwrightExpect(expr).not.toContain('__mwFrameScope');
    playwrightExpect(expr).toContain('parseSelector("#app")');
  });

  test('selectors in the page document do not go through the frame helper', async () => {
    const { session, evaluateCalls } = fakeWebViewSession({ evaluateAlways: 0 });
    const expr = await countExpr(new WebLocator(session, 'button'), evaluateCalls);
    playwrightExpect(expr).toBe('window.__mwInjected.querySelectorAll(window.__mwInjected.parseSelector("button"), document).length');
  });

  test('actions and queries inside a frame resolve the element through the frame helper', async () => {
    const { session, evaluateCalls } = fakeWebViewSession({ evaluateAlways: true });
    const button = new Page(session).frameLocator('#app').locator('button');
    await button.click();
    playwrightExpect(evaluateCalls.length).toBeGreaterThan(0);
    for (const call of evaluateCalls) {
      playwrightExpect(call).toContain('window.__mwFrameScope(["#app"])');
    }
  });

  test('page.frameLocator() without a selector is not supported', () => {
    const { session } = fakeWebViewSession();
    playwrightExpect(() => new Page(session).frameLocator()).toThrow(/pass a selector for the <iframe>/);
  });

  test('expect() inside a frame runs the matcher in the iframe', () => {
    const js = buildExpectEvaluate(`#app${ENTER}button`, { expression: 'to.be.visible', isNot: false, timeout: 0 });
    playwrightExpect(js).toContain('window.__mwFrameScope(["#app"])');
    playwrightExpect(js).toContain('is.querySelectorAll(is.parseSelector("button"), f.doc)');
  });
});

// ─── The in-page frame helper ─────────────────────────────────

// Minimal stand-ins for windows and the injected engine: an engine resolves a
// selector by looking it up in its document's `elements` map.
interface FakeDocument { elements: Record<string, unknown> }
interface FakeWindow {
  document: FakeDocument;
  eval(source: string): unknown;
  __mwInjected?: unknown;
  __mwEngineSource?: string;
  __mwFrameScope?: (frames: string[]) => { is: unknown; doc: FakeDocument } | null;
}

function fakeEngine() {
  return {
    parseSelector: (selector: string) => selector,
    querySelector: (selector: string, doc: FakeDocument) => doc.elements[selector] ?? null,
    querySelectorAll: (selector: string, doc: FakeDocument) => (selector in doc.elements ? [doc.elements[selector]] : []),
  };
}

// A window whose document holds `elements`; eval() of the engine source
// installs a fake engine, as the real engine script does.
function fakeWindow(elements: Record<string, unknown> = {}): FakeWindow & { evals: number } {
  const win: FakeWindow & { evals: number } = {
    document: { elements },
    evals: 0,
    eval(source: string) {
      win.evals++;
      if (source === 'ENGINE') {
        win.__mwInjected = fakeEngine();
      }
    },
  };
  return win;
}

// A top window with the engine and frame helper installed, as after Page.attach.
// engineSource null: the source has not been sent yet.
function topWindow(elements: Record<string, unknown>, engineSource: string | null = 'ENGINE'): FakeWindow {
  const top = fakeWindow(elements);
  top.__mwInjected = fakeEngine();
  installFrameScope(top as unknown as Parameters<typeof installFrameScope>[0], 'SOURCE_MISSING');
  if (engineSource !== null) {
    top.__mwEngineSource = engineSource;
  }
  return top;
}

// Evaluate an in-page expression against a fake top window.
function evaluateIn(top: FakeWindow, expr: string): unknown {
  return new Function('window', 'document', `return ${expr};`)(top, top.document);
}

test.describe('installFrameScope', () => {
  test('enters a same-origin iframe and injects the engine there once', () => {
    const inner = fakeWindow({ button: 'the-button' });
    const top = topWindow({ '#app': { contentWindow: inner } });

    const scope = top.__mwFrameScope!(['#app']);
    top.__mwFrameScope!(['#app']);

    playwrightExpect(scope!.doc).toBe(inner.document);
    playwrightExpect(scope!.is).toBe(inner.__mwInjected);
    playwrightExpect(inner.evals).toBe(1);
  });

  test('enters nested iframes, each found in its parent document', () => {
    const deep = fakeWindow({ p: 'deep' });
    const middle = fakeWindow({ '#nested': { contentWindow: deep } });
    const top = topWindow({ '#app': { contentWindow: middle } });

    playwrightExpect(top.__mwFrameScope!(['#app', '#nested'])!.doc).toBe(deep.document);
  });

  test('returns null while an iframe on the path is missing', () => {
    const top = topWindow({});
    playwrightExpect(top.__mwFrameScope!(['#app'])).toBeNull();
  });

  test('refuses a cross-origin iframe with a clear error', () => {
    const crossOrigin = { get document(): never { throw new Error('SecurityError: Blocked a frame'); } };
    const top = topWindow({ '#ad': { contentWindow: crossOrigin } });
    playwrightExpect(() => top.__mwFrameScope!(['#ad'])).toThrow(/cannot enter cross-origin iframe #ad/);
  });

  test('asks for the engine source when it has not been sent yet', () => {
    const top = topWindow({ '#app': { contentWindow: fakeWindow() } }, null);
    playwrightExpect(() => top.__mwFrameScope!(['#app'])).toThrow('SOURCE_MISSING');
  });

  test('fails clearly when the engine cannot be injected into the iframe', () => {
    const top = topWindow({ '#app': { contentWindow: fakeWindow() } }, 'NOT_AN_ENGINE');
    playwrightExpect(() => top.__mwFrameScope!(['#app'])).toThrow(/could not inject the engine into iframe #app/);
  });

  test('scoped expressions run inside the iframe, or fall back when it is missing', () => {
    const count = (is: string, doc: string, sel: string) => `${is}.querySelectorAll(${is}.parseSelector(${sel}), ${doc}).length`;
    const expr = scopedEngineExpr(`#app${ENTER}button`, count, '0');

    const inner = fakeWindow({ button: 'the-button' });
    playwrightExpect(evaluateIn(topWindow({ '#app': { contentWindow: inner } }), expr)).toBe(1);
    playwrightExpect(evaluateIn(topWindow({}), expr)).toBe(0);
  });

  test('the bootstrap script installs the helper without a second copy of the engine', () => {
    const script = bootstrapScript();
    playwrightExpect(script).toContain('__mwFrameScope');
    // The helper asks for the source with the message evaluateWithEngine listens for.
    playwrightExpect(script).toContain(JSON.stringify(FRAME_ENGINE_SOURCE_MISSING));
    playwrightExpect(script.length).toBeLessThan(INJECTED_SOURCE.length * 1.5);
    // A webview bridge evaluates expressions, not statement lists.
    playwrightExpect(() => new Function(`return (${script});`)).not.toThrow();
  });
});

// ─── Sending the engine source on demand ──────────────────────

// A session that fails with `failure` until the engine source is sent.
function sessionNeedingFrameSource(failure: string): { session: WebViewSession; calls: string[] } {
  const calls: string[] = [];
  let sourceSent = false;
  const { session } = fakeWebViewSession();
  session.evaluate = async <T>(expr: string): Promise<T> => {
    calls.push(expr);
    if (expr.includes('window.__mwEngineSource =')) {
      sourceSent = true;
      return undefined as T;
    }
    if (!sourceSent) {
      throw new Error(failure);
    }
    return 1 as T;
  };
  return { session, calls };
}

test.describe('evaluateWithEngine and iframes', () => {
  test('sends the engine source once, the first time a selector enters an iframe, then retries', async () => {
    const { session, calls } = sessionNeedingFrameSource(`Error: ${FRAME_ENGINE_SOURCE_MISSING}`);

    playwrightExpect(await evaluateWithEngine(session, 'EXPR')).toBe(1);
    playwrightExpect(calls.filter((c) => c.includes('window.__mwEngineSource =')).length).toBe(1);
    playwrightExpect(calls.filter((c) => c === 'EXPR').length).toBe(2);
  });

  test('re-injects a dropped engine when the frame helper is gone with it', async () => {
    const calls: string[] = [];
    let injected = false;
    const { session } = fakeWebViewSession();
    session.evaluate = async <T>(expr: string): Promise<T> => {
      calls.push(expr);
      if (expr.includes('__mwInjected = new')) {
        injected = true;
        return undefined as T;
      }
      if (!injected) {
        throw new Error('TypeError: window.__mwFrameScope is not a function');
      }
      return 1 as T;
    };

    playwrightExpect(await evaluateWithEngine(session, 'EXPR')).toBe(1);
    playwrightExpect(calls.filter((c) => c.includes('__mwInjected = new')).length).toBe(1);
  });
});
