# Webview Playwright Parity — Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route web-locator assertions through Playwright's injected `expect` matcher engine, re-backing the existing web matchers and adding nine high-value new ones.

**Architecture:** A new `web-expect-matcher.ts` builds `FrameExpectParams` + the one-shot evaluate that calls `window.__mwInjected.expect(elements[0], params, elements)`. `WebLocator` gains `_runInjectedExpect(params)` to run it. `WebLocatorAssertions` is rewritten standalone to poll that per matcher, with pass = `matches !== isNot`.

**Tech Stack:** TypeScript (ESM), Playwright Test, `playwright-core@1.58.2`, `fakeWebViewSession`.

**Spec:** `docs/superpowers/specs/2026-06-05-webview-playwright-parity-slice3-design.md`

Repo rules: `{ }` blocks always; assign `await` to a variable before using in a condition/argument; sync test helpers.

---

## File Structure

- **Create** `web-expect-matcher.ts` — `ExpectedTextValue`/`FrameExpectParams` types, `textValue()`, `buildExpectEvaluate()`.
- **Modify** `web-locator.ts` — add `_runInjectedExpect(params)`.
- **Modify** `expect.ts` — rewrite `WebLocatorAssertions` standalone with all matchers.
- **Create** `web-expect.test.ts` — assertion tests (fake returns `{matches}`).
- **Modify** `web-locator.test.ts` — remove the `expect(webLocator).*` blocks (re-covered in `web-expect.test.ts`).

---

### Task 1: `web-expect-matcher.ts` — the injected-expect bridge

**Files:**
- Create: `packages/mobilewright-core/src/web-expect-matcher.ts`
- Test: `packages/mobilewright-core/src/web-expect-matcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/mobilewright-core/src/web-expect-matcher.test.ts`:

```ts
import { test, expect as playwrightExpect } from '@playwright/test';
import { buildExpectEvaluate, textValue, type FrameExpectParams } from './web-expect-matcher.js';

test.describe('web-expect-matcher', () => {
  test('textValue builds a string matcher with flags', () => {
    playwrightExpect(textValue('Hi', { normalizeWhiteSpace: true }))
      .toEqual({ string: 'Hi', normalizeWhiteSpace: true });
  });

  test('textValue builds a regex matcher from a RegExp', () => {
    playwrightExpect(textValue(/hi/i)).toEqual({ regexSource: 'hi', regexFlags: 'i' });
  });

  test('buildExpectEvaluate calls window.__mwInjected.expect with the params', () => {
    const params: FrameExpectParams = { expression: 'to.have.text', expectedText: [textValue('Hi')], isNot: false, timeout: 0 };
    const js = buildExpectEvaluate('.btn', params);
    playwrightExpect(js).toContain('window.__mwInjected.expect(elements[0],');
    playwrightExpect(js).toContain('is.querySelectorAll(is.parseSelector(".btn")');
    playwrightExpect(js).toContain('"expression":"to.have.text"');
    playwrightExpect(js).toContain('"string":"Hi"');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx c8 --include 'packages/mobilewright-core/src/web-expect-matcher.ts' playwright test --config=tests/mobilewright.config.ts web-expect-matcher`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `packages/mobilewright-core/src/web-expect-matcher.ts`:

```ts
// Builds the calling convention for Playwright's injected expect() matcher.
// Verified against playwright-core@1.58.2: injected.expect(element, params,
// elements) returns { matches, received, missingReceived }; pass = matches !== isNot.

export interface ExpectedTextValue {
  string?: string;
  regexSource?: string;
  regexFlags?: string;
  matchSubstring?: boolean;
  ignoreCase?: boolean;
  normalizeWhiteSpace?: boolean;
}

export interface FrameExpectParams {
  expression: string;
  expressionArg?: unknown;
  expectedText?: ExpectedTextValue[];
  expectedNumber?: number;
  expectedValue?: unknown;
  isNot: boolean;
  timeout: number;
}

export interface ExpectResult {
  matches: boolean;
  received?: unknown;
  missingReceived?: boolean;
}

// Build an ExpectedTextValue from a string or RegExp, plus optional match flags.
export function textValue(
  value: string | RegExp,
  flags: { normalizeWhiteSpace?: boolean; matchSubstring?: boolean; ignoreCase?: boolean } = {},
): ExpectedTextValue {
  if (value instanceof RegExp) {
    return { regexSource: value.source, regexFlags: value.flags, ...flags };
  }
  return { string: value, ...flags };
}

// A single self-contained evaluate: resolve the selector, run the injected
// matcher, return its serializable verdict. No JSHandles needed.
export function buildExpectEvaluate(selector: string, params: FrameExpectParams): string {
  const sel = JSON.stringify(selector);
  const opts = JSON.stringify(params);
  return `(async () => {
    const is = window.__mwInjected;
    const elements = is.querySelectorAll(is.parseSelector(${sel}), document);
    const r = await is.expect(elements[0], ${opts}, elements);
    return { matches: r.matches, received: r.received, missingReceived: r.missingReceived };
  })()`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx c8 --include 'packages/mobilewright-core/src/web-expect-matcher.ts' playwright test --config=tests/mobilewright.config.ts web-expect-matcher`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit** (skipped per project no-auto-commit rule; leave staged)

