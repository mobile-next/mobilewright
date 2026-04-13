import type {
  HardwareButton,
  MobilewrightDriver,
  ScreenshotOptions,
  SwipeDirection,
  SwipeOptions,
  ViewNode,
} from '@mobilewright/protocol';
import { Locator, type LocatorOptions } from './locator.js';

export class Screen {
  private readonly root: Locator;

  constructor(
    private readonly driver: MobilewrightDriver,
    locatorDefaults: LocatorOptions = {},
  ) {
    this.root = Locator.root(driver, locatorDefaults);
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
    return this.driver.screenshot(opts);
  }

  async swipe(
    direction: SwipeDirection,
    opts?: SwipeOptions,
  ): Promise<void> {
    return this.driver.swipe(direction, opts);
  }

  async pressButton(button: HardwareButton): Promise<void> {
    return this.driver.pressButton(button);
  }

  async tap(x: number, y: number): Promise<void> {
    return this.driver.tap(x, y);
  }

  // ─── View tree ──────────────────────────────────────────────────

  async viewTree(): Promise<ViewNode[]> {
    return this.driver.getViewHierarchy();
  }
}
