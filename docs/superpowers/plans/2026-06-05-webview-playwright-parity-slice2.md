# Webview Playwright Parity — Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled web selector engine with Playwright's imported injected engine across the entire `WebLocator`/`Page` surface — `WebLocator` carries a Playwright selector string and every method resolves through `window.__mwInjected`.

**Architecture:** `playwright-engine.ts` re-exports all seven selector builders. `WebLocator`'s `strategy` union becomes a single `selector: string`; element resolution centralizes in `firstEl()` (`querySelector` strict) and `count()` (`querySelectorAll`); chaining composes `parent >> child`; `nth` appends `>> nth=i`; state checks use the injected `elementState`/`checkElementStates`. `buildFindAll`, `WebLocatorStrategy`, and `DOM_SELECTOR_ENGINE` are deleted.

**Tech Stack:** TypeScript (ESM), Playwright Test, `playwright-core@1.58.2`, `fakeWebViewSession`.

**Spec:** `docs/superpowers/specs/2026-06-05-webview-playwright-parity-slice2-design.md`

Repo rules: `{ }` blocks always; assign `await` to a variable before using in a condition/argument; sync test helpers.

---

## File Structure

- **Modify** `playwright-engine.ts` — re-export all seven builders + `TEST_ID_ATTR`.
- **Rewrite** `web-locator.ts` — selector-string representation; injected resolution; remove `buildFindAll`/`WebLocatorStrategy`/`_pwSelector`/`clickViaInjectedEngine`.
- **Modify** `page.ts` — factories build selector strings; `attach()` injects only the bootstrap; drop `DOM_SELECTOR_ENGINE`.
- **Modify** `index.ts` — drop the `WebLocatorStrategy` export.
- **Delete** `dom-selector-engine.ts` and `dom-selector-engine.test.ts`.
- **Rewrite** `web-locator.test.ts` — selector-string construction + injected-engine assertions.
- **Modify** `page.test.ts` — revert slice-1 placeholder bumps; repurpose the DOM-engine test.

---

### Task 1: Extend `playwright-engine.ts` with all selector builders

**Files:**
- Modify: `packages/mobilewright-core/src/playwright-engine.ts`
- Test: `packages/mobilewright-core/src/playwright-engine.test.ts`

- [ ] **Step 1: Write the failing test** — append inside the existing `playwright-engine adapter` describe block in `playwright-engine.test.ts`:

```ts
  test('re-exports the other selector builders with exact Playwright output', () => {
    playwrightExpect(getByTextSelector('Hello')).toBe('internal:text="Hello"i');
    playwrightExpect(getByTextSelector('Hello', true)).toBe('internal:text="Hello"s');
    playwrightExpect(getByLabelSelector('Email')).toBe('internal:label="Email"i');
    playwrightExpect(getByPlaceholderSelector('Search')).toBe('internal:attr=[placeholder="Search"i]');
    playwrightExpect(getByAltTextSelector('logo')).toBe('internal:attr=[alt="logo"i]');
    playwrightExpect(getByTitleSelector('Close')).toBe('internal:attr=[title="Close"i]');
    playwrightExpect(getByTestIdSelector(TEST_ID_ATTR, 'submit')).toBe('internal:testid=[data-testid="submit"s]');
  });
```

And update the import line at the top of the test file to:

```ts
import {
  bootstrapScript,
  getByRoleSelector,
  getByTextSelector,
  getByLabelSelector,
  getByPlaceholderSelector,
  getByAltTextSelector,
  getByTitleSelector,
  getByTestIdSelector,
  TEST_ID_ATTR,
  INJECTED_SOURCE,
} from './playwright-engine.js';
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx c8 --include 'packages/mobilewright-core/src/playwright-engine.ts' playwright test --config=tests/mobilewright.config.ts playwright-engine`
Expected: FAIL — `getByTextSelector` etc. are not exported.

- [ ] **Step 3: Implement** — in `playwright-engine.ts`, replace the `locatorUtils` require + the two exports with the full set:

```ts
type TextBuilder = (value: string | RegExp, exact?: boolean) => string;

const locatorUtils = require(join(pkgRoot, 'lib/utils/isomorphic/locatorUtils.js')) as {
  getByRoleSelector: GetByRoleSelector;
  getByTextSelector: TextBuilder;
  getByLabelSelector: TextBuilder;
  getByPlaceholderSelector: TextBuilder;
  getByAltTextSelector: TextBuilder;
  getByTitleSelector: TextBuilder;
  getByTestIdSelector: (attrName: string, value: string | RegExp) => string;
};

export const INJECTED_SOURCE: string = injected.source;
export const TEST_ID_ATTR = 'data-testid';
export const getByRoleSelector: GetByRoleSelector = locatorUtils.getByRoleSelector;
export const getByTextSelector: TextBuilder = locatorUtils.getByTextSelector;
export const getByLabelSelector: TextBuilder = locatorUtils.getByLabelSelector;
export const getByPlaceholderSelector: TextBuilder = locatorUtils.getByPlaceholderSelector;
export const getByAltTextSelector: TextBuilder = locatorUtils.getByAltTextSelector;
export const getByTitleSelector: TextBuilder = locatorUtils.getByTitleSelector;
export const getByTestIdSelector = locatorUtils.getByTestIdSelector;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx c8 --include 'packages/mobilewright-core/src/playwright-engine.ts' playwright test --config=tests/mobilewright.config.ts playwright-engine`
Expected: PASS.

- [ ] **Step 5: Commit** (skipped — leave staged per project no-auto-commit rule)

---

### Task 2: Rewrite `web-locator.ts` to the selector-string representation

**Files:**
- Replace entire contents: `packages/mobilewright-core/src/web-locator.ts`

This is an atomic representation switch — it won't compile until `page.ts`/`index.ts` (Task 3) and the deletions are done, so the checkpoint is a full build at the end of Task 3. Replace the whole file with:

