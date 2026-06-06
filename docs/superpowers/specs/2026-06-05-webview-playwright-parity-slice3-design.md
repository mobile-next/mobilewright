# Webview Playwright Parity — Slice 3: Web-First Assertions via the Injected `expect`

**Date:** 2026-06-05
**Status:** Design — pending review
**Scope:** Webview web automation only. The native mobilewright API is frozen.
**Predecessors:** slice 1 (engine adapter), slice 2 (full locator surface).

## Goal

Route web-locator assertions through Playwright's own injected `expect` matcher
engine, so matcher semantics (whitespace normalization, substring/regex/ignore-
case handling, no-element edge cases) are byte-identical to Playwright. Re-back
the existing web matchers and add high-value matchers we currently lack.

## Scope

In scope (web locators only):
- Re-backed existing matchers: `toBeVisible`, `toBeHidden`, `toBeEnabled`,
  `toBeDisabled`, `toBeChecked`, `toBeEmpty`, `toHaveText`, `toContainText`,
  `toHaveValue`, `toHaveCount`, `toHaveAttribute`.
- New matchers: `toBeFocused`, `toBeEditable`, `toBeAttached`, `toBeInViewport`,
  `toHaveClass`, `toContainClass`, `toHaveCSS`, `toHaveId`, `toHaveJSProperty`.

Out of scope:
- Native `LocatorAssertions` and `PageAssertions` — unchanged (native frozen;
  page url/title stay TS-side, they do not use the injected engine).
- The remaining injected matchers (`toHaveAccessibleName`/`Description`,
  `toHaveRole`, `toHaveValues`, `toHaveAccessibleErrorMessage`) — YAGNI for now.
- `ValueAssertions` (plain-value `expect`) — unchanged.

## Background (verified against playwright-core@1.58.2)

- Injected entry point:
  `async expect(element: Element | undefined, options: FrameExpectParams, elements: Element[]): Promise<{ matches: boolean, received?: any, missingReceived?: boolean }>`.
- `FrameExpectParams = { selector?, expression, expressionArg?, expectedText?:
  ExpectedTextValue[], expectedNumber?, expectedValue?, useInnerText?, isNot,
  timeout }`.
- Pass/fail decision (server `frames.ts`): the attempt fails when
  `matches === isNot`. Therefore **pass = `matches !== isNot`**.
- The injected `expect` bakes in the no-element edge cases keyed on
  `(isNot, expression)` — e.g. `toBeHidden`/`not.toBeVisible`/`toBeDetached`/
  `not.toBeAttached`/`not.toBeInViewport` pass when there is no element. We pass
  `isNot` straight through and inherit these.
- Array matchers (`to.have.count`, `*.array`) use `elements`; element matchers
  use `elements[0]`.
- `ExpectedTextValue = { string?, regexSource?, regexFlags?, matchSubstring?,
  ignoreCase?, normalizeWhiteSpace? }` — a trivial struct we build by hand; the
  Playwright serializer (`server/utils/expectUtils.ts`) is not exported and is
  not needed.

## Architecture

### Component 1 — `web-expect-matcher.ts` (new; the injected-expect bridge)

Owns the calling convention so `expect.ts` stays lean.

- Type `ExpectedTextValue` and `FrameExpectParams` (the subset of fields we use).
- `buildExpectEvaluate(selector: string, params: FrameExpectParams): string` —
  returns the one-shot evaluate expression:
  ```js
  (async () => {
    const is = window.__mwInjected;
    const parsed = is.parseSelector(<JSON selector>);
    const elements = is.querySelectorAll(parsed, document);
    const r = await is.expect(elements[0], <JSON params>, elements);
    return { matches: r.matches, received: r.received, missingReceived: r.missingReceived };
  })()
  ```
  `params` is inlined as a JSON literal (it carries `isNot` and `timeout: 0`).
- Helpers to build `ExpectedTextValue` from a `string | RegExp` plus flags
  (`normalizeWhiteSpace`, `matchSubstring`, `ignoreCase`).

Result type: `{ matches: boolean, received?: unknown, missingReceived?: boolean }`.

### Component 2 — `WebLocatorAssertions` rewrite (in `expect.ts`)

- Becomes **standalone** (no longer `extends LocatorAssertions`). Holds the
  `WebLocator`, `negated`, and reuses module-level `wrapAssertion`,
  `retryAssertion`, `ExpectError`.
- Private `runMatcher(method, params, opts)`:
  - wraps as a step (`expect.toBeVisible()` / `expect.not.…()` titles preserved),
  - sets `params.isNot = this.negated`, `params.timeout = 0`,
  - polls `buildExpectEvaluate(this.webLocator.selectorString, params)` via
    `retryAssertion` until `result.matches !== this.negated` or timeout,
  - on timeout throws `ExpectError` with the matcher name and last `received`
    (honoring `missingReceived` so an absent element does not print `undefined`).
  - timeout source: `opts?.timeout ?? this.webLocator.expectTimeout ?? 5000`.
- Each matcher method builds its `params` (see map) and calls `runMatcher`.
- `get not()` returns a `WebLocatorAssertions` with flipped `negated`.

