# Webview Conformance Suite + iOS Engine Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `browserName` engine auto-detection (so WKWebView runs as `webkit`) and an on-device conformance corpus of Playwright-style web tests proving web parity against `com.mobilenext.playground`.

**Architecture:** A pure `detectBrowserName(ua)` helper, inlined into `bootstrapScript()` and unit-tested off-device. A new `e2e/src/conformance/harness.ts` (`openWebviewPage`, `pageWithBody`) and five corpus test files authored as plain Playwright web tests using `data:` URLs built from readable HTML.

**Tech Stack:** TypeScript (ESM), Playwright Test, `playwright-core@1.58.2`, `@mobilewright/test`, `fakeWebViewSession`.

**Spec:** `docs/superpowers/specs/2026-06-06-webview-conformance-suite-design.md`

Repo rules: `{ }` blocks always; assign `await` to a variable before using in a condition/argument; sync test helpers off-device.

Scope note: "exhaustive" = every implemented locator factory, action, and matcher is covered with a positive and a negative case — not every input permutation (YAGNI). Corpus files are device-gated (not part of CI `npm test`).

---

## File Structure

- **Modify** `packages/mobilewright-core/src/playwright-engine.ts` — add `detectBrowserName`, build `browserName` in-page.
- **Modify** `packages/mobilewright-core/src/playwright-engine.test.ts` — unit test for `detectBrowserName`.
- **Create** `e2e/src/conformance/harness.ts` — `openWebviewPage`, `pageWithBody`.
- **Create** `e2e/src/conformance/locators.test.ts`, `actions.test.ts`, `assertions-state.test.ts`, `assertions-text.test.ts`, `assertions-web.test.ts`.

---

### Task 1: `detectBrowserName` + engine bootstrap uses it

**Files:**
- Modify: `packages/mobilewright-core/src/playwright-engine.ts`
- Test: `packages/mobilewright-core/src/playwright-engine.test.ts`

- [ ] **Step 1: Write the failing test** — append inside the `playwright-engine adapter` describe in `playwright-engine.test.ts`:

```ts
  test('detectBrowserName returns webkit for WKWebView UA and chromium for Chrome UA', () => {
    const wkUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
    const androidUA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36';
    playwrightExpect(detectBrowserName(wkUA)).toBe('webkit');
    playwrightExpect(detectBrowserName(androidUA)).toBe('chromium');
  });

  test('bootstrapScript inlines the browser detection and passes options', () => {
    const script = bootstrapScript();
    playwrightExpect(script).toContain('navigator.userAgent');
    playwrightExpect(script).toContain('"testIdAttributeName":"data-testid"');
    playwrightExpect(script).toContain('window.__mwInjected = new (module.exports.InjectedScript())(globalThis,');
  });
```

And update the import at the top of the test file to add `detectBrowserName`:

```ts
import {
  bootstrapScript,
  detectBrowserName,
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
Expected: FAIL — `detectBrowserName` is not exported.

- [ ] **Step 3: Implement.** In `playwright-engine.ts`, replace the `BOOTSTRAP_OPTIONS` block and `bootstrapScript` with:

```ts
// WKWebView's UA contains "AppleWebKit" without "Chrome/"; Android System
// WebView / Chromium contains "Chrome/". Pinning browserName makes Playwright's
// engine-specific branches behave correctly per webview engine.
export function detectBrowserName(userAgent: string): 'webkit' | 'chromium' {
  return /AppleWebKit/.test(userAgent) && !/Chrome\//.test(userAgent) ? 'webkit' : 'chromium';
}

// Options mirror what playwright-core passes when instantiating the engine.
// browserName is resolved in-page (see bootstrapScript) from the live UA.
const BOOTSTRAP_OPTIONS_BASE = {
  isUnderTest: false,
  sdkLanguage: 'javascript',
  testIdAttributeName: 'data-testid',
  stableRafCount: 1,
  isUtilityWorld: false,
  customEngines: [],
};