---

### Task 2: `WebLocator._runInjectedExpect`

**Files:**
- Modify: `packages/mobilewright-core/src/web-locator.ts`

- [ ] **Step 1: Add the import.** At the top of `web-locator.ts`, add after the existing `playwright-engine` import:

```ts
import { buildExpectEvaluate, type FrameExpectParams, type ExpectResult } from './web-expect-matcher.js';
```

- [ ] **Step 2: Add the method.** Inside the `WebLocator` class, just before the closing `}` of the class (after `pollUntilVisible`), add:

```ts
  // Run Playwright's injected expect() matcher for this locator's selector and
  // return its raw verdict. The assertion layer (expect.ts) decides pass/fail
  // (pass = matches !== isNot) and handles retry/negation/messages.
  async _runInjectedExpect(params: FrameExpectParams): Promise<ExpectResult> {
    return this.session.evaluate<ExpectResult>(buildExpectEvaluate(this.selector, params));
  }
```

- [ ] **Step 3: Build to verify it compiles.**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit** (skipped)

---

### Task 3: Rewrite `WebLocatorAssertions` to route through the injected matcher

**Files:**
- Modify: `packages/mobilewright-core/src/expect.ts`

- [ ] **Step 1: Add the import.** At the top of `expect.ts`, after the existing imports, add:

```ts
import { textValue, type FrameExpectParams } from './web-expect-matcher.js';
```

- [ ] **Step 2: Replace the entire `WebLocatorAssertions` class** (the `class WebLocatorAssertions extends LocatorAssertions { … }` block) with this standalone implementation:

```ts
// ─── WebLocatorAssertions ─────────────────────────────────────
// Standalone: every web matcher routes through Playwright's injected expect()
// (window.__mwInjected.expect) for byte-exact matcher semantics. Native
// LocatorAssertions and PageAssertions are unaffected.

class WebLocatorAssertions {
  constructor(
    private readonly webLocator: WebLocator,
    private readonly negated: boolean,
  ) {}

  get not(): WebLocatorAssertions {
    return new WebLocatorAssertions(this.webLocator, !this.negated);
  }

  private assertionTimeout(opts?: ExpectOptions): number {
    return opts?.timeout ?? this.webLocator.expectTimeout ?? DEFAULT_TIMEOUT;
  }

  // Poll the injected matcher until matches !== isNot, or throw ExpectError.
  private runMatcher(
    method: string,
    params: Omit<FrameExpectParams, 'isNot' | 'timeout'>,
    opts?: ExpectOptions,
  ): Promise<void> {
    return wrapAssertion(this.webLocator._stepFn, this.negated, method, async () => {
      const isNot = this.negated;
      let received: unknown;
      let missingReceived = false;
      await retryAssertion(
        async () => {
          const result = await this.webLocator._runInjectedExpect({ ...params, isNot, timeout: 0 });
          received = result.received;
          missingReceived = result.missingReceived ?? false;
          return result.matches;
        },
        (matches) => matches !== isNot,
        this.assertionTimeout(opts),
        () => {
          const got = missingReceived ? 'no element' : fmt(received);
          return isNot
            ? `Expected ${method} NOT to match, but it did (received ${got})`
            : `Expected ${method} to match, but it did not (received ${got})`;
        },
      );
    });
  }

  toBeVisible(opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toBeVisible', { expression: 'to.be.visible' }, opts);
  }

  toBeHidden(opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toBeHidden', { expression: 'to.be.hidden' }, opts);
  }

  toBeEnabled(opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toBeEnabled', { expression: 'to.be.enabled' }, opts);
  }

  toBeDisabled(opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toBeDisabled', { expression: 'to.be.disabled' }, opts);
  }

  toBeEditable(opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toBeEditable', { expression: 'to.be.editable' }, opts);
  }

  toBeFocused(opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toBeFocused', { expression: 'to.be.focused' }, opts);
  }

  toBeAttached(opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toBeAttached', { expression: 'to.be.attached' }, opts);
  }

  toBeInViewport(opts?: ExpectOptions & { ratio?: number }): Promise<void> {
    return this.runMatcher('toBeInViewport', { expression: 'to.be.in.viewport', expectedNumber: opts?.ratio }, opts);
  }

  toBeChecked(opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toBeChecked', { expression: 'to.be.checked', expectedValue: { checked: true, indeterminate: false } }, opts);
  }

  toBeEmpty(opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toBeEmpty', { expression: 'to.be.empty' }, opts);
  }

  toHaveText(expected: string | RegExp, opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toHaveText', { expression: 'to.have.text', expectedText: [textValue(expected, { normalizeWhiteSpace: true })] }, opts);
  }

  toContainText(expected: string | RegExp, opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toContainText', { expression: 'to.have.text', expectedText: [textValue(expected, { normalizeWhiteSpace: true, matchSubstring: true })] }, opts);
  }

  toHaveValue(expected: string | RegExp, opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toHaveValue', { expression: 'to.have.value', expectedText: [textValue(expected)] }, opts);
  }

  toHaveCount(expected: number, opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toHaveCount', { expression: 'to.have.count', expectedNumber: expected }, opts);
  }

  toHaveAttribute(name: string, expected: string | RegExp, opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toHaveAttribute', { expression: 'to.have.attribute.value', expressionArg: name, expectedText: [textValue(expected)] }, opts);
  }

  toHaveClass(expected: string | RegExp, opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toHaveClass', { expression: 'to.have.class', expectedText: [textValue(expected)] }, opts);
  }

  toContainClass(expected: string | RegExp, opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toContainClass', { expression: 'to.contain.class', expectedText: [textValue(expected)] }, opts);
  }

  toHaveCSS(name: string, expected: string | RegExp, opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toHaveCSS', { expression: 'to.have.css', expressionArg: name, expectedText: [textValue(expected)] }, opts);
  }

  toHaveId(expected: string | RegExp, opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toHaveId', { expression: 'to.have.id', expectedText: [textValue(expected)] }, opts);
  }

  toHaveJSProperty(name: string, expected: unknown, opts?: ExpectOptions): Promise<void> {
    return this.runMatcher('toHaveJSProperty', { expression: 'to.have.property', expressionArg: name, expectedValue: expected }, opts);
  }
}
```

- [ ] **Step 3: Confirm `WebLocator` has `expectTimeout`.** The matcher uses `this.webLocator.expectTimeout`. If `WebLocator` has no such member, add this getter to `web-locator.ts` inside the class (returns undefined by default so the timeout falls back to `DEFAULT_TIMEOUT`):

```ts
  get expectTimeout(): number | undefined {
    return undefined;
  }
```

(Check first: `grep -n "expectTimeout" packages/mobilewright-core/src/web-locator.ts`. Add only if absent.)

- [ ] **Step 4: Build to verify it compiles.**

Run: `npm run build`
Expected: success. (`LocatorAssertions` remains for native locators; only the web class changed.)

- [ ] **Step 5: Commit** (skipped)

---

### Task 4: `web-expect.test.ts` + remove the old web-assertion tests

**Files:**
- Create: `packages/mobilewright-core/src/web-expect.test.ts`
- Modify: `packages/mobilewright-core/src/web-locator.test.ts`

- [ ] **Step 1: Create `web-expect.test.ts`:**