To keep `session`/`selector` encapsulated, `WebLocator` gains
`async _runInjectedExpect(params): Promise<ExpectResult>` that runs
`session.evaluate(buildExpectEvaluate(this.selector, params))`. The assertion
layer calls this rather than reaching into the locator's internals.

### Component 3 — `expect()` dispatch (unchanged)

`expect(webLocator)` still returns `WebLocatorAssertions`; the overload list and
`Page`/`Locator`/value dispatch are unchanged.

## Matcher map

`ExpectedTextValue[]` entries built from the matcher arg; `nWS = normalizeWhiteSpace: true`.

| Matcher | expression | params |
| --- | --- | --- |
| `toBeVisible` | `to.be.visible` | — |
| `toBeHidden` | `to.be.hidden` | — |
| `toBeEnabled` | `to.be.enabled` | — |
| `toBeDisabled` | `to.be.disabled` | — |
| `toBeEditable` | `to.be.editable` | — |
| `toBeFocused` | `to.be.focused` | — |
| `toBeAttached` | `to.be.attached` | — |
| `toBeInViewport` | `to.be.in.viewport` | `expectedNumber: opts?.ratio` (optional) |
| `toBeChecked` | `to.be.checked` | `expectedValue: { checked: true, indeterminate: false }` |
| `toBeEmpty` | `to.be.empty` | — |
| `toHaveText` | `to.have.text` | `expectedText: [textValue(arg, { nWS })]` |
| `toContainText` | `to.have.text` | `expectedText: [textValue(arg, { nWS, matchSubstring: true })]` |
| `toHaveValue` | `to.have.value` | `expectedText: [textValue(arg)]` |
| `toHaveCount` | `to.have.count` | `expectedNumber: n` |
| `toHaveAttribute` | `to.have.attribute.value` | `expressionArg: name, expectedText: [textValue(value)]` |
| `toHaveClass` | `to.have.class` | `expectedText: [textValue(arg)]` |
| `toContainClass` | `to.contain.class` | `expectedText: [textValue(arg)]` |
| `toHaveCSS` | `to.have.css` | `expressionArg: name, expectedText: [textValue(value)]` |
| `toHaveId` | `to.have.id` | `expectedText: [textValue(value)]` |
| `toHaveJSProperty` | `to.have.property` | `expressionArg: name, expectedValue: value` |

`textValue(arg, flags)`: for a `string` → `{ string: arg, ...flags }`; for a
`RegExp` → `{ regexSource: arg.source, regexFlags: arg.flags, ...flags }`.

## Data flow

`expect(loc).toHaveText('Hi')` → `WebLocatorAssertions.toHaveText` →
`runMatcher('toHaveText', { expression: 'to.have.text', expectedText:
[{ string: 'Hi', normalizeWhiteSpace: true }] }, opts)` → poll
`buildExpectEvaluate(selector, { …, isNot: false, timeout: 0 })` →
`{ matches, received }` → pass when `matches !== isNot`.

## Error handling

- Timeout → `ExpectError` with matcher name and last `received`; when
  `missingReceived` is set, omit the received value (matches Playwright's
  avoidance of `unexpected value "undefined"`).
- A rejected evaluate mid-poll (page navigation) is retried like other poll
  errors; persistent failure surfaces as `ExpectError` on timeout.
- Strict-mode violations propagate (the selector resolves >1 element) — but note
  assertions resolve via `querySelectorAll`, so multiplicity is matcher-defined
  (count/array vs first element), matching Playwright.

## Testing strategy

New file `web-expect.test.ts` (synchronous helpers per repo rules). The fake
session's `evaluate()` returns `{ matches: boolean, received? }` objects.

- **Protocol-breaking:** each matcher's emitted evaluate contains the exact
  Playwright `expression` string and the right `expectedText`/`expressionArg`/
  `expectedNumber`/`expectedValue` (asserted against literal expressions, so a
  Playwright change to an expression name breaks the test).
- **Behavior:** `{ matches: true }` → assertion resolves; `{ matches: false }` →
  rejects with `ExpectError`; `.not` inverts both; `toHaveCount` uses
  `expectedNumber`; the new matchers each produce their expression.
- **Step instrumentation:** assertions still emit `expect.<matcher>()` steps.

Migration: the `expect(webLocator).*` describe blocks currently in
`web-locator.test.ts` are removed (their behavior is re-covered by
`web-expect.test.ts` with `{matches}`-shaped responses). Non-assertion
web-locator tests stay. Native `LocatorAssertions`/`PageAssertions` tests are
untouched.

Then: full core suite green, `npm run lint` clean.

## Success criteria

- `WebLocatorAssertions` matchers all resolve through `window.__mwInjected.expect`,
  verified by protocol-breaking unit assertions on the expression strings.
- The nine new matchers are available on `expect(webLocator)` and map to the
  correct injected expressions.
- Native and page assertions unchanged; full suite + lint pass.

## Follow-on slices (unchanged queue)

1. Per-method actionability retiming to exact Playwright semantics + `stable`.
2. On-device conformance suite.
3. iOS WKWebView `browserName:'webkit'` + impossibility handling.
4. (Optional) remaining injected matchers (accessible name/role/values).