// A self-contained IIFE evaluated once per page (at Page.attach). It defines the
// injected module and stashes a live InjectedScript instance on window so every
// later evaluate() can reference it without needing a JSHandle. browserName is
// detected in-page so WKWebView is configured as webkit (not chromium).
export function bootstrapScript(): string {
  return `(() => {
    const module = {};
    ${INJECTED_SOURCE}
    const detectBrowserName = ${detectBrowserName.toString()};
    const options = Object.assign(${JSON.stringify(BOOTSTRAP_OPTIONS_BASE)}, { browserName: detectBrowserName(navigator.userAgent) });
    window.__mwInjected = new (module.exports.InjectedScript())(globalThis, options);
  })();`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx c8 --include 'packages/mobilewright-core/src/playwright-engine.ts' playwright test --config=tests/mobilewright.config.ts playwright-engine`
Expected: PASS.

- [ ] **Step 5: Off-device regression — build, lint, full suite.**

Run: `npm run build && npm run lint && npx c8 --include 'packages/mobilewright-core/src/**/*.ts' --exclude '**/*.test.ts' playwright test --config=tests/mobilewright.config.ts`
Expected: all green. (The slice-1/2 bootstrap assertions still pass — `(globalThis,` and `"testIdAttributeName":"data-testid"` substrings are preserved.)

- [ ] **Step 6: Commit** (skipped per project no-auto-commit rule)

---

### Task 2: Conformance harness

**Files:**
- Create: `e2e/src/conformance/harness.ts`

- [ ] **Step 1: Write the harness.**

```ts
import type { Device, Screen, Page } from '@mobilewright/core';

const PLAYGROUND_APP = 'com.mobilenext.playground';

// Launch the Playground app, open its WebView screen, and return the web Page.
// All conformance tests start from the Page this returns.
export async function openWebviewPage(ctx: { device: Device; screen: Screen }): Promise<Page> {
  await ctx.device.launchApp(PLAYGROUND_APP);
  const webviewButton = ctx.screen.getByText('Webview');
  await webviewButton.tap();
  const page = await ctx.screen.getByWebView().page();
  return page;
}

// Wrap a readable HTML body fragment into a self-contained data: URL document.
// Tests author legible HTML; the data-URL encoding stays hidden behind the name.
export function pageWithBody(bodyHtml: string): string {
  const doc = `<!doctype html><meta charset="utf-8"><body>${bodyHtml}</body>`;
  return `data:text/html,${encodeURIComponent(doc)}`;
}
```

> Note on imports: confirm `Device`, `Screen`, and `Page` are exported from
> `@mobilewright/core` (`grep -n "export" packages/mobilewright-core/src/index.ts`).
> `Page` is exported; if `Device`/`Screen` type names differ, use the exported
> names (e.g. import the fixture types from `@mobilewright/test`). If unsure, type
> `ctx` loosely as `{ device: any; screen: any }` — this is device-gated glue, not
> shipped API.

- [ ] **Step 2: Typecheck the e2e package (no device needed).**

Run: `cd e2e && npx tsc --noEmit -p tsconfig.json; cd ..`
Expected: no type errors in `harness.ts` (adjust the import per the note if needed).

- [ ] **Step 3: Commit** (skipped)

---

### Task 3: `locators.test.ts`

**Files:**
- Create: `e2e/src/conformance/locators.test.ts`

- [ ] **Step 1: Write the corpus file.** Each test loads one readable fixture and asserts via `count()`/`textContent()`.

```ts
import { test } from '@mobilewright/test';
import { expect } from '@mobilewright/core';
import { openWebviewPage, pageWithBody } from './harness.js';

test('locator factories resolve like Playwright', async ({ device, screen }) => {
  const page = await openWebviewPage({ device, screen });

  await page.goto(pageWithBody(`
    <button>Sign in</button>
    <a href="#">Sign in</a>
    <label>Email <input type="text" placeholder="you@example.com" data-testid="email"></label>
    <img alt="Company logo" src="x">
    <span title="Close dialog">x</span>
    <p class="greeting">Hello   world</p>
    <ul><li>one</li><li>two</li><li>three</li></ul>
  `));

  // getByRole with accessible name, exact, and regex
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'sign', exact: false })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /sign/i })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(1);

  // getByText exact vs substring vs regex
  await expect(page.getByText('Hello world')).toHaveCount(1);
  await expect(page.getByText('Hello', { exact: false })).toHaveCount(1);
  await expect(page.getByText(/hello/i)).toHaveCount(1);

  // label / placeholder / testid / alt / title
  await expect(page.getByLabel('Email')).toHaveCount(1);
  await expect(page.getByPlaceholder('you@example.com')).toHaveCount(1);
  await expect(page.getByTestId('email')).toHaveCount(1);
  await expect(page.getByAltText('Company logo')).toHaveCount(1);
  await expect(page.getByTitle('Close dialog')).toHaveCount(1);

  // raw css, count, nth/first/last, chaining
  await expect(page.locator('li')).toHaveCount(3);
  await expect(page.locator('li').first()).toHaveText('one');
  await expect(page.locator('li').nth(1)).toHaveText('two');
  await expect(page.locator('li').last()).toHaveText('three');
  await expect(page.locator('ul').getByText('two')).toHaveCount(1);
});
```

- [ ] **Step 2 (on device):** Run `cd e2e && npx playwright test --config=mobilewright.config.ts conformance/locators`. Triage any failure as a parity finding.

- [ ] **Step 3: Commit** (skipped)

---

### Task 4: `actions.test.ts`

**Files:**
- Create: `e2e/src/conformance/actions.test.ts`

- [ ] **Step 1: Write the corpus file.** Each action is verified by an in-DOM effect.

```ts
import { test } from '@mobilewright/test';
import { expect } from '@mobilewright/core';
import { openWebviewPage, pageWithBody } from './harness.js';

