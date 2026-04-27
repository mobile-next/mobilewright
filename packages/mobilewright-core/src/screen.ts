import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  HardwareButton,
  MobilewrightDriver,
  ScreenshotOptions,
  SwipeDirection,
  SwipeOptions,
  ViewNode,
} from '@mobilewright/protocol';
import { Locator, type LocatorOptions } from './locator.js';
import type { Tracer } from './tracing.js';

export class Screen {
  private readonly root: Locator;
  private readonly _tracer: Tracer | null;

  constructor(
    private readonly driver: MobilewrightDriver,
    locatorDefaults: LocatorOptions = {},
    tracer?: Tracer | null,
  ) {
    this._tracer = tracer ?? null;
    this.root = Locator.root(driver, locatorDefaults, this._tracer);
  }

  private async _wrapAction<T>(method: string, params: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
    if (!this._tracer) {
      return fn();
    }
    return this._tracer.wrapAction('Screen', method, params, fn);
  }

  // ─── Locator factories (delegated to root locator) ─────────

  getByLabel(label: string, opts?: { exact?: boolean }): Locator {
    return this.root.getByLabel(label, opts);
  }

  getByTestId(testId: string): Locator {
    return this.root.getByTestId(testId);
  }

  getByText(text: string | RegExp, opts?: { exact?: boolean }): Locator {
    return this.root.getByText(text, opts);
  }

  getByType(type: string): Locator {
    return this.root.getByType(type);
  }

  getByRole(role: string, opts?: { name?: string | RegExp }): Locator {
    return this.root.getByRole(role, opts);
  }

  // ─── Direct screen actions ──────────────────────────────────

  async screenshot(opts?: ScreenshotOptions): Promise<Buffer> {
    return this._wrapAction('screenshot', {}, async () => {
      const buffer = await this.driver.screenshot(opts);
      if (opts?.path) {
        mkdirSync(dirname(opts.path), { recursive: true });
        writeFileSync(opts.path, buffer);
      }
      return buffer;
    });
  }

  async swipe(
    direction: SwipeDirection,
    opts?: SwipeOptions,
  ): Promise<void> {
    return this._wrapAction('swipe', { direction, ...opts }, async () => {
      await this.driver.swipe(direction, opts);
    });
  }

  async pressButton(button: HardwareButton): Promise<void> {
    return this._wrapAction('pressButton', { button }, async () => {
      await this.driver.pressButton(button);
    });
  }

  async tap(x: number, y: number): Promise<void> {
    return this._wrapAction('tap', { x, y }, async () => {
      await this.driver.tap(x, y);
    });
  }

  async goBack(): Promise<void> {
    return this._wrapAction('goBack', {}, async () => {
      await this.driver.pressButton('BACK');
    });
  }
  
  // ─── View tree ──────────────────────────────────────────────────

  async viewTree(): Promise<ViewNode[]> {
    return this.driver.getViewHierarchy();
  }
}