```ts
import { test, expect as playwrightExpect } from '@playwright/test';
import type { StepFn } from './locator.js';
import { WebLocator } from './web-locator.js';
import { expect } from './expect.js';
import { fakeWebViewSession } from './fake-webview-session.js';

// Fake session whose evaluate() always returns the given injected-expect verdict.
function sessionMatching(verdict: { matches: boolean; received?: unknown; missingReceived?: boolean }) {
  return fakeWebViewSession({ evaluateAlways: verdict, url: '', title: '' });
}

function webLocator(session: import('@mobilewright/protocol').WebViewSession) {
  return new WebLocator(session, '.btn');
}

test.describe('web assertions route through the injected expect()', () => {
  test('toBeVisible passes when the injected matcher matches', async () => {
    const { session } = sessionMatching({ matches: true });
    await expect(webLocator(session)).toBeVisible();
  });

  test('toBeVisible rejects when the injected matcher does not match', async () => {
    const { session } = sessionMatching({ matches: false, received: 'hidden' });
    await playwrightExpect(expect(webLocator(session)).toBeVisible({ timeout: 200 })).rejects.toThrow();
  });

  test('not.toBeVisible passes when the matcher does not match', async () => {
    const { session } = sessionMatching({ matches: false });
    await expect(webLocator(session)).not.toBeVisible();
  });

  test('emits the exact Playwright expression for toHaveText', async () => {
    const { session, evaluateCalls } = sessionMatching({ matches: true });
    await expect(webLocator(session)).toHaveText('Hi');
    playwrightExpect(evaluateCalls[0]).toContain('window.__mwInjected.expect(elements[0],');
    playwrightExpect(evaluateCalls[0]).toContain('"expression":"to.have.text"');
    playwrightExpect(evaluateCalls[0]).toContain('"string":"Hi"');
    playwrightExpect(evaluateCalls[0]).toContain('"normalizeWhiteSpace":true');
  });

  test('toContainText uses to.have.text with matchSubstring', async () => {
    const { session, evaluateCalls } = sessionMatching({ matches: true });
    await expect(webLocator(session)).toContainText('dash');
    playwrightExpect(evaluateCalls[0]).toContain('"expression":"to.have.text"');
    playwrightExpect(evaluateCalls[0]).toContain('"matchSubstring":true');
  });

  test('toHaveCount uses expectedNumber', async () => {
    const { session, evaluateCalls } = sessionMatching({ matches: true });
    await expect(webLocator(session)).toHaveCount(3);
    playwrightExpect(evaluateCalls[0]).toContain('"expression":"to.have.count"');
    playwrightExpect(evaluateCalls[0]).toContain('"expectedNumber":3');
  });

  test('toHaveAttribute carries the attribute name in expressionArg', async () => {
    const { session, evaluateCalls } = sessionMatching({ matches: true });
    await expect(webLocator(session)).toHaveAttribute('data-variant', 'primary');
    playwrightExpect(evaluateCalls[0]).toContain('"expression":"to.have.attribute.value"');
    playwrightExpect(evaluateCalls[0]).toContain('"expressionArg":"data-variant"');
    playwrightExpect(evaluateCalls[0]).toContain('"string":"primary"');
  });

  test('toBeChecked passes expectedValue', async () => {
    const { session, evaluateCalls } = sessionMatching({ matches: true });
    await expect(webLocator(session)).toBeChecked();
    playwrightExpect(evaluateCalls[0]).toContain('"expression":"to.be.checked"');
    playwrightExpect(evaluateCalls[0]).toContain('"checked":true');
  });

  test('new matchers map to their injected expressions', async () => {
    const { session, evaluateCalls } = sessionMatching({ matches: true });
    const loc = webLocator(session);
    await expect(loc).toHaveClass('active');
    await expect(loc).toContainClass('act');
    await expect(loc).toHaveCSS('color', 'red');
    await expect(loc).toHaveId('main');
    await expect(loc).toBeFocused();
    await expect(loc).toBeEditable();
    await expect(loc).toBeAttached();
    await expect(loc).toBeInViewport();
    await expect(loc).toHaveJSProperty('checked', true);
    const joined = evaluateCalls.join('\n');
    playwrightExpect(joined).toContain('"to.have.class"');
    playwrightExpect(joined).toContain('"to.contain.class"');
    playwrightExpect(joined).toContain('"to.have.css"');
    playwrightExpect(joined).toContain('"expressionArg":"color"');
    playwrightExpect(joined).toContain('"to.have.id"');
    playwrightExpect(joined).toContain('"to.be.focused"');
    playwrightExpect(joined).toContain('"to.be.editable"');
    playwrightExpect(joined).toContain('"to.be.attached"');
    playwrightExpect(joined).toContain('"to.be.in.viewport"');
    playwrightExpect(joined).toContain('"to.have.property"');
    playwrightExpect(joined).toContain('"expressionArg":"checked"');
  });

  test('assertions emit expect steps', async () => {
    const titles: string[] = [];
    const stepFn: StepFn = (title, body) => { titles.push(title); return body(); };
    const { session } = sessionMatching({ matches: true });
    const loc = webLocator(session);
    loc._stepFn = stepFn;
    await expect(loc).toBeVisible();
    playwrightExpect(titles).toContain('expect.toBeVisible()');
  });
});
```

