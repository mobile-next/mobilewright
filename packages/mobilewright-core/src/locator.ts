import sharp from 'sharp';
import type { MobilewrightDriver, ViewNode, Bounds } from '@mobilewright/protocol';
import { queryAll, type LocatorStrategy } from './query-engine.js';
import { sleep } from './sleep.js';

export interface LocatorOptions {
  timeout?: number;
  pollInterval?: number;
  stabilityDelay?: number;
}

const DEFAULT_TIMEOUT = 5_000;
const DEFAULT_POLL_INTERVAL = 100;
const DEFAULT_STABILITY_DELAY = 50;

export class Locator {
  /** Create a root locator that searches the entire view hierarchy. */
  static root(driver: MobilewrightDriver, options: LocatorOptions = {}): Locator {
    return new Locator(driver, { kind: 'root' }, options);
  }

  constructor(
    private readonly driver: MobilewrightDriver,
    private readonly strategy: LocatorStrategy,
    private readonly options: LocatorOptions = {},
  ) {}

  // ─── Chaining ────────────────────────────────────────────────

  getByLabel(label: string, opts?: { exact?: boolean }): Locator {
    return this.child({ kind: 'label', value: label, exact: opts?.exact });
  }

  getByTestId(testId: string): Locator {
    return this.child({ kind: 'testId', value: testId });
  }

  getByText(text: string | RegExp, opts?: { exact?: boolean }): Locator {
    return this.child({ kind: 'text', value: text, exact: opts?.exact });
  }

  getByType(type: string): Locator {
    return this.child({ kind: 'type', value: type });
  }

  getByRole(role: string, opts?: { name?: string | RegExp }): Locator {
    return this.child({ kind: 'role', value: role, name: opts?.name });
  }

  private child(childStrategy: LocatorStrategy): Locator {
    return new Locator(
      this.driver,
      { kind: 'chain', parent: this.strategy, child: childStrategy },
      this.options,
    );
  }

  // ─── Actions ─────────────────────────────────────────────────

  async tap(opts?: { timeout?: number }): Promise<void> {
    const node = await this.resolveActionable(opts?.timeout);
    const { x, y } = centerOf(node.bounds);
    await this.driver.tap(x, y);
  }

  async doubleTap(opts?: { timeout?: number }): Promise<void> {
    const node = await this.resolveActionable(opts?.timeout);
    const { x, y } = centerOf(node.bounds);
    await this.driver.doubleTap(x, y);
  }

  async longPress(opts?: { timeout?: number; duration?: number }): Promise<void> {
    const node = await this.resolveActionable(opts?.timeout);
    const { x, y } = centerOf(node.bounds);
    await this.driver.longPress(x, y, opts?.duration);
  }

  async fill(text: string, opts?: { timeout?: number }): Promise<void> {
    const node = await this.resolveActionable(opts?.timeout);
    const { x, y } = centerOf(node.bounds);
    // Tap to focus, then type
    await this.driver.tap(x, y);
    await this.driver.typeText(text);
  }

  async screenshot(opts?: { timeout?: number }): Promise<Buffer> {
    const node = await this.resolveVisible(opts?.timeout);
    const fullScreenshot = await this.driver.screenshot();
    return cropToElement(fullScreenshot, node.bounds, await this.driver.getScreenSize());
  }

  // ─── Queries (with auto-wait for visibility) ─────────────────

  async isVisible(opts?: { timeout?: number }): Promise<boolean> {
    try {
      await this.waitFor({ state: 'visible', timeout: opts?.timeout ?? 0 });
      return true;
    } catch {
      return false;
    }
  }

  async isEnabled(opts?: { timeout?: number }): Promise<boolean> {
    const node = await this.resolve(opts?.timeout ?? 0);
    return node !== null && node.isEnabled;
  }

  async getText(opts?: { timeout?: number }): Promise<string> {
    const node = await this.resolveVisible(opts?.timeout);
    return node.text ?? node.label ?? node.value ?? '';
  }

  async waitFor(opts?: {
    state?: 'visible' | 'hidden' | 'enabled' | 'disabled';
    timeout?: number;
  }): Promise<void> {
    await this.pollUntilState(opts?.state ?? 'visible', opts?.timeout);
  }

  // ─── Internal resolution ─────────────────────────────────────

  /** Wait for a visible node and return it. Used by getText, screenshot. */
  private async resolveVisible(timeout?: number): Promise<ViewNode> {
    const node = await this.pollUntilState('visible', timeout);
    return node!;
  }