```ts
import createDebug from 'debug';
import type { Bounds, WebViewSession } from '@mobilewright/protocol';
import type { StepFn } from './locator.js';
import { retryUntil } from './poll.js';
import { runStep } from './stackTrace.js';
import {
  getByRoleSelector,
  getByTextSelector,
  getByLabelSelector,
  getByPlaceholderSelector,
  getByAltTextSelector,
  getByTitleSelector,
  getByTestIdSelector,
  TEST_ID_ATTR,
} from './playwright-engine.js';

const DEFAULT_TIMEOUT = 5_000;

const debug = createDebug('mw:web-locator');

export class WebLocator {
  _stepFn: StepFn | null = null;

  constructor(
    protected readonly session: WebViewSession,
    // A Playwright selector string (e.g. 'internal:role=button[name="OK"i]' or a
    // raw CSS selector). Resolved in-page by the imported Playwright engine.
    protected readonly selector: string,
  ) {}

  // Build a WebLocator from a selector, carrying step instrumentation forward.
  private derive(selector: string): WebLocator {
    const loc = new WebLocator(this.session, selector);
    loc._stepFn = this._stepFn;
    return loc;
  }

  // Compose a child selector within this locator's scope, Playwright-style.
  private child(childSelector: string): WebLocator {
    return this.derive(`${this.selector} >> ${childSelector}`);
  }

  private async _step<T>(title: string, fn: () => Promise<T>): Promise<T> {
    return runStep(this._stepFn, title, fn);
  }

  // JS expression resolving to the first match via the imported Playwright
  // engine. strict=true: a selector matching >1 element throws a strict-mode
  // violation in-page, matching Playwright's strict locators.
  private firstEl(): string {
    const sel = JSON.stringify(this.selector);
    return `window.__mwInjected.querySelector(window.__mwInjected.parseSelector(${sel}), document, true)`;
  }

  private firstElExpr(body: string): string {
    return `(() => { const el = ${this.firstEl()}; ${body} })()`;
  }

  private evalOnFirst<T = void>(body: string): Promise<T> {
    return this.session.evaluate<T>(this.firstElExpr(body));
  }

  // Run a mutating action against the first match. Throws in-page when the
  // element is absent so the action rejects instead of silently no-op'ing.
  private actOnFirst(action: string, what: string): Promise<void> {
    const notFound = JSON.stringify(`${what}: element not found`);
    return this.session.evaluate<void>(
      `(() => { const el = ${this.firstEl()}; if (!el) { throw new Error(${notFound}); } ${action} })()`,
    );
  }

  // Poll a boolean predicate, retrying until true or timeout. timeout 0 checks
  // once. Transient errors (missing element, mid-navigation) count as false, but
  // strict-mode violations propagate — matching Playwright's isVisible.
  private async pollBoolean(js: string, timeout: number, what: string): Promise<boolean> {
    const read = async (): Promise<boolean> => {
      try {
        return await this.session.evaluate<boolean>(js);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message.includes('strict mode violation')) { throw e; }
        debug('"%s" check evaluation failed, treating as false: %s', what, message);
        return false;
      }
    };
    if (timeout === 0) {
      return read();
    }
    try {
      let result = false;
      await retryUntil(
        async () => { result = await read(); return result; },
        (v) => v,
        timeout,
        `WebLocator: timed out waiting for element to be ${what}`,
      );
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes('strict mode violation')) { throw e; }
      return false;
    }
  }

  // Resolve the element (waiting up to timeout) and read an injected element
  // state. Throws "<what>: element not found" when no element resolves —
  // matching Playwright's isEnabled/isChecked, which require an attached element.
  private async readElementState(state: 'enabled' | 'checked', timeout: number, what: string): Promise<boolean> {
    const sel = JSON.stringify(this.selector);
    const stateArg = JSON.stringify(state);
    const js = `(() => { const is = window.__mwInjected; const el = is.querySelector(is.parseSelector(${sel}), document, true); if (!el) { return null; } return is.elementState(el, ${stateArg}).matches; })()`;
    let result: boolean | null = null;
    await retryUntil(
      async () => { result = await this.session.evaluate<boolean | null>(js); return result !== null; },
      (found) => found,
      timeout,
      `${what}: element not found`,
    );
    return result as boolean;
  }

  // Wait for the element to be visible, then return a value read from it.
  private async readFromFirst<T>(valueExpr: string, opts?: { timeout?: number }): Promise<T> {
    await this.pollUntilVisible(opts?.timeout ?? DEFAULT_TIMEOUT);
    return this.evalOnFirst<T>(`return ${valueExpr};`);
  }

  private async readStringProp(prop: string, opts?: { timeout?: number }): Promise<string> {
    return this.readFromFirst<string>(`el?.${prop} ?? ''`, opts);
  }

  // ─── Chaining ────────────────────────────────────────────────

  locator(selector: string): WebLocator {
    return this.child(selector);
  }

  getByRole(role: string, opts?: { name?: string | RegExp; exact?: boolean }): WebLocator {
    return this.child(getByRoleSelector(role, { name: opts?.name, exact: opts?.exact }));
  }

  getByText(text: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return this.child(getByTextSelector(text, { exact: opts?.exact }));
  }

  getByLabel(label: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return this.child(getByLabelSelector(label, { exact: opts?.exact }));
  }

  getByPlaceholder(text: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return this.child(getByPlaceholderSelector(text, { exact: opts?.exact }));
  }

  getByTestId(testId: string): WebLocator {
    return this.child(getByTestIdSelector(TEST_ID_ATTR, testId));
  }

  getByAltText(text: string | RegExp): WebLocator {
    return this.child(getByAltTextSelector(text));
  }

  getByTitle(text: string | RegExp): WebLocator {
    return this.child(getByTitleSelector(text));
  }

  // ─── Collection ──────────────────────────────────────────────

  first(): WebLocator {
    return this.nth(0);
  }

  last(): WebLocator {
    return this.nth(-1);
  }

  nth(index: number): WebLocator {
    return this.derive(`${this.selector} >> nth=${index}`);
  }

  async count(): Promise<number> {
    const sel = JSON.stringify(this.selector);
    return this.session.evaluate<number>(
      `window.__mwInjected.querySelectorAll(window.__mwInjected.parseSelector(${sel}), document).length`,
    );
  }

  // Aliases matching native Locator's API so LocatorAssertions works with WebLocator
  async getText(opts?: { timeout?: number }): Promise<string> {
    return this.textContent(opts);
  }

  async getValue(opts?: { timeout?: number }): Promise<string> {
    return this.inputValue(opts);
  }

  async all(): Promise<WebLocator[]> {
    const n = await this.count();
    return Array.from({ length: n }, (_, i) => this.nth(i));
  }

  // ─── State queries ───────────────────────────────────────────

  async isVisible(opts?: { timeout?: number }): Promise<boolean> {
    const sel = JSON.stringify(this.selector);
    const js = `(() => { const is = window.__mwInjected; const el = is.querySelector(is.parseSelector(${sel}), document, true); if (!el) { return false; } return is.elementState(el, 'visible').matches; })()`;
    return this.pollBoolean(js, opts?.timeout ?? DEFAULT_TIMEOUT, 'visible');
  }

  async isHidden(opts?: { timeout?: number }): Promise<boolean> {
    const visible = await this.isVisible({ timeout: opts?.timeout ?? 0 });
    return !visible;
  }

  async isEnabled(opts?: { timeout?: number }): Promise<boolean> {
    return this.readElementState('enabled', opts?.timeout ?? 0, 'locator.isEnabled()');
  }

  async isDisabled(opts?: { timeout?: number }): Promise<boolean> {
    const enabled = await this.isEnabled(opts);
    return !enabled;
  }

  async isChecked(opts?: { timeout?: number }): Promise<boolean> {
    return this.readElementState('checked', opts?.timeout ?? 0, 'locator.isChecked()');
  }

  // ─── Value queries ───────────────────────────────────────────

  async textContent(opts?: { timeout?: number }): Promise<string> {
    return this.readStringProp('textContent', opts);
  }

  async innerText(opts?: { timeout?: number }): Promise<string> {
    return this.readStringProp('innerText', opts);
  }

  async innerHTML(opts?: { timeout?: number }): Promise<string> {
    return this.readStringProp('innerHTML', opts);
  }

  async inputValue(opts?: { timeout?: number }): Promise<string> {
    return this.readStringProp('value', opts);
  }

  async getAttribute(name: string, opts?: { timeout?: number }): Promise<string | null> {
    return this.readFromFirst<string | null>(`el ? el.getAttribute(${JSON.stringify(name)}) : null`, opts);
  }

  async boundingBox(opts?: { timeout?: number }): Promise<Bounds | null> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
    await this.pollUntilVisible(timeout);
    return this.evalOnFirst<Bounds | null>(
      'if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height };',
    );
  }

  async waitFor(opts?: { state?: 'visible' | 'hidden' | 'attached' | 'detached'; timeout?: number }): Promise<void> {
    const state = opts?.state ?? 'visible';
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
    await retryUntil(
      async () => {
        const n = await this.count();
        const visible = n > 0 && await this.isVisible({ timeout: 0 });
        switch (state) {
          case 'visible': return visible;
          case 'hidden': return !visible;
          case 'attached': return n > 0;
          case 'detached': return n === 0;
        }
      },
      (result) => result,
      timeout,
      `WebLocator: timed out waiting for state "${state}"`,
    );
  }

  // ─── Actions ─────────────────────────────────────────────────

  async click(opts?: { timeout?: number }): Promise<void> {
    return this._step('locator.click()', async () => {
      await this.pollActionable(['visible', 'enabled'], opts?.timeout ?? DEFAULT_TIMEOUT);
      await this.actOnFirst('el.click();', 'locator.click()');
    });
  }

  async fill(text: string, opts?: { timeout?: number }): Promise<void> {
    return this._step(`locator.fill(${JSON.stringify(text)})`, async () => {
      await this.pollUntilVisible(opts?.timeout ?? DEFAULT_TIMEOUT);
      await this.actOnFirst(`el.focus(); el.value = ''; el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));`, 'locator.fill()');
    });
  }

  async type(text: string): Promise<void> {
    return this._step(`locator.type(${JSON.stringify(text)})`, async () => {
      await this.pollUntilVisible(DEFAULT_TIMEOUT);
      await this.actOnFirst(`el.focus(); el.value = (el.value || '') + ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true }));`, 'locator.type()');
    });
  }

  async press(key: string): Promise<void> {
    return this._step(`locator.press(${JSON.stringify(key)})`, async () => {
      await this.actOnFirst(`['keydown','keypress','keyup'].forEach(t => el.dispatchEvent(new KeyboardEvent(t, { key: ${JSON.stringify(key)}, bubbles: true })));`, 'locator.press()');
    });
  }

  async focus(): Promise<void> {
    return this._step('locator.focus()', async () => {
      await this.actOnFirst('el.focus();', 'locator.focus()');
    });
  }

  async hover(): Promise<void> {
    return this._step('locator.hover()', async () => {
      await this.pollUntilVisible(DEFAULT_TIMEOUT);
      await this.actOnFirst('el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));', 'locator.hover()');
    });
  }

  async scrollIntoViewIfNeeded(): Promise<void> {
    return this._step('locator.scrollIntoViewIfNeeded()', async () => {
      await this.actOnFirst('el.scrollIntoView({ block: "nearest" });', 'locator.scrollIntoViewIfNeeded()');
    });
  }

  // ─── Private helpers ─────────────────────────────────────────

  // Poll Playwright's own checkElementStates until the element satisfies all the
  // given states (it returns undefined when they all pass). Used by click to
  // gate on visible+enabled before a synthetic dispatch (slice-1 behavior).
  private async pollActionable(states: string[], timeout: number): Promise<void> {
    const sel = JSON.stringify(this.selector);
    const list = JSON.stringify(states);
    await retryUntil(
      () => this.session.evaluate<boolean>(
        `(async () => { const is = window.__mwInjected; const el = is.querySelector(is.parseSelector(${sel}), document, true); if (!el) { return false; } const missing = await is.checkElementStates(el, ${list}); return missing === undefined; })()`,
      ),
      (ready) => ready,
      timeout,
      'WebLocator: timed out waiting for element to be actionable',
    );
  }

  private async pollUntilVisible(timeout: number): Promise<void> {
    await retryUntil(
      () => this.isVisible({ timeout: 0 }),
      (v) => v,
      timeout,
      'WebLocator: timed out waiting for element to be visible',
    );
  }
}
```

