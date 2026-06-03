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
    if (this._page) return this._page;

    const bridge = this.driver.webViewBridge;
    if (!bridge) {
      throw new Error(
        'getByWebView().page(): this driver does not have a webViewBridge',
      );
    }

    const roots = await this.driver.getViewHierarchy();
    const selected = queryAll(roots, this.strategy);
    if (selected.length === 0) {
      throw new Error('getByWebView().page(): no webview element found in the view hierarchy');
    }

    // Match native webview index to bridge webview list
    const allNativeWebviews = queryAll(roots, { kind: 'webview' });
    const index = allNativeWebviews.indexOf(selected[0]);
    const bridgeWebviews = await bridge.listWebViews();
    const target = bridgeWebviews[Math.max(0, index)];
    if (!target) {
      throw new Error('getByWebView().page(): bridge returned no webviews');
    }

    const session = await bridge.attachWebView(target.id);
    this._page = await Page.attach(session);
    this._page._stepFn = this._stepFn;
    return this._page;
  }
}