  /** Poll until the given state is satisfied. Returns the matched node (or null for hidden/disabled). */
  private async pollUntilState(
    state: 'visible' | 'hidden' | 'enabled' | 'disabled',
    timeout?: number,
  ): Promise<ViewNode | null> {
    const effectiveTimeout = timeout ?? this.options.timeout ?? DEFAULT_TIMEOUT;
    const pollInterval = this.options.pollInterval ?? DEFAULT_POLL_INTERVAL;
    const deadline = Date.now() + effectiveTimeout;

    while (true) {
      const roots = await this.driver.getViewHierarchy();
      const node = queryAll(roots, this.strategy)[0] ?? null;

      if (checkState(node, state)) {
        return node;
      }

      if (Date.now() >= deadline) {
        throw new LocatorError(
          `Locator timed out waiting for state "${state}" after ${effectiveTimeout}ms`,
          this.strategy,
        );
      }

      await sleep(pollInterval);
    }
  }

  /** Resolve to a single actionable node (visible, enabled, stable bounds) */
  private async resolveActionable(
    timeout?: number,
  ): Promise<ViewNode> {
    const effectiveTimeout =
      timeout ?? this.options.timeout ?? DEFAULT_TIMEOUT;
    const pollInterval =
      this.options.pollInterval ?? DEFAULT_POLL_INTERVAL;
    const stabilityDelay =
      this.options.stabilityDelay ?? DEFAULT_STABILITY_DELAY;
    const deadline = Date.now() + effectiveTimeout;

    let previousBounds: Bounds | null = null;
    let lastReason = 'no matching element found';

    while (true) {
      const roots = await this.driver.getViewHierarchy();
      const node = queryAll(roots, this.strategy)[0];

      if (!node) {
        lastReason = 'no matching element found';
      } else if (!node.isVisible) {
        lastReason = 'element found but not visible';
      } else if (!node.isEnabled) {
        lastReason = 'element found but not enabled';
      } else {
        // Stability check: bounds haven't changed since last poll
        if (previousBounds && boundsEqual(previousBounds, node.bounds)) {
          return node;
        }
        previousBounds = { ...node.bounds };
        if (Date.now() >= deadline) return node; // accept without stability
        await sleep(stabilityDelay);
        continue;
      }

      if (Date.now() >= deadline) {
        throw new LocatorError(
          `Locator: ${lastReason} after ${effectiveTimeout}ms`,
          this.strategy,
        );
      }
      await sleep(pollInterval);
    }
  }

  /** Resolve without waiting — returns null if not found */
  private async resolve(timeout: number): Promise<ViewNode | null> {
    const deadline = Date.now() + timeout;
    const pollInterval =
      this.options.pollInterval ?? DEFAULT_POLL_INTERVAL;

    do {
      const roots = await this.driver.getViewHierarchy();
      const matches = queryAll(roots, this.strategy);
      if (matches.length > 0) return matches[0];
      if (timeout <= 0) return null;
      await sleep(pollInterval);
    } while (Date.now() < deadline);

    return null;
  }
}

async function cropToElement(
  screenshot: Buffer,
  bounds: Bounds,
  screenSize: { width: number; height: number },
): Promise<Buffer> {
  const metadata = await sharp(screenshot).metadata();
  const scale = (metadata.width ?? 1) / screenSize.width;
  return sharp(screenshot)
    .extract({
      left: Math.round(bounds.x * scale),
      top: Math.round(bounds.y * scale),
      width: Math.round(bounds.width * scale),
      height: Math.round(bounds.height * scale),
    })
    .toBuffer();
}

function centerOf(bounds: Bounds): { x: number; y: number } {
  return {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  };
}

function boundsEqual(a: Bounds, b: Bounds): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height
  );
}

function checkState(
  node: ViewNode | null,
  state: 'visible' | 'hidden' | 'enabled' | 'disabled',
): boolean {
  switch (state) {
    case 'visible':
      return node !== null && node.isVisible;
    case 'hidden':
      return node === null || !node.isVisible;
    case 'enabled':
      return node !== null && node.isEnabled;
    case 'disabled':
      return node !== null && !node.isEnabled;
  }
}

export class LocatorError extends Error {
  constructor(
    message: string,
    public readonly strategy: LocatorStrategy,
  ) {
    super(message);
    this.name = 'LocatorError';
  }
}