- [ ] **Step (checkpoint deferred):** do not build yet — `page.ts`/`index.ts` still reference the old types. Build happens at the end of Task 3.

---

### Task 3: Update `page.ts`, `index.ts`, and delete the old engine

**Files:**
- Modify: `packages/mobilewright-core/src/page.ts`
- Modify: `packages/mobilewright-core/src/index.ts`
- Delete: `packages/mobilewright-core/src/dom-selector-engine.ts`, `packages/mobilewright-core/src/dom-selector-engine.test.ts`

- [ ] **Step 1: Update `page.ts` imports.** Replace the two lines:

```ts
import { WebLocator, type WebLocatorStrategy } from './web-locator.js';
import { DOM_SELECTOR_ENGINE } from './dom-selector-engine.js';
import { bootstrapScript, getByRoleSelector } from './playwright-engine.js';
```

with:

```ts
import { WebLocator } from './web-locator.js';
import {
  bootstrapScript,
  getByRoleSelector,
  getByTextSelector,
  getByLabelSelector,
  getByPlaceholderSelector,
  getByTestIdSelector,
  getByAltTextSelector,
  getByTitleSelector,
  TEST_ID_ATTR,
} from './playwright-engine.js';
```

- [ ] **Step 2: `attach()` injects only the bootstrap.** Replace:

