import { queryAll, type LocatorStrategy } from './query-engine.js';
import { Locator } from './locator.js';
import { Page } from './page.js';

export class WebViewLocator extends Locator {
  private _page: Page | null = null;

  // first/last/nth stay within webview context so .page() remains available
  override first(): WebViewLocator {
    return this.nthWebView(0);
  }

  override last(): WebViewLocator {
    return this.nthWebView(-1);
  }

  override nth(index: number): WebViewLocator {
    return this.nthWebView(index);
  }

  private nthWebView(index: number): WebViewLocator {
    const loc = new WebViewLocator(
      this.driver,
      { kind: 'nth', parent: this.strategy, index },
      this.options,
    );
    loc._stepFn = this._stepFn;
    return loc;
  }

  // Chaining into DOM locators returns a plain Locator, not WebViewLocator
  protected override child(childStrategy: LocatorStrategy): Locator {
    const loc = new Locator(
      this.driver,
      { kind: 'chain', parent: this.strategy, child: childStrategy },
      this.options,
    );
    loc._stepFn = this._stepFn;
    return loc;
  }

  async page(): Promise<Page> {
    return this._step('getByWebView().page()', () => this._resolvePage());
  }

  private async _resolvePage(): Promise<Page> {
    if (this._page) { return this._page; }

    const bridge = this.driver.webViewBridge;
    if (!bridge) {
      throw new Error(
        'getByWebView().page(): this driver does not have a webViewBridge',
      );
    }

    const bridgeWebviews = await bridge.listWebViews();
    if (bridgeWebviews.length === 0) {
      throw new Error('getByWebView().page(): no webviews available on the device');
    }

    // Map this locator to a specific webview by its position among native
    // webview nodes. Platforms like iOS flatten webview content into the
    // accessibility tree without a dedicated webview node, so when the hierarchy
    // exposes none we can only attach an unambiguous single webview.
    const roots = await this.driver.getViewHierarchy();
    const allNativeWebviews = queryAll(roots, { kind: 'webview' });
    let index = 0;
    if (allNativeWebviews.length > 0) {
      const selected = queryAll(roots, this.strategy);
      if (selected.length !== 1) {
        throw new Error(
          'getByWebView().page(): locator did not resolve to a single webview ' +
            `(matched ${selected.length} of ${allNativeWebviews.length}); ` +
            'use .first(), .last(), or .nth(i) to choose one. ' +
            `Strategy: ${JSON.stringify(this.strategy)}`,
        );
      }
      const matched = allNativeWebviews.indexOf(selected[0]);
      if (matched === -1) {
        throw new Error(
          'getByWebView().page(): resolved node is not among the native webviews. ' +
            `Strategy: ${JSON.stringify(this.strategy)}`,
        );
      }
      index = matched;
    } else if (bridgeWebviews.length > 1) {
      // No native webview nodes to position-match against, yet several webviews
      // exist — attaching index 0 would silently ignore .last()/.nth(i), so fail.
      throw new Error(
        'getByWebView().page(): the platform exposes no native webview nodes to ' +
          `select by position, but ${bridgeWebviews.length} webviews are available — ` +
          'cannot disambiguate which to attach. ' +
          `Strategy: ${JSON.stringify(this.strategy)}`,
      );
    }

    if (index < 0 || index >= bridgeWebviews.length) {
      throw new Error(
        `getByWebView().page(): webview index ${index} is out of range ` +
          `(${bridgeWebviews.length} webview(s) available from the bridge). ` +
          `Strategy: ${JSON.stringify(this.strategy)}`,
      );
    }
    const target = bridgeWebviews[index];

    const session = await bridge.attachWebView(target.id);
    try {
      this._page = await Page.attach(session);
      this._page._stepFn = this._stepFn;
      return this._page;
    } catch (err) {
      // Engine injection failed — release the session we just opened rather than
      // leaking it. Swallow close errors so the original failure propagates.
      await session.close().catch(() => {});
      throw err;
    }
  }
}