test('actions affect the DOM like Playwright', async ({ device, screen }) => {
  const page = await openWebviewPage({ device, screen });

  await page.goto(pageWithBody(`
    <button id="b" onclick="this.textContent='clicked'">press me</button>
    <input id="fill" type="text">
    <input id="type" type="text">
    <input id="key" type="text" onkeydown="this.value='key:'+event.key">
    <input id="focusable" type="text">
    <div id="hovered">idle</div>
    <button id="hover" onmouseover="document.getElementById('hovered').textContent='hovered'">hover me</button>
    <div style="height:2000px"></div>
    <button id="bottom">bottom</button>
  `));

  // click
  await page.locator('#b').click();
  await expect(page.locator('#b')).toHaveText('clicked');

  // fill
  await page.locator('#fill').fill('hello@example.com');
  await expect(page.locator('#fill')).toHaveValue('hello@example.com');

  // type (appends)
  await page.locator('#type').type('abc');
  await expect(page.locator('#type')).toHaveValue('abc');

  // press
  await page.locator('#key').press('Enter');
  await expect(page.locator('#key')).toHaveValue('key:Enter');

  // focus
  await page.locator('#focusable').focus();
  await expect(page.locator('#focusable')).toBeFocused();

  // hover
  await page.locator('#hover').hover();
  await expect(page.locator('#hovered')).toHaveText('hovered');

  // scrollIntoViewIfNeeded — no throw, element becomes in viewport
  await page.locator('#bottom').scrollIntoViewIfNeeded();
  await expect(page.locator('#bottom')).toBeInViewport();
});
```

- [ ] **Step 2 (on device):** Run `cd e2e && npx playwright test --config=mobilewright.config.ts conformance/actions`. Triage failures.

- [ ] **Step 3: Commit** (skipped)

---

### Task 5: `assertions-state.test.ts`

**Files:**
- Create: `e2e/src/conformance/assertions-state.test.ts`

- [ ] **Step 1: Write the corpus file.** Positive + negative per state matcher.

```ts
import { test } from '@mobilewright/test';
import { expect } from '@mobilewright/core';
import { openWebviewPage, pageWithBody } from './harness.js';

test('state assertions match Playwright', async ({ device, screen }) => {
  const page = await openWebviewPage({ device, screen });

  await page.goto(pageWithBody(`
    <div id="visible">shown</div>
    <div id="hidden" style="display:none">gone</div>
    <button id="enabled">ok</button>
    <button id="disabled" disabled>no</button>
    <input id="editable" type="text">
    <input id="readonly" type="text" readonly>
    <input id="focused" type="text" autofocus>
    <input id="checkbox" type="checkbox" checked>
    <input id="empty" type="text" value="">
  `));

  await expect(page.locator('#visible')).toBeVisible();
  await expect(page.locator('#hidden')).not.toBeVisible();
  await expect(page.locator('#hidden')).toBeHidden();
  await expect(page.locator('#visible')).not.toBeHidden();

  await expect(page.locator('#enabled')).toBeEnabled();
  await expect(page.locator('#disabled')).toBeDisabled();
  await expect(page.locator('#disabled')).not.toBeEnabled();

  await expect(page.locator('#editable')).toBeEditable();
  await expect(page.locator('#readonly')).not.toBeEditable();

  await expect(page.locator('#checkbox')).toBeChecked();

  await expect(page.locator('#visible')).toBeAttached();
  await expect(page.locator('#missing')).not.toBeAttached();

  await expect(page.locator('#empty')).toBeEmpty();
  await expect(page.locator('#visible')).not.toBeEmpty();

  await expect(page.locator('#visible')).toBeInViewport();
});
```

- [ ] **Step 2 (on device):** Run `cd e2e && npx playwright test --config=mobilewright.config.ts conformance/assertions-state`. Triage failures (e.g. `toBeFocused` for `autofocus` may be timing-sensitive — note as a finding if so).

- [ ] **Step 3: Commit** (skipped)

---

### Task 6: `assertions-text.test.ts`

**Files:**
- Create: `e2e/src/conformance/assertions-text.test.ts`

- [ ] **Step 1: Write the corpus file.** Exact / substring / regex / whitespace normalization.

```ts
import { test } from '@mobilewright/test';
import { expect } from '@mobilewright/core';
import { openWebviewPage, pageWithBody } from './harness.js';

