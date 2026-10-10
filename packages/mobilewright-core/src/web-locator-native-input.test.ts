import { test, expect as playwrightExpect } from '@playwright/test';
import type { MobilewrightDriver, ViewNode, WebViewSession } from '@mobilewright/protocol';
import { Page } from './page.js';
import { WebLocator, SCREEN_POINT_BODY } from './web-locator.js';
import { WebViewLocator } from './webview-locator.js';
import { fakeWebViewSession } from './fake-webview-session.js';

interface FakeField {
  page: Page;
  events: string[];
  evaluateCalls: string[];
}

// A page with device input over a fake text field. The session answers the
// in-page calls as a real field would after the native taps and typing so far:
// it takes focus after `focusAfterTaps` taps, and typed text only lands from
// typing pass `landsOnAttempt` on.
function fakeField(opts: { focusAfterTaps?: number; landsOnAttempt?: number } = {}): FakeField {
  const events: string[] = [];
  let taps = 0;
  let typingPasses = 0;
  let value = '';
  const { session, evaluateCalls } = fakeWebViewSession();
  session.evaluate = async <T>(expr: string): Promise<T> => {
    evaluateCalls.push(expr);
    if (expr.includes('getBoundingClientRect')) {
      return { x: 10, y: 20, viewportWidth: 400 } as T;
    }
    if (expr.includes('ownerDocument.activeElement')) {
      return (taps >= (opts.focusAfterTaps ?? 1)) as T;
    }
    if (expr.includes('if (el.value) { el.value = \'\'')) {
      value = '';
      return undefined as T;
    }
    if (expr.includes('String(el.value')) {
      return value as T;
    }
    return true as T;
  };
  const page = new Page(session);
  page._nativeInput = {
    bounds: async () => ({ x: 0, y: 100, width: 800, height: 1600 }),
    tap: async (x, y) => { taps++; events.push(`tap ${x},${y}`); },
    typeText: async (text) => {
      typingPasses++;
      events.push(`type ${text}`);
      if (typingPasses >= (opts.landsOnAttempt ?? 1)) {
        value = text;
      }
    },
  };
  return { page, events, evaluateCalls };
}

const typingPasses = (events: string[]): number => events.filter((e) => e.startsWith('type ')).length;
const taps = (events: string[]): number => events.filter((e) => e.startsWith('tap ')).length;

// ─── tap() ────────────────────────────────────────────────────

test.describe('MobileWebViewLocator.tap()', () => {
  test('taps natively at the element center, mapped onto the webview bounds', async () => {
    const { page, events } = fakeField();
    await page.locator('button').tap();
    // scale = 800 native / 400 CSS px wide = 2 → (10 * 2, 100 + 20 * 2)
    playwrightExpect(events).toEqual(['tap 20,140']);
  });

  test('waits until the element is visible, enabled and stable', async () => {
    const { page, evaluateCalls } = fakeField();
    await page.locator('button').tap();
    playwrightExpect(evaluateCalls[0]).toContain('checkElementStates(el, ["visible","enabled","stable"])');
  });

  test('without device input it fails clearly instead of faking a click', async () => {
    const { session } = fakeWebViewSession({ evaluateAlways: true });
    await playwrightExpect(new WebLocator(session, 'button').tap()).rejects.toThrow(
      /real touch needs the page from screen\.getByWebView\(\)\.page\(\); use click\(\)/,
    );
  });

  test('device input carries over to chained and derived locators', async () => {
    const { page, events } = fakeField();
    await page.locator('form').getByRole('button').first().tap();
    playwrightExpect(taps(events)).toBe(1);
  });
});

// ─── The in-page screen point ─────────────────────────────────

interface Rect { left: number; top: number; width: number; height: number }
interface FakeWin { innerWidth?: number; frameElement?: unknown; parent?: FakeWin }

// Run the screen-point script for `el` with `top` as the top window.
function screenPoint(el: unknown, top: FakeWin): { x: number; y: number; viewportWidth: number } {
  return new Function('window', 'el', SCREEN_POINT_BODY)(top, el);
}

function element(rect: Rect, win: FakeWin): { scrolled: boolean } {
  const el = {
    scrolled: false,
    scrollIntoView: () => { el.scrolled = true; },
    getBoundingClientRect: () => rect,
    ownerDocument: { defaultView: win },
  };
  return el;
}

// An <iframe> element at `rect` with a `border` px border, inside `parent`.
function iframeIn(parent: FakeWin, rect: Rect, border: number): FakeWin {
  const frameElement = { getBoundingClientRect: () => rect, clientLeft: border, clientTop: border };
  return { frameElement, parent };
}

