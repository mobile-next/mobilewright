# Webview Playwright Parity — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route `getByRole(...).click()` on a webview `Page` through Playwright's own imported injected engine, proving the no-handle adapter architecture end-to-end.

**Architecture:** A single adapter module imports Playwright's injected `source` and selector builders from the pinned `playwright-core@1.58.2`. `Page.attach()` injects that source so `window.__mwInjected` (an `InjectedScript` instance) exists. `getByRole` builds the byte-identical Playwright selector string; `click()` resolves the element and gates actionability through the injected engine in self-contained `evaluate()` round-trips (no JSHandles), then dispatches a synthetic click.

**Tech Stack:** TypeScript (ESM, `module: ESNext`, `moduleResolution: bundler`), Playwright Test runner, `playwright-core@1.58.2`, existing `fakeWebViewSession` test double.

**Spec:** `docs/superpowers/specs/2026-06-05-webview-playwright-parity-slice1-design.md`

---

## File Structure

- **Create** `packages/mobilewright-core/src/playwright-engine.ts` — the sole module that imports `playwright-core` internals. Exports `INJECTED_SOURCE`, `bootstrapScript()`, and the re-exported `getByRoleSelector`.
- **Create** `packages/mobilewright-core/src/playwright-engine.test.ts` — unit tests for the adapter.
- **Modify** `packages/mobilewright-core/src/page.ts` — `attach()` injects the bootstrap; `getByRole()` sets the Playwright selector on the locator.
- **Modify** `packages/mobilewright-core/src/web-locator.ts` — add `_pwSelector` field and the injected-engine click path.
- **Modify** `packages/mobilewright-core/src/web-locator.test.ts` — unit test for the new click path.
- **Create** `e2e/src/webview-injected-click.test.ts` — on-device verification (requires a device + webview-capable app).

Notes that apply to all code below (repo rules):
- Always use `{ }` blocks, even one-liners.
- When using `await`, assign to a variable first — never `(await …)` inline in a condition/argument.
- Tests use `execSync`/`readFileSync`/sync APIs where applicable; prefer synchronous helpers.

---

### Task 1: Adapter module `playwright-engine.ts`

**Files:**
- Create: `packages/mobilewright-core/src/playwright-engine.ts`
- Test: `packages/mobilewright-core/src/playwright-engine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/mobilewright-core/src/playwright-engine.test.ts`:

```ts
import { test, expect as playwrightExpect } from '@playwright/test';
import { bootstrapScript, getByRoleSelector, INJECTED_SOURCE } from './playwright-engine.js';

test.describe('playwright-engine adapter', () => {
  test('re-exports getByRoleSelector producing the exact Playwright role selector', () => {
    // If Playwright ever changes its selector format, this assertion breaks —
    // which is the point: our selectors must stay byte-identical to Playwright's.
    playwrightExpect(getByRoleSelector('button', { name: 'Sign in' }))
      .toBe('internal:role=button[name="Sign in"i]');
    playwrightExpect(getByRoleSelector('button', { name: 'Sign in', exact: true }))
      .toBe('internal:role=button[name="Sign in"s]');
    playwrightExpect(getByRoleSelector('button')).toBe('internal:role=button');
  });

  test('INJECTED_SOURCE is the non-trivial Playwright injected bundle', () => {
    playwrightExpect(INJECTED_SOURCE.length).toBeGreaterThan(100_000);
    playwrightExpect(INJECTED_SOURCE).toContain('module.exports.InjectedScript');
  });

  test('bootstrapScript instantiates InjectedScript onto window.__mwInjected', () => {
    const script = bootstrapScript();
    playwrightExpect(script).toContain(INJECTED_SOURCE);
    playwrightExpect(script).toContain('window.__mwInjected = new (module.exports.InjectedScript())(globalThis,');
    playwrightExpect(script).toContain('"testIdAttributeName":"data-testid"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx c8 --include 'packages/mobilewright-core/src/playwright-engine.ts' playwright test --config=tests/mobilewright.config.ts playwright-engine`
Expected: FAIL — `Cannot find module './playwright-engine.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/mobilewright-core/src/playwright-engine.ts`:

```ts
// Sole module that reaches into playwright-core internals. Playwright's package
// `exports` map blocks these subpaths, so we resolve the package root and
// require the files by absolute path (an absolute require bypasses `exports`).
// Pinned to playwright-core@1.58.2 — if a future bump moves these paths, only
// this file breaks. Playwright is Apache-2.0 (see NOTICE).
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

type GetByRoleSelector = (
  role: string,
  options?: { name?: string | RegExp; exact?: boolean },
) => string;

const require = createRequire(import.meta.url);
const pkgRoot = dirname(require.resolve('playwright-core/package.json'));

const injected = require(join(pkgRoot, 'lib/generated/injectedScriptSource.js')) as { source: string };
const locatorUtils = require(join(pkgRoot, 'lib/utils/isomorphic/locatorUtils.js')) as {
  getByRoleSelector: GetByRoleSelector;
};

export const INJECTED_SOURCE: string = injected.source;
export const getByRoleSelector: GetByRoleSelector = locatorUtils.getByRoleSelector;

// Options mirror what playwright-core passes when instantiating the engine.
// browserName 'chromium' is correct for Android System WebView; per-platform
// selection (iOS WKWebView → 'webkit') is a later slice.
const BOOTSTRAP_OPTIONS = {
  isUnderTest: false,
  sdkLanguage: 'javascript',
  testIdAttributeName: 'data-testid',
  stableRafCount: 1,
  browserName: 'chromium',
  isUtilityWorld: false,
  customEngines: [],
};

// A self-contained IIFE evaluated once per page (at Page.attach). It defines the
// injected module and stashes a live InjectedScript instance on window so every
// later evaluate() can reference it without needing a JSHandle.
export function bootstrapScript(): string {
  return `(() => {
    const module = {};
    ${INJECTED_SOURCE}
    window.__mwInjected = new (module.exports.InjectedScript())(globalThis, ${JSON.stringify(BOOTSTRAP_OPTIONS)});
  })();`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx c8 --include 'packages/mobilewright-core/src/playwright-engine.ts' playwright test --config=tests/mobilewright.config.ts playwright-engine`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the Apache-2.0 attribution**

Create `packages/mobilewright-core/NOTICE`:

```
This package imports the injected script and selector utilities from
Playwright (playwright-core), which is licensed under the Apache License 2.0.
Copyright (c) Microsoft Corporation. https://github.com/microsoft/playwright
```

- [ ] **Step 6: Verify lint passes**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/mobilewright-core/src/playwright-engine.ts packages/mobilewright-core/src/playwright-engine.test.ts packages/mobilewright-core/NOTICE
git commit -m "feat(core): add playwright-engine adapter importing injected source"
```

---

### Task 2: `Page.attach()` injects the engine bootstrap

**Files:**
- Modify: `packages/mobilewright-core/src/page.ts`
- Test: `packages/mobilewright-core/src/page.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/mobilewright-core/src/page.test.ts`:

```ts
import { test, expect as playwrightExpect } from '@playwright/test';
import { Page } from './page.js';
import { fakeWebViewSession } from './fake-webview-session.js';