```ts
  static async attach(session: WebViewSession): Promise<Page> {
    await session.evaluate(bootstrapScript());
    await session.evaluate(DOM_SELECTOR_ENGINE);
    return new Page(session);
  }
```

with:

```ts
  static async attach(session: WebViewSession): Promise<Page> {
    await session.evaluate(bootstrapScript());
    return new Page(session);
  }
```

- [ ] **Step 3: Switch `locatorFor` + factories to selector strings.** Replace the `locatorFor` method and the eight factory methods (the block from `private locatorFor(` through `getByTitle(...)`) with:

```ts
  // Build a WebLocator scoped to this page, carrying step instrumentation forward.
  private locatorFor(selector: string): WebLocator {
    const loc = new WebLocator(this.session, selector);
    loc._stepFn = this._stepFn;
    return loc;
  }
```

(keep `_step` as-is) and the factories:

```ts
  locator(selector: string): WebLocator {
    return this.locatorFor(selector);
  }

  getByRole(role: string, opts?: { name?: string | RegExp; exact?: boolean }): WebLocator {
    return this.locatorFor(getByRoleSelector(role, { name: opts?.name, exact: opts?.exact }));
  }

  getByText(text: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return this.locatorFor(getByTextSelector(text, { exact: opts?.exact }));
  }

  getByLabel(label: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return this.locatorFor(getByLabelSelector(label, { exact: opts?.exact }));
  }

  getByPlaceholder(text: string | RegExp, opts?: { exact?: boolean }): WebLocator {
    return this.locatorFor(getByPlaceholderSelector(text, { exact: opts?.exact }));
  }

  getByTestId(testId: string): WebLocator {
    return this.locatorFor(getByTestIdSelector(TEST_ID_ATTR, testId));
  }

  getByAltText(text: string | RegExp): WebLocator {
    return this.locatorFor(getByAltTextSelector(text));
  }

  getByTitle(text: string | RegExp): WebLocator {
    return this.locatorFor(getByTitleSelector(text));
  }
```

