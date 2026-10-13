import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  GestureSequence,
  HardwareButton,
  MobilewrightDriver,
  ScreenshotOptions,
  SwipeDirection,
  SwipeOptions,
  ViewNode,
} from '@mobilewright/protocol';
import { Locator, type LocatorOptions, type StepFn } from './locator.js';
import { runStep } from './stackTrace.js';
import { WebViewLocator } from './webview-locator.js';
import type { Role } from './query-engine.js';
import { findDialog, type Dialog, type DialogHandler } from './dialog.js';
import { sleep } from './sleep.js';

const DEFAULT_TIMEOUT = 5_000;
const DEFAULT_POLL_INTERVAL = 100;

export interface GetByWebViewOptions {
  /** Match a web view whose native testId (accessibility id / resource-id) equals this. */
  testId?: string;
}

export type DialogPredicate = (dialog: Dialog) => boolean;

export interface WaitForDialogOptions {
  predicate?: DialogPredicate;
  /** Maximum time to wait in ms. Default: the action timeout (5000). */
  timeout?: number;
}

export class Screen {
  private readonly root: Locator;
  private readonly driver: MobilewrightDriver;
  private dialogHandlers: DialogHandler[] = [];
  // key of the dialog last reported, so each dialog fires 'dialog' once rather than on every poll
  private lastDialogKey: string | undefined;

  constructor(
    private readonly rawDriver: MobilewrightDriver,
    private readonly locatorDefaults: LocatorOptions = {},
  ) {
    // Every locator poll and expect() retry fetches the view tree through this driver,
    // so that is where dialogs get spotted, at no extra cost per poll.
    this.driver = new Proxy(rawDriver, {
      get: (target, prop) => {
        if (prop === 'getViewHierarchy') {
          return () => this.viewTreeHandlingDialogs();
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    this.root = Locator.root(this.driver, locatorDefaults);
  }

  // ─── Dialogs ──────────────────────────────────────────────────

  /**
   * Listen for alerts and permission dialogs. Dialogs are detected while an action or
   * expect() polls the screen; the handler should call dialog.accept(), dismiss() or tap().
   * Without a listener, dialogs are left alone.
   */
  on(event: 'dialog', handler: DialogHandler): this {
    this.dialogHandlers = [...this.dialogHandlers, handler];
    return this;
  }

  once(event: 'dialog', handler: DialogHandler): this {
    const wrapper: DialogHandler = (dialog) => {
      this.off(event, wrapper);
      return handler(dialog);
    };
    return this.on(event, wrapper);
  }

  off(event: 'dialog', handler: DialogHandler): this {
    this.dialogHandlers = this.dialogHandlers.filter((h) => h !== handler);
    return this;
  }

  /**
   * Wait for the next dialog, like Playwright's page.waitForEvent('dialog'). Start waiting before the
   * action that opens it; the dialog is left for you to accept or dismiss. Unlike a browser, the device
   * doesn't push dialog events, so this polls the screen until a dialog shows up.
   */
  async waitForEvent(event: 'dialog', optionsOrPredicate?: DialogPredicate | WaitForDialogOptions): Promise<Dialog> {
    const options = typeof optionsOrPredicate === 'function' ? { predicate: optionsOrPredicate } : optionsOrPredicate ?? {};
    const timeout = options.timeout ?? this.locatorDefaults.timeout ?? DEFAULT_TIMEOUT;
    const pollInterval = this.locatorDefaults.pollInterval ?? DEFAULT_POLL_INTERVAL;
    let found: Dialog | undefined;
    const handler: DialogHandler = (dialog) => {
      if (!found && (options.predicate?.(dialog) ?? true)) {
        found = dialog;
      }
    };
    this.on(event, handler);
    try {
      const deadline = Date.now() + timeout;
      while (!found) {
        if (Date.now() > deadline) {
          throw new Error(`Timeout ${timeout}ms exceeded while waiting for event "${event}"`);
        }
        await this.viewTreeHandlingDialogs();
        if (!found) {
          await sleep(pollInterval);
        }
      }
      return found;
    } finally {
      this.off(event, handler);
    }
  }

  private async viewTreeHandlingDialogs(): Promise<ViewNode[]> {
    const roots = await this.rawDriver.getViewHierarchy();
    if (this.dialogHandlers.length === 0) {
      return roots;
    }
    const dialog = findDialog(roots, this.rawDriver);
    if (dialog?.key === this.lastDialogKey) {
      return roots;
    }
    this.lastDialogKey = dialog?.key;
    if (!dialog) {
      return roots;
    }
    await this.emitDialog(dialog);
    return this.rawDriver.getViewHierarchy();
  }

  private async emitDialog(dialog: Dialog): Promise<void> {
    for (const handler of this.dialogHandlers) {
      await handler(dialog);
    }
  }

  setStepFn(fn: StepFn): void {
    this.root._stepFn = fn;
  }

  private async _step<T>(title: string, fn: () => Promise<T>): Promise<T> {
    return runStep(this.root._stepFn, title, fn);
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

  getByRole(role: Role, opts?: { name?: string | RegExp }): Locator {
    return this.root.getByRole(role, opts);
  }

  getByPlaceholder(placeholder: string, opts?: { exact?: boolean }): Locator {
    return this.root.getByPlaceholder(placeholder, opts);
  }

  getByWebView(opts?: GetByWebViewOptions): WebViewLocator {
    const loc = new WebViewLocator(
      this.driver,
      { kind: 'chain', parent: { kind: 'root' }, child: { kind: 'webview', testId: opts?.testId } },
      this.locatorDefaults,
    );
    loc._stepFn = this.root._stepFn;
    return loc;
  }

  // ─── Direct screen actions ──────────────────────────────────

  async screenshot(opts?: ScreenshotOptions): Promise<Buffer> {
    return this._step('screen.screenshot()', async () => {
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
    return this._step('screen.swipe()', () => this.driver.swipe(direction, opts));
  }

  async pressButton(button: HardwareButton): Promise<void> {
    return this._step('screen.pressButton()', () => this.driver.pressButton(button));
  }

  async tap(x: number, y: number): Promise<void> {
    return this._step('screen.tap()', () => this.driver.tap(x, y));
  }

  async doubleTap(x: number, y: number): Promise<void> {
    return this._step('screen.doubleTap()', () => this.driver.doubleTap(x, y));
  }

  async longPress(x: number, y: number, duration?: number): Promise<void> {
    return this._step('screen.longPress()', () => this.driver.longPress(x, y, duration));
  }

  async gesture(sequence: GestureSequence): Promise<void> {
    return this._step('screen.gesture()', () => this.driver.gesture(sequence));
  }

  async goBack(): Promise<void> {
    return this._step('screen.goBack()', () => this.driver.pressButton('BACK'));
  }
  
  // ─── View tree ──────────────────────────────────────────────────

  async viewTree(): Promise<ViewNode[]> {
    return this.driver.getViewHierarchy();
  }
}