test.describe('Page.attach()', () => {
  test('injects the Playwright engine bootstrap so window.__mwInjected exists', async () => {
    const { session, evaluateCalls } = fakeWebViewSession({ url: '', title: '' });
    await Page.attach(session);
    const injectedBootstrap = evaluateCalls.some((c) =>
      c.includes('window.__mwInjected = new (module.exports.InjectedScript())(globalThis,'),
    );
    playwrightExpect(injectedBootstrap).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `playwright test --config=tests/mobilewright.config.ts page.test` (or wrap with the same `npx c8 …` prefix used elsewhere if the bare invocation reports "two different versions of @playwright/test")
Expected: FAIL — no evaluate call contains the bootstrap assignment.

- [ ] **Step 3: Write minimal implementation**

In `packages/mobilewright-core/src/page.ts`, add the import near the top (after the existing imports):

```ts
import { bootstrapScript } from './playwright-engine.js';
```

Replace the existing `attach` method:

```ts
  static async attach(session: WebViewSession): Promise<Page> {
    await session.evaluate(DOM_SELECTOR_ENGINE);
    return new Page(session);
  }
```

with:

```ts
  static async attach(session: WebViewSession): Promise<Page> {
    await session.evaluate(bootstrapScript());
    await session.evaluate(DOM_SELECTOR_ENGINE);
    return new Page(session);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `playwright test --config=tests/mobilewright.config.ts page.test`
Expected: PASS.

- [ ] **Step 5: Verify lint passes**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/mobilewright-core/src/page.ts packages/mobilewright-core/src/page.test.ts
git commit -m "feat(core): inject playwright engine bootstrap on Page.attach"
```

---

### Task 3: `getByRole(...).click()` routes through the injected engine

**Files:**
- Modify: `packages/mobilewright-core/src/web-locator.ts`
- Modify: `packages/mobilewright-core/src/page.ts`
- Test: `packages/mobilewright-core/src/web-locator.test.ts:301` (add a new describe block)

- [ ] **Step 1: Write the failing test**

In `packages/mobilewright-core/src/web-locator.test.ts`, add this import at the top alongside the others:

```ts
import { Page } from './page.js';
import { getByRoleSelector } from './playwright-engine.js';
```

Add this describe block after the existing `WebLocator.fill()` block:

```ts
test.describe('getByRole().click() via the injected engine', () => {
  test('resolves and clicks through window.__mwInjected using the exact Playwright selector', async () => {
    // Every evaluate resolves true: the actionability poll passes on the first
    // read, so click() proceeds to dispatch.
    const { session, evaluateCalls } = sessionAlwaysReturning(true);
    const page = await Page.attach(session);

    await page.getByRole('button', { name: 'Sign in' }).click();

    const expectedSelector = getByRoleSelector('button', { name: 'Sign in' });
    const usesInjectedSelector = evaluateCalls.some((c) =>
      c.includes('window.__mwInjected') &&
      c.includes(`parseSelector(${JSON.stringify(expectedSelector)})`),
    );
    const dispatchesClick = evaluateCalls.some((c) => c.includes('el.click()'));
    playwrightExpect(usesInjectedSelector).toBe(true);
    playwrightExpect(dispatchesClick).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx c8 --include 'packages/mobilewright-core/src/web-locator.ts' playwright test --config=tests/mobilewright.config.ts web-locator`
Expected: FAIL — the click path still uses `actOnFirst('el.click();', …)` against the legacy `buildFindAll` selector, so no evaluate references `window.__mwInjected` / `parseSelector("internal:role=button[name=\"Sign in\"i]")`.

- [ ] **Step 3: Add the `_pwSelector` field and injected click path in `web-locator.ts`**

In `packages/mobilewright-core/src/web-locator.ts`, add the field inside the `WebLocator` class, right after `_stepFn`:

```ts
  // When set (e.g. by Page.getByRole), actions route through the imported
  // Playwright injected engine using this exact Playwright selector string,
  // rather than the legacy buildFindAll() path. Slice-1 scope: click() only.
  _pwSelector: string | null = null;
```

Replace the existing `click` method:

```ts
  async click(opts?: { timeout?: number }): Promise<void> {
    return this._step('locator.click()', async () => {
      await this.pollUntilVisible(opts?.timeout ?? DEFAULT_TIMEOUT);
      await this.actOnFirst('el.click();', 'locator.click()');
    });
  }
```

with:

```ts
  async click(opts?: { timeout?: number }): Promise<void> {
    return this._step('locator.click()', async () => {
      if (this._pwSelector !== null) {
        await this.clickViaInjectedEngine(this._pwSelector, opts?.timeout ?? DEFAULT_TIMEOUT);
        return;
      }
      await this.pollUntilVisible(opts?.timeout ?? DEFAULT_TIMEOUT);
      await this.actOnFirst('el.click();', 'locator.click()');
    });
  }

  // Resolve + gate actionability + dispatch through the imported Playwright
  // injected engine. Each evaluate() is self-contained (selector -> element ->
  // op) because the bridge has no JSHandles. Gating uses Playwright's own
  // checkElementStates (returns undefined when all states pass). The final
  // dispatch is a synthetic el.click() — Playwright's trusted CDP click cannot
  // be reproduced over evaluate() (documented limitation).
  private async clickViaInjectedEngine(selector: string, timeout: number): Promise<void> {
    const sel = JSON.stringify(selector);
    await retryUntil(
      () => this.session.evaluate<boolean>(
        `(async () => {
          const is = window.__mwInjected;
          if (!is) { throw new Error('mobilewright: injected engine not initialized'); }
          const el = is.querySelector(is.parseSelector(${sel}), document, true);
          if (!el) { return false; }
          const missing = await is.checkElementStates(el, ['visible', 'enabled']);
          return missing === undefined;
        })()`,
      ),
      (ready) => ready,
      timeout,
      'WebLocator: timed out waiting for element to be actionable',
    );
    await this.session.evaluate<void>(
      `(() => {
        const is = window.__mwInjected;
        const el = is.querySelector(is.parseSelector(${sel}), document, true);
        if (!el) { throw new Error('locator.click(): element not found'); }
        el.click();
      })()`,
    );
  }
```

(`retryUntil` and `DEFAULT_TIMEOUT` are already imported/defined in this file.)

- [ ] **Step 4: Set the Playwright selector in `Page.getByRole`**

In `packages/mobilewright-core/src/page.ts`, add to the imports:

```ts
import { bootstrapScript, getByRoleSelector } from './playwright-engine.js';
```

(replacing the `import { bootstrapScript } from './playwright-engine.js';` line added in Task 2.)

Replace the existing `getByRole` method:

```ts
  getByRole(role: string, opts?: { name?: string | RegExp }): WebLocator {
    return this.locatorFor({ kind: 'role', role, name: opts?.name });
  }
```

with:

```ts
  getByRole(role: string, opts?: { name?: string | RegExp }): WebLocator {
    const loc = this.locatorFor({ kind: 'role', role, name: opts?.name });
    loc._pwSelector = getByRoleSelector(role, { name: opts?.name });
    return loc;
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx c8 --include 'packages/mobilewright-core/src/web-locator.ts' playwright test --config=tests/mobilewright.config.ts web-locator`
Expected: PASS — including the new test and all pre-existing web-locator tests (the legacy path is unchanged for locators without `_pwSelector`).

- [ ] **Step 6: Verify lint passes**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/mobilewright-core/src/web-locator.ts packages/mobilewright-core/src/page.ts packages/mobilewright-core/src/web-locator.test.ts
git commit -m "feat(core): route getByRole().click() through the injected playwright engine"
```

---

### Task 4: On-device verification (real webview)

**Files:**
- Create: `e2e/src/webview-injected-click.test.ts`

> **Environment dependency (not a placeholder):** this task needs a connected
> device/emulator and a webview-capable app. Set `APP_ID` to the bundle id of an
> installed app whose webview permits `goto` to a `data:` URL. This test is run
> manually on a device, not in CI.

- [ ] **Step 1: Write the on-device test**

Create `e2e/src/webview-injected-click.test.ts`:

```ts
import { test, expect } from '@mobilewright/test';

// Set to a webview-capable app installed on the target device.
const APP_ID = 'com.example.webviewdemo';

test('clicks a real webview button via the injected Playwright engine', async ({ device, screen }) => {
  await device.launchApp(APP_ID);

  const page = await screen.getByWebView().page();

  // Self-contained fixture: clicking the button mutates document.title, which
  // we read back to confirm the click actually fired in the real webview.
  await page.goto('data:text/html,<button onclick="document.title=\'clicked\'">Sign in</button>');

  await page.getByRole('button', { name: 'Sign in' }).click();

  const title = await page.title();
  expect(title).toBe('clicked');
});
```

- [ ] **Step 2: Run on the device**

Run (from `e2e/`): `npx playwright test --config=mobilewright.config.ts webview-injected-click`
Expected: PASS — the webview button is resolved by Playwright's role engine and clicked; the page title becomes `clicked`.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/webview-injected-click.test.ts
git commit -m "test(e2e): verify getByRole click on a real webview via injected engine"
```

---

## Self-Review

**Spec coverage:**
- Adapter module / sole touchpoint / bootstrap → Task 1. ✓
- `Page.attach()` injects engine → Task 2. ✓
- No-handle helper + `getByRole().click()` routing + Playwright-exact selector + actionability gating → Task 3. ✓
- Synthetic-dispatch and stability limitations → documented in code comments (Task 3) and the spec. ✓ (`receives-events` is not a checkable state; slice-1 gates on `['visible','enabled']`, consistent with the trusted-input ceiling.)
- Unit assertions are protocol-breaking (selector equals imported `getByRoleSelector`) → Tasks 1 & 3. ✓
- On-device verification → Task 4. ✓
- Apache-2.0 attribution → Task 1 Step 5. ✓

**Placeholder scan:** No TBD/TODO. `APP_ID` is a flagged environment input with a concrete example value, not a vague instruction.

**Type/name consistency:** `_pwSelector` (field), `clickViaInjectedEngine` (method), `bootstrapScript`/`getByRoleSelector`/`INJECTED_SOURCE` (adapter exports), `window.__mwInjected` (in-page global) are used identically across Tasks 1–3. `checkElementStates(el, ['visible','enabled'])` returning `undefined` on success matches the verified injected API.