- [ ] **Step 4: Update `index.ts`.** Replace:

```ts
export { WebLocator, type WebLocatorStrategy } from './web-locator.js';
```

with:

```ts
export { WebLocator } from './web-locator.js';
```

- [ ] **Step 5: Delete the old engine files.**

```bash
git rm packages/mobilewright-core/src/dom-selector-engine.ts packages/mobilewright-core/src/dom-selector-engine.test.ts
```

(If they are untracked in your tree, use `rm` instead.)

- [ ] **Step 6: Build to verify the production code compiles.**

Run: `npm run build`
Expected: success (no TS errors). Tests are still red until Task 4 — that's expected.

---

### Task 4: Migrate `web-locator.test.ts` to selector strings + injected assertions

**Files:**
- Modify: `packages/mobilewright-core/src/web-locator.test.ts`

- [ ] **Step 1: Mechanical constructor migration.** Every `new WebLocator(session, <strategy-object>)` becomes `new WebLocator(session, <selector-string>)`. Apply per strategy kind:

| Old construction | New construction |
| --- | --- |
| `{ kind: 'css', selector: 'X' }` | `'X'` |
| `{ kind: 'role', role: 'r' }` | `getByRoleSelector('r')` |
| `{ kind: 'role', role: 'r', name: 'n' }` | `getByRoleSelector('r', { name: 'n' })` |
| `{ kind: 'text', text: 't' }` | `getByTextSelector('t')` |
| `{ kind: 'label', label: 'l' }` | `getByLabelSelector('l')` |
| `{ kind: 'placeholder', text: 't' }` | `getByPlaceholderSelector('t')` |
| `{ kind: 'testId', testId: 'id' }` | `getByTestIdSelector(TEST_ID_ATTR, 'id')` |
| `{ kind: 'altText', text: 't' }` | `getByAltTextSelector('t')` |
| `{ kind: 'title', text: 't' }` | `getByTitleSelector('t')` |

Add these imports to the test file (alongside the existing `getByRoleSelector` import):

```ts
import {
  getByRoleSelector,
  getByTextSelector,
  getByLabelSelector,
  getByPlaceholderSelector,
  getByAltTextSelector,
  getByTitleSelector,
  getByTestIdSelector,
  TEST_ID_ATTR,
} from './playwright-engine.js';
```

- [ ] **Step 2: Replace the `buildFindAll — strategy to JS` describe block** with injected-engine assertions. The old block asserted `window.__mw.findByRole` etc.; replace the entire `test.describe('buildFindAll — strategy to JS', …)` block with:

```ts
test.describe('selector resolution via the injected engine', () => {
  test('count() resolves the selector through window.__mwInjected.querySelectorAll', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, '.my-btn');
    await loc.count();
    playwrightExpect(evaluateCalls[0]).toContain('window.__mwInjected.querySelectorAll');
    playwrightExpect(evaluateCalls[0]).toContain('parseSelector(".my-btn")');
  });

  test('getByRole builds the exact Playwright role selector', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, getByRoleSelector('button', { name: 'Sign In' }));
    await loc.count();
    playwrightExpect(evaluateCalls[0]).toContain(`parseSelector(${JSON.stringify(getByRoleSelector('button', { name: 'Sign In' }))})`);
  });

  test('getByTestId builds the exact Playwright testid selector', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, getByTestIdSelector(TEST_ID_ATTR, 'submit'));
    await loc.count();
    playwrightExpect(evaluateCalls[0]).toContain(`parseSelector(${JSON.stringify(getByTestIdSelector(TEST_ID_ATTR, 'submit'))})`);
  });
});
```

