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

// A page with device input over a fake text field that takes keyboard focus
// after `focusAfterTaps` native taps.
interface FakeFieldOptions {
  focusAfterTaps?: number;
  viewportWidth?: number;
}

function fakeField(opts: FakeFieldOptions = {}): FakeField {
  const events: string[] = [];
  let taps = 0;
  const { session, evaluateCalls } = fakeWebViewSession();
  session.evaluate = async <T>(expr: string): Promise<T> => {
    evaluateCalls.push(expr);
    if (expr.includes('getBoundingClientRect')) {
      return { x: 10, y: 20, viewportWidth: opts.viewportWidth ?? 400 } as T;
    }
    if (expr.includes('ownerDocument.activeElement')) {
      return (taps >= (opts.focusAfterTaps ?? 1)) as T;
    }
    return true as T;
  };
  const page = new Page(session);
  page._nativeInput = {
    bounds: async () => ({ x: 0, y: 100, width: 800, height: 1600 }),
    tap: async (x, y) => { taps++; events.push(`tap ${x},${y}`); },
    typeText: async (text) => { events.push(`type ${text}`); },
  };
  return { page, events, evaluateCalls };
}

const taps = (events: string[]): number => events.filter((e) => e.startsWith('tap ')).length;
const typedKeys = (events: string[]): string[] => events.filter((e) => e.startsWith('type ')).map((e) => e.slice('type '.length));

// ─── tap() ────────────────────────────────────────────────────

test.describe('MobileWebViewLocator.tap()', () => {
  test('taps natively at the element center, mapped onto the webview bounds', async () => {
    const { page, events } = fakeField();
    await page.locator('button').tap();
    // scale = 800 native / 400 CSS px wide = 2 → (10 * 2, 100 + 20 * 2)
    playwrightExpect(events).toEqual(['tap 20,140']);
  });

  test('fails clearly instead of tapping a bogus point when the webview has no width', async () => {
    const { page, events } = fakeField({ viewportWidth: 0 });
    await playwrightExpect(page.locator('button').tap()).rejects.toThrow(/no valid on-screen size/);
    playwrightExpect(events).toEqual([]);
  });

  test('waits until the element is visible, enabled and stable', async () => {
    const { page, evaluateCalls } = fakeField();
    await page.locator('button').tap();
    playwrightExpect(evaluateCalls[0]).toContain('checkElementStates(el, ["visible","enabled","stable"])');
  });

  test('without device input it fails clearly instead of faking a click', async () => {
    const { session } = fakeWebViewSession({ evaluateAlways: true });
    await playwrightExpect(new WebLocator(session, 'button').tap()).rejects.toThrow(
      /locator\.tap\(\): needs the page from screen\.getByWebView\(\)\.page\(\)/,
    );
  });

  test('device input carries over into iframe locators', async () => {
    const { page, events } = fakeField();
    await page.frameLocator('#app').getByRole('button').tap();
    playwrightExpect(taps(events)).toBe(1);
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

test.describe('MobileWebViewLocator.fill()', () => {
  test('sets the value in-page without tapping or typing, even with device input', async () => {
    const { page, events, evaluateCalls } = fakeField();
    await page.locator('input').fill('a@b.c');
    playwrightExpect(events).toEqual([]);
    playwrightExpect(evaluateCalls.some((c) => c.includes('const next = "a@b.c";'))).toBe(true);
  });

  test('clear() empties the field in-page, like fill(\'\')', async () => {
    const { page, events, evaluateCalls } = fakeField();
    await page.locator('input').clear();
    playwrightExpect(events).toEqual([]);
    playwrightExpect(evaluateCalls.some((c) => c.includes('const next = "";'))).toBe(true);
  });

  test('without device input sets the value in-page', async () => {
    const { session, evaluateCalls } = fakeWebViewSession({ evaluateAlways: true });
    await new WebLocator(session, 'input').fill('x1');
    playwrightExpect(evaluateCalls.some((c) => c.includes('const next = "x1";'))).toBe(true);
  });
});

// ─── pressSequentially() ──────────────────────────────────────

test.describe('MobileWebViewLocator.pressSequentially()', () => {
  test('taps the field, then sends the keys one by one through the device keyboard', async () => {
    const { page, events, evaluateCalls } = fakeField();
    await page.locator('input').pressSequentially('a@b');
    playwrightExpect(events).toEqual(['tap 20,140', 'type a', 'type @', 'type b']);
    playwrightExpect(evaluateCalls.some((c) => c.includes('a@b'))).toBe(false);
  });

  test('sends a character outside the basic plane as a single key', async () => {
    const { page, events } = fakeField();
    await page.locator('input').pressSequentially('a😀');
    playwrightExpect(typedKeys(events)).toEqual(['a', '😀']);
  });

  test('taps again when the first tap did not give the field keyboard focus', async () => {
    const { page, events } = fakeField({ focusAfterTaps: 2 });
    await page.locator('input').pressSequentially('ab');
    playwrightExpect(events.map((e) => e.split(' ')[0])).toEqual(['tap', 'tap', 'type', 'type']);
  });

  test('fails without typing when the field never takes keyboard focus', async () => {
    const { page, events } = fakeField({ focusAfterTaps: 99 });
    await playwrightExpect(page.locator('input').pressSequentially('ab')).rejects.toThrow(/did not take keyboard focus/);
    playwrightExpect(typedKeys(events)).toEqual([]);
  });

  test('without device input it fails clearly instead of faking key events', async () => {
    const { session } = fakeWebViewSession({ evaluateAlways: true });
    await playwrightExpect(new WebLocator(session, 'input').pressSequentially('ab')).rejects.toThrow(
      /needs the page from screen\.getByWebView\(\)\.page\(\)/,
    );
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
