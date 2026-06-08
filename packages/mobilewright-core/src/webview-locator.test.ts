import { test, expect as playwrightExpect } from '@playwright/test';
import type { MobilewrightDriver, ViewNode, WebViewInfo, WebViewSession } from '@mobilewright/protocol';
import type { LocatorStrategy } from './query-engine.js';
import { WebViewLocator } from './webview-locator.js';
import { Locator } from './locator.js';
import { Page } from './page.js';
import { fakeWebViewSession } from './fake-webview-session.js';

interface DriverFixtureOptions {
  // Number of native webview nodes present in the view hierarchy.
  nativeWebViews: number;
  // Webview ids reported by the webViewBridge.
  bridgeIds: string[];
}

interface DriverFixture {
  driver: MobilewrightDriver;
  // Records the ids passed to attachWebView, in order.
  attached: string[];
}

// ─── Mock helpers ────────────────────────────────────────────

// A native webview node as it appears in the view hierarchy.
function webViewNode(): ViewNode {
  return {
    type: 'android.webkit.WebView',
    isVisible: true,
    isEnabled: true,
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    children: [],
  };
}

// A driver exposing `nativeWebViews` webview nodes in its hierarchy and
// `bridgeIds` webviews through its webViewBridge.
function driverWith(opts: DriverFixtureOptions): DriverFixture {
  const attached: string[] = [];
  const roots: ViewNode[] = Array.from({ length: opts.nativeWebViews }, () => webViewNode());
  const bridge = {
    listWebViews: async (): Promise<WebViewInfo[]> =>
      opts.bridgeIds.map((id) => ({ id, url: 'https://example.com', title: 'Example' })),
    attachWebView: async (id: string): Promise<WebViewSession> => {
      attached.push(id);
      const { session } = fakeWebViewSession({ url: 'https://example.com', title: 'Example' });
      return session;
    },
  };
  const driver = {
    getViewHierarchy: async (): Promise<ViewNode[]> => roots,
    webViewBridge: bridge,
  } as unknown as MobilewrightDriver;
  return { driver, attached };
}

// A native, non-webview node (e.g. a plain button) in the view hierarchy.
function buttonNode(): ViewNode {
  return {
    type: 'android.widget.Button',
    isVisible: true,
    isEnabled: true,
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    children: [],
  };
}

// A driver whose hierarchy holds the given nodes and whose bridge reports the
// given webview ids.
function driverWithNodes(roots: ViewNode[], bridgeIds: string[]): DriverFixture {
  const attached: string[] = [];
  const bridge = {
    listWebViews: async (): Promise<WebViewInfo[]> =>
      bridgeIds.map((id) => ({ id, url: 'https://example.com', title: 'Example' })),
    attachWebView: async (id: string): Promise<WebViewSession> => {
      attached.push(id);
      const { session } = fakeWebViewSession({ url: 'https://example.com', title: 'Example' });
      return session;
    },
  };
  const driver = {
    getViewHierarchy: async (): Promise<ViewNode[]> => roots,
    webViewBridge: bridge,
  } as unknown as MobilewrightDriver;
  return { driver, attached };
}

// The strategy Screen.getByWebView() builds: every webview in the tree.
const WEBVIEW_STRATEGY: LocatorStrategy = {
  kind: 'chain',
  parent: { kind: 'root' },
  child: { kind: 'webview' },
};

function getByWebView(driver: MobilewrightDriver): WebViewLocator {
  return new WebViewLocator(driver, WEBVIEW_STRATEGY, {});
}

// ─── Tests ───────────────────────────────────────────────────

test.describe('WebViewLocator.page() resolution', () => {
  test('attaches the matching webview when exactly one resolves', async () => {
    const { driver, attached } = driverWith({ nativeWebViews: 1, bridgeIds: ['wv-1'] });
    const page = await getByWebView(driver).page();
    playwrightExpect(page instanceof Page).toBe(true);
    playwrightExpect(attached).toEqual(['wv-1']);
  });

  test('throws when the locator resolves to more than one webview', async () => {
    const { driver } = driverWith({ nativeWebViews: 2, bridgeIds: ['a', 'b'] });
    await playwrightExpect(getByWebView(driver).page()).rejects.toThrow(/did not resolve to a single webview/);
  });

  test('throws when the resolved index is out of range of the bridge webviews', async () => {
    // Two native webviews but only one bridge webview: .last() maps to index 1,
    // which must throw rather than clamp to the first/last bridge webview.
    const { driver } = driverWith({ nativeWebViews: 2, bridgeIds: ['only-one'] });
    await playwrightExpect(getByWebView(driver).last().page()).rejects.toThrow(/out of range/);
  });

  test('first() attaches the first webview', async () => {
    const { driver, attached } = driverWith({ nativeWebViews: 2, bridgeIds: ['wv-0', 'wv-1'] });
    const page = await getByWebView(driver).first().page();
    playwrightExpect(page instanceof Page).toBe(true);
    playwrightExpect(attached).toEqual(['wv-0']);
  });

  test('nth() attaches the webview at the given index', async () => {
    const { driver, attached } = driverWith({ nativeWebViews: 3, bridgeIds: ['wv-0', 'wv-1', 'wv-2'] });
    const page = await getByWebView(driver).nth(2).page();
    playwrightExpect(page instanceof Page).toBe(true);
    playwrightExpect(attached).toEqual(['wv-2']);
  });

  test('throws when the driver has no webViewBridge', async () => {
    const driver = {
      getViewHierarchy: async (): Promise<ViewNode[]> => [],
      webViewBridge: undefined,
    } as unknown as MobilewrightDriver;
    await playwrightExpect(getByWebView(driver).page()).rejects.toThrow(/does not have a webViewBridge/);
  });

  test('throws when the bridge reports no webviews', async () => {
    const { driver } = driverWith({ nativeWebViews: 1, bridgeIds: [] });
    await playwrightExpect(getByWebView(driver).page()).rejects.toThrow(/no webviews available/);
  });

  test('caches the page so a second page() call does not re-attach', async () => {
    const { driver, attached } = driverWith({ nativeWebViews: 1, bridgeIds: ['wv-0'] });
    const locator = getByWebView(driver);
    const first = await locator.page();
    const second = await locator.page();
    playwrightExpect(second).toBe(first);
    playwrightExpect(attached).toEqual(['wv-0']);
  });

  test('throws when the resolved node is not among the native webviews', async () => {
    // The hierarchy has a webview node, but the locator strategy resolves to a
    // single non-webview node — so it cannot be mapped to a bridge webview.
    const { driver } = driverWithNodes([webViewNode(), buttonNode()], ['wv-0']);
    const locator = new WebViewLocator(
      driver,
      { kind: 'type', value: 'android.widget.Button' },
      {},
    );
    await playwrightExpect(locator.page()).rejects.toThrow(/not among the native webviews/);
  });
});

test.describe('WebViewLocator chaining', () => {
  test('chaining into a DOM locator returns a plain Locator, not a WebViewLocator', async () => {
    const { driver } = driverWith({ nativeWebViews: 1, bridgeIds: ['wv-0'] });
    const child = getByWebView(driver).getByText('Submit');
    playwrightExpect(child instanceof Locator).toBe(true);
    playwrightExpect(child).not.toBeInstanceOf(WebViewLocator);
  });
});