- [ ] **Step 2: Remove the old web-assertion describes from `web-locator.test.ts`.** Delete these entire `test.describe(...)` blocks (their behavior is re-covered above):
  - `expect(webLocator).toBeVisible()`
  - `expect(webLocator).toBeEnabled()`
  - `expect(webLocator).toBeChecked()`
  - `expect(webLocator).toHaveText()`
  - `expect(webLocator).toContainText()`
  - `expect(webLocator).toHaveValue()`
  - `expect(webLocator).toHaveAttribute()`
  - `expect(webLocator).toHaveCount()`

  Also delete the single step-instrumentation test `'assertions on a web locator emit expect steps'` inside the `WebLocator step instrumentation` describe (re-covered by `web-expect.test.ts`'s "assertions emit expect steps").

- [ ] **Step 3: Remove the now-unused `expect` import** from `web-locator.test.ts`. Change:

```ts
import { expect } from './expect.js';
```

to nothing (delete the line) — but FIRST verify no remaining usage: `grep -n "expect(loc)\|[^t]expect(" packages/mobilewright-core/src/web-locator.test.ts | grep -v playwrightExpect`. If any `expect(` (the local import) remains, keep the import.

- [ ] **Step 4: Run both web test files.**

Run: `npx c8 --include 'packages/mobilewright-core/src/web-locator.ts' --include 'packages/mobilewright-core/src/expect.ts' --include 'packages/mobilewright-core/src/web-expect-matcher.ts' playwright test --config=tests/mobilewright.config.ts web-locator web-expect`
Expected: PASS (web-locator tests minus the removed blocks; all web-expect tests).

- [ ] **Step 5: Commit** (skipped)

---

### Task 5: Full suite + lint

- [ ] **Step 1: Build, lint, full suite.**

Run: `npm run build && npm run lint && npx c8 --include 'packages/mobilewright-core/src/**/*.ts' --exclude '**/*.test.ts' playwright test --config=tests/mobilewright.config.ts`
Expected: build clean, lint clean, all tests pass.

- [ ] **Step 2: Sanity grep — native assertions untouched.**

Run: `grep -n "class LocatorAssertions\|class PageAssertions" packages/mobilewright-core/src/expect.ts`
Expected: both still present (only `WebLocatorAssertions` changed).

---

## Self-Review

**Spec coverage:**
- Injected-expect bridge (`buildExpectEvaluate`, types, `textValue`) → Task 1. ✓
- `WebLocator._runInjectedExpect` → Task 2. ✓
- Standalone `WebLocatorAssertions`, all existing + 9 new matchers, pass = `matches !== isNot`, negation via `isNot`, step titles, timeout source → Task 3. ✓
- Matcher map (expression/expressionArg/expectedText/expectedNumber/expectedValue) → Task 3 + verified against injected source. ✓
- Native/Page assertions unchanged → Tasks 3 & 5 grep. ✓
- Protocol-breaking + behavior + step tests; move old blocks → Task 4. ✓
- Full suite + lint → Task 5. ✓

**Placeholder scan:** none. Conditional steps (Task 3 Step 3, Task 4 Step 3) give the exact grep to decide and the exact edit.

**Type/name consistency:** `FrameExpectParams`/`ExpectedTextValue`/`ExpectResult`/`textValue`/`buildExpectEvaluate` (Task 1) are used identically in Tasks 2–4. `_runInjectedExpect` (Task 2) is called in Task 3. `runMatcher(method, params, opts)` param shape matches every matcher call. Expression strings (`to.have.text`, `to.have.attribute.value`, `to.be.checked`, `to.have.css`, `to.have.property`, etc.) match the injected source verified during planning. `expressionArg` carries attribute/css/property names (verified). `to.be.checked` `expectedValue:{checked,indeterminate}` (verified).