test.describe('tap() screen point', () => {
  test('is the element center in CSS pixels, after scrolling it into view', () => {
    const top: FakeWin = { innerWidth: 390 };
    const el = element({ left: 100, top: 200, width: 50, height: 20 }, top);
    playwrightExpect(screenPoint(el, top)).toEqual({ x: 125, y: 210, viewportWidth: 390 });
    playwrightExpect(el.scrolled).toBe(true);
  });

  test('adds the offset and border of every iframe the element sits in', () => {
    const top: FakeWin = { innerWidth: 390 };
    const outer = iframeIn(top, { left: 30, top: 120, width: 300, height: 400 }, 7);
    const inner = iframeIn(outer, { left: 5, top: 10, width: 200, height: 200 }, 1);
    const el = element({ left: 100, top: 200, width: 50, height: 20 }, inner);
    // x: 125 + (5 + 1) + (30 + 7) = 168; y: 210 + (10 + 1) + (120 + 7) = 348
    playwrightExpect(screenPoint(el, top)).toEqual({ x: 168, y: 348, viewportWidth: 390 });
  });
});

// ─── fill() ───────────────────────────────────────────────────

test.describe('MobileWebViewLocator.fill() with device input', () => {
  test('taps the field, clears it in-page, then types through the device keyboard', async () => {
    const { page, events, evaluateCalls } = fakeField();
    await page.locator('input').fill('a@b.c');
    playwrightExpect(events).toEqual(['tap 20,140', 'type a@b.c']);
    const clear = evaluateCalls.find((c) => c.includes('if (el.value) { el.value = \'\''));
    playwrightExpect(clear).toBeDefined();
    playwrightExpect(evaluateCalls.some((c) => c.includes('a@b.c'))).toBe(false);
  });

  test('taps again when the first tap did not give the field keyboard focus', async () => {
    const { page, events } = fakeField({ focusAfterTaps: 2 });
    await page.locator('input').fill('a@b.c');
    playwrightExpect(taps(events)).toBe(2);
    playwrightExpect(typingPasses(events)).toBe(1);
  });

  test('types once more when the text did not reach the field', async () => {
    const { page, events } = fakeField({ landsOnAttempt: 2 });
    await page.locator('input').fill('Secret1!');
    playwrightExpect(typingPasses(events)).toBe(2);
  });

  test('fails clearly, without revealing the text, when it never reaches the field', async () => {
    const { page } = fakeField({ landsOnAttempt: 99 });
    const error = await page.locator('input').fill('Secret1!').then(() => null, (e: Error) => e);
    playwrightExpect(error?.message).toContain('the typed text did not reach the field after 2 attempts (it holds 0 of 8 characters)');
    playwrightExpect(error?.message).not.toContain('Secret1!');
  });

  test('verify: false types exactly once, without checking the value', async () => {
    const { page, events } = fakeField({ landsOnAttempt: 99 });
    await (page.locator('input') as WebLocator).fill('123456', { verify: false });
    playwrightExpect(typingPasses(events)).toBe(1);
  });

  test('verify: false still waits for focus before typing', async () => {
    const { page, events } = fakeField({ focusAfterTaps: 2 });
    await (page.locator('input') as WebLocator).fill('123456', { verify: false });
    playwrightExpect(events.map((e) => e.split(' ')[0])).toEqual(['tap', 'tap', 'type']);
  });

  test('without device input fill() still sets the value in-page', async () => {
    const { session, evaluateCalls } = fakeWebViewSession({ evaluateAlways: true });
    await new WebLocator(session, 'input').fill('x1');
    playwrightExpect(evaluateCalls.some((c) => c.includes('el.value = "x1"'))).toBe(true);
  });
});

// ─── Wiring from screen.getByWebView().page() ─────────────────

test.describe('getByWebView().page() device input', () => {
  test('taps through the driver at the webview\'s live on-screen bounds', async () => {
    const webview: ViewNode = {
      type: 'android.webkit.WebView',
      isVisible: true,
      isEnabled: true,
      bounds: { x: 0, y: 100, width: 800, height: 1600 },
      children: [],
    };
    const driverTaps: Array<[number, number]> = [];
    const typed: string[] = [];
    let session: WebViewSession | undefined;
    const driver = {
      getViewHierarchy: async (): Promise<ViewNode[]> => [webview],
      tap: async (x: number, y: number) => { driverTaps.push([x, y]); },
      typeText: async (text: string) => { typed.push(text); },
      webViewBridge: {
        listWebViews: async () => [{ id: 'w1', url: 'https://example.com', title: 'Example' }],
        attachWebView: async () => {
          session = fakeWebViewSession({ evaluateAlways: { x: 10, y: 20, viewportWidth: 400 } }).session;
          return session;
        },
      },
    } as unknown as MobilewrightDriver;

    const page = await new WebViewLocator(driver, { kind: 'webview' }).page();
    await page.locator('button').tap();
    await page._nativeInput!.typeText('hi');

    playwrightExpect(driverTaps).toEqual([[20, 140]]);
    playwrightExpect(typed).toEqual(['hi']);
  });
});