- [ ] **Step 3: Update the chaining-getter assertions.** In the `WebLocator chaining getters` describe block, the tests asserted the old `window.__mw.findByX` output. Replace their bodies to assert the composed Playwright selector. Example for `getByLabel` (apply the same shape to placeholder/testId/altText/title and the `last()` test):

```ts
  test('getByLabel composes a label selector within the parent', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, '.form');
    await loc.getByLabel('Email').count();
    playwrightExpect(evaluateCalls[0]).toContain(`parseSelector(${JSON.stringify('.form >> ' + getByLabelSelector('Email'))})`);
  });
```

For the `last()` test:

```ts
  test('last() composes an nth=-1 selector', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, '.btn');
    await loc.last().count();
    playwrightExpect(evaluateCalls[0]).toContain('parseSelector(".btn >> nth=-1")');
  });
```

And the `nth()` test in `WebLocator.first() / last() / nth()`:

```ts
  test('nth() composes an nth=index selector', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, '.btn');
    await loc.nth(2).count();
    playwrightExpect(evaluateCalls[0]).toContain('parseSelector(".btn >> nth=2")');
  });
```

- [ ] **Step 4: Update the `WebLocator.isVisible()` "evaluate rejects" test.** The old test relied on the hand-rolled `getComputedStyle` path. Keep it (a thrown evaluate still yields `false` for a non-strict error) but note isVisible now reads injected state — its construction just needs the selector-string form already covered by Step 1. No assertion change needed beyond the constructor migration.

- [ ] **Step 5: Add missing-element semantics tests** (new behavior from the spec). Append:

```ts
test.describe('state-query missing-element semantics', () => {
  test('isVisible returns false when the element is absent', async () => {
    const { session } = sessionReturning(false);
    const loc = new WebLocator(session, '.gone');
    playwrightExpect(await loc.isVisible({ timeout: 0 })).toBe(false);
  });

  test('isEnabled rejects with "element not found" when the element is absent', async () => {
    // null = injected querySelector found nothing.
    const { session } = sessionReturning(null);
    const loc = new WebLocator(session, '.gone');
    await playwrightExpect(loc.isEnabled({ timeout: 0 })).rejects.toThrow(/element not found/);
  });

  test('isChecked rejects with "element not found" when the element is absent', async () => {
    const { session } = sessionReturning(null);
    const loc = new WebLocator(session, '.gone');
    await playwrightExpect(loc.isChecked({ timeout: 0 })).rejects.toThrow(/element not found/);
  });
});
```

- [ ] **Step 6: Update action/state tests that asserted old in-page JS.** Any test asserting `window.getComputedStyle` (hover visibility test) or `.includes('.click()')` still holds (`el.click()` unchanged). For the `hover()` "waits for visibility" test, it asserted `getComputedStyle` ordering; replace that assertion with the injected-visibility check:

```ts
  test('waits for the element to be visible before dispatching the hover events', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(true);
    const loc = new WebLocator(session, '.btn');
    await loc.hover();
    const visibilityCheckIndex = evaluateCalls.findIndex(c => c.includes("elementState(el, 'visible')"));
    const hoverIndex = evaluateCalls.findIndex(c => c.includes('mouseover'));
    playwrightExpect(visibilityCheckIndex).toBeGreaterThanOrEqual(0);
    playwrightExpect(hoverIndex).toBeGreaterThan(visibilityCheckIndex);
  });
```

- [ ] **Step 7: Run the web-locator suite.**

Run: `npx c8 --include 'packages/mobilewright-core/src/web-locator.ts' playwright test --config=tests/mobilewright.config.ts web-locator`
Expected: PASS (all tests). Fix any remaining strategy-object constructions the table in Step 1 missed (the failure message points to the line).

---