test('text assertions match Playwright (incl. whitespace normalization)', async ({ device, screen }) => {
  const page = await openWebviewPage({ device, screen });

  await page.goto(pageWithBody(`
    <p id="text">  Hello   world  </p>
    <input id="value" type="text" value="john@example.com">
  `));

  // toHaveText normalizes surrounding/intra whitespace, like Playwright
  await expect(page.locator('#text')).toHaveText('Hello world');
  await expect(page.locator('#text')).toHaveText(/Hello world/);
  await expect(page.locator('#text')).not.toHaveText('Goodbye');

  // toContainText substring
  await expect(page.locator('#text')).toContainText('world');
  await expect(page.locator('#text')).not.toContainText('planet');

  // toHaveValue exact + regex
  await expect(page.locator('#value')).toHaveValue('john@example.com');
  await expect(page.locator('#value')).toHaveValue(/@example\.com$/);
  await expect(page.locator('#value')).not.toHaveValue('other');
});
```

- [ ] **Step 2 (on device):** Run `cd e2e && npx playwright test --config=mobilewright.config.ts conformance/assertions-text`. Triage failures.

- [ ] **Step 3: Commit** (skipped)

---

### Task 7: `assertions-web.test.ts`

**Files:**
- Create: `e2e/src/conformance/assertions-web.test.ts`

- [ ] **Step 1: Write the corpus file.** count / attribute / class / css / id / JS property.

```ts
import { test } from '@mobilewright/test';
import { expect } from '@mobilewright/core';
import { openWebviewPage, pageWithBody } from './harness.js';

test('web-only assertions match Playwright', async ({ device, screen }) => {
  const page = await openWebviewPage({ device, screen });

  await page.goto(pageWithBody(`
    <ul><li class="item">a</li><li class="item">b</li></ul>
    <button id="btn" class="btn primary" data-variant="primary" style="color: rgb(255, 0, 0);">go</button>
    <input id="check" type="checkbox" checked>
  `));

  // count
  await expect(page.locator('.item')).toHaveCount(2);
  await expect(page.locator('.item')).not.toHaveCount(3);

  // attribute (exact + regex + negative)
  await expect(page.locator('#btn')).toHaveAttribute('data-variant', 'primary');
  await expect(page.locator('#btn')).toHaveAttribute('class', /primary/);
  await expect(page.locator('#btn')).not.toHaveAttribute('data-variant', 'secondary');

  // class (full token list) + contain (subset)
  await expect(page.locator('#btn')).toHaveClass('btn primary');
  await expect(page.locator('#btn')).toContainClass('primary');
  await expect(page.locator('#btn')).not.toContainClass('danger');

  // css
  await expect(page.locator('#btn')).toHaveCSS('color', 'rgb(255, 0, 0)');

  // id
  await expect(page.locator('#btn')).toHaveId('btn');

  // JS property
  await expect(page.locator('#check')).toHaveJSProperty('checked', true);
});
```

- [ ] **Step 2 (on device):** Run `cd e2e && npx playwright test --config=mobilewright.config.ts conformance/assertions-web`. Triage failures.

- [ ] **Step 3: Commit** (skipped)

---

### Task 8: Findings summary

- [ ] **Step 1: After running Tasks 3–7 on a device**, record results in `docs/superpowers/webview-conformance-findings.md`: per file, which assertions passed/failed, and for each failure a triage note (engine-config / unimplemented / `evaluate()`-ceiling). This is the deliverable that quantifies the true remaining parity gap.

- [ ] **Step 2: Commit** (skipped)

---

## Self-Review

**Spec coverage:**
- `detectBrowserName` + in-page browserName + unit test → Task 1. ✓
- `openWebviewPage` + `pageWithBody` (readable HTML → data URL) → Task 2. ✓
- Exhaustive corpus (every locator factory, action, matcher; positive + negative) → Tasks 3–7. ✓
- On-device run + findings triage → Tasks 3–7 Step 2 + Task 8. ✓
- Off-device suite stays green (only `playwright-engine.ts` changes in core) → Task 1 Step 5. ✓

**Placeholder scan:** none. The harness import note (Task 2 Step 1) gives an exact grep + fallback, not a vague instruction. Corpus files are complete, runnable test code.

**Type/name consistency:** `detectBrowserName`/`bootstrapScript` (Task 1) used in Task 1 tests; `openWebviewPage`/`pageWithBody` (Task 2) imported identically in Tasks 3–7; matcher names match the slice-3 `WebLocatorAssertions` API (`toBeInViewport`, `toContainClass`, `toHaveJSProperty`, etc.) verified against the implemented methods.