### Task 5: Fix `page.test.ts` and run the full suite

**Files:**
- Modify: `packages/mobilewright-core/src/page.test.ts`

- [ ] **Step 1: Revert the slice-1 placeholder bumps.** `attach()` now runs ONE injection (bootstrap only), so the positional-response tests need a single leading placeholder again. In `Page.evaluate()` › "passes a string expression", change:

```ts
    const { session, evaluateCalls } = sessionWithResponses(undefined, undefined, 42);
```

back to:

```ts
    const { session, evaluateCalls } = sessionWithResponses(undefined, 42);
```

and in `Page.content()`, change:

```ts
    const { session, evaluateCalls } = sessionWithResponses(undefined, undefined, html);
```

back to:

```ts
    const { session, evaluateCalls } = sessionWithResponses(undefined, html);
```

(Remove the now-stale "two leading placeholders" comments.)

- [ ] **Step 2: Repurpose the DOM-engine test.** Replace the `'injects the DOM selector engine on attach'` test with one asserting only the bootstrap is injected and the old DOM engine is gone:

```ts
  test('injects only the engine bootstrap on attach (no hand-rolled DOM engine)', async () => {
    const { session, evaluateCalls } = sessionWithResponses();
    await Page.attach(session);
    playwrightExpect(evaluateCalls).toHaveLength(1);
    playwrightExpect(evaluateCalls[0]).toContain('window.__mwInjected = new (module.exports.InjectedScript())(globalThis,');
    playwrightExpect(evaluateCalls.some(c => c.includes('window.__mw.findBy'))).toBe(false);
  });
```

(The separate `'injects the Playwright engine bootstrap…'` test added in slice 1 can stay or be removed as redundant; keep it — it still passes.)

- [ ] **Step 3: Run the full core suite + lint.**

Run: `npm run build && npm run lint && npx c8 --include 'packages/mobilewright-core/src/**/*.ts' --exclude '**/*.test.ts' playwright test --config=tests/mobilewright.config.ts`
Expected: build clean, lint clean, all tests pass.

- [ ] **Step 4: Grep to confirm the old engine is fully gone.**

Run: `grep -rn "WebLocatorStrategy\|buildFindAll\|DOM_SELECTOR_ENGINE\|window.__mw\b" packages/mobilewright-core/src --include=*.ts | grep -v "__mwInjected"`
Expected: no matches (every reference removed; only `window.__mwInjected` remains).

---

## Self-Review

**Spec coverage:**
- Builders + `TEST_ID_ATTR` re-exported → Task 1. ✓
- `WebLocator` carries a selector string; `firstEl`/`count`/`child`/`nth` via injected engine; strict=true → Task 2. ✓
- Chaining `>>`, `nth=` → Task 2 (`child`, `nth`). ✓
- State queries via `elementState`/`checkElementStates`; missing-element semantics (isVisible→false, isEnabled/isChecked→throw) → Task 2 + Task 4 Step 5. ✓
- `Page` factories build selector strings; `attach` bootstrap-only → Task 3. ✓
- Delete `DOM_SELECTOR_ENGINE`/`buildFindAll`/`WebLocatorStrategy`; update `index.ts` → Tasks 2–3. ✓
- Protocol-breaking selector assertions → Task 1 + Task 4 Steps 2–3. ✓
- Full suite green + lint + no-leftovers grep → Task 5. ✓

**Placeholder scan:** none. The Task 4 Step 1 table is a concrete transformation, not a vague instruction; Step 3 says "apply the same shape" but provides the exact template to apply.

**Type/name consistency:** `selector: string` (field), `firstEl`/`child`/`derive`/`pollActionable`/`readElementState`/`pollUntilVisible` (methods), `window.__mwInjected` (in-page), and the seven builders + `TEST_ID_ATTR` are used identically across Tasks 1–5. `getByTestIdSelector(TEST_ID_ATTR, id)` arg order matches the verified signature. `checkElementStates`/`elementState` return shapes match the verified injected API.

**Known residual:** strict-mode-violation *propagation* on state queries is implemented (pollBoolean rethrows; readElementState propagates), but exact auto-wait *timing* parity (e.g. Playwright's `isVisible` being immediate) remains deferred per the spec's non-goals.
