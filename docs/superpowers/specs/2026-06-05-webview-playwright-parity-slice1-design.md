# Webview Playwright Parity — Slice 1: Engine Adapter + One Method

**Date:** 2026-06-05
**Status:** Design — pending review
**Scope:** Webview web automation only. The native mobilewright API is frozen.

## Goal

Let a developer take Playwright web-test code that works in a browser, obtain a
`Page` via `screen.getByWebView().page()`, and run the same code against a
device webview with the same syntax and the same outcome.

We achieve parity by **importing Playwright's own injected engine** (selector
resolution, accessibility/role computation, actionability checks) from a pinned
`playwright-core` and driving it through the existing `session.evaluate()`
bridge. We do not copy or re-implement that engine.

This document specifies **Slice 1 only**: the engine adapter plus one method
(`getByRole().click()`) routed end-to-end through the injected engine, proven on
a real device webview. Later slices (full locator surface, web-first assertion
parity, the on-device conformance suite, iOS impossibility handling) are
separate specs.

## Non-goals (explicitly out of scope for this slice)

- The native side: `Locator` (`locator.ts`), `Screen`, `device`,
  `getByWebView()` itself, the view-hierarchy query engine. All unchanged.
- Migrating the existing `WebLocatorStrategy` union / `buildFindAll` to selector
  strings. The new path lives alongside the existing one.
- Trusted input events (see Known Limitations).
- The async `stable` raf-based actionability check (see Known Limitations).
- Web-first assertions (`expect(locator).toBeVisible()` etc.).
- Any method other than `getByRole(...).click()`.

## Background: how Playwright's engine is shipped

Verified against `playwright-core@1.58.2` (pinned):

- The entire injected engine is a single self-contained ~305 KB string exported
  as `{ source }` from `playwright-core/lib/generated/injectedScriptSource.js`.
  It contains the selector engines, `getByRole`/accessible-name computation, and
  visibility/actionability checks.
- The package `exports` map blocks that subpath
  (`ERR_PACKAGE_PATH_NOT_EXPORTED`), so it is reached by absolute path via
  `require.resolve('playwright-core/package.json')` → `lib/generated/...`. This
  is an internal, unstable path — isolated behind one adapter module and pinned
  by exact version.
- Playwright instantiates it in-page as:
  ```js
  (() => {
    const module = {};
    <source>
    return new (module.exports.InjectedScript())(globalThis, <options>);
  })();
  ```
  with options `{ isUnderTest, sdkLanguage, testIdAttributeName, stableRafCount,
  browserName, isUtilityWorld, customEngines }`.
- The selector **string builders** (e.g. `getByRoleSelector`) are pure functions
  exported from `playwright-core/lib/utils/isomorphic/locatorUtils.js`:
  `getByAltTextSelector, getByLabelSelector, getByPlaceholderSelector,
  getByRoleSelector, getByTestIdSelector, getByTextSelector, getByTitleSelector`.
  These produce the canonical `internal:role=...` selector strings and are
  importable.
- The injected instance exposes (among others): `parseSelector(string)`,
  `querySelector(parsedSelector, root, strict)`, `querySelectorAll`,
  `elementState`, `checkElementStates`, `expect`.

## Dependency pinning (already applied)

All Playwright packages pinned to exactly `1.58.2`:

| Package | Dependency | Version |
| --- | --- | --- |
| root `mobilewright-monorepo` | `@playwright/test` | `1.58.2` |
| `@mobilewright/test` | `@playwright/test` | `1.58.2` |
| `mobilewright` | `playwright` | `1.58.2` |
| `@mobilewright/core` | `playwright-core` | `1.58.2` (added; runtime dep) |

## Architecture

### Component 1 — `playwright-engine.ts` (the adapter; sole touchpoint)

New file `packages/mobilewright-core/src/playwright-engine.ts`. The **only**
module permitted to import `playwright-core` internals.

Responsibilities:
- Read the injected `source` string from the pinned package via the
  resolved absolute path.
- Re-export the selector builders from `locatorUtils` (slice 1 needs
  `getByRoleSelector`).
- Provide `bootstrapScript(): string` — the self-contained IIFE that defines the
  injected module and assigns the instance to `window.__mwInjected`:
  ```js
  (() => {
    const module = {};
    <source>
    window.__mwInjected = new (module.exports.InjectedScript())(globalThis, <OPTIONS>);
  })();
  ```
  Options for slice 1: `{ isUnderTest: false, sdkLanguage: 'javascript',
  testIdAttributeName: 'data-testid', stableRafCount: 1, browserName:
  'chromium', isUtilityWorld: false, customEngines: [] }`.

If a future `playwright-core` bump moves the internal path or the in-page API,
only this file breaks.

Licensing: Playwright is Apache-2.0. Add the required `NOTICE`/attribution.

### Component 2 — `Page.attach()` injects the engine

`Page.attach(session)` injects `bootstrapScript()` so `window.__mwInjected`
exists. For slice 1 the existing `DOM_SELECTOR_ENGINE` injection remains
(non-migrated methods still use it); the new path uses `window.__mwInjected`.

### Component 3 — no-handle evaluate helper + the new `getByRole` path

Because the bridge is string-in / serializable-value-out with no JSHandles,
every operation is a single self-contained `evaluate()` that resolves
selector → element → operation in one round-trip:

```js
(() => {
  const is = window.__mwInjected;
  if (!is) throw new Error('mobilewright: injected engine not initialized');
  const el = is.querySelector(is.parseSelector(<SELECTOR>), document, true /* strict */);
  // state check or action on `el`; return serializable result
})()
```

`getByRole(role, { name?, exact? })` builds its selector via the imported
`getByRoleSelector(...)`, producing the byte-identical Playwright selector
string, and stores it on the locator (parallel to the existing strategy union).

### Data flow for `getByRole(...).click()`

1. `getByRole('button', { name: 'Sign in' })` → selector string from
   `getByRoleSelector`.
2. `.click()` polls actionability on the TS side via `retryUntil`. Each poll is
   one `evaluate()` that resolves the element and calls the injected
   `elementState`/`checkElementStates` for the click states Playwright requires
   (attached, visible, enabled, receives-events). Gating logic is Playwright's
   own code.
3. Once gated, a final `evaluate()` dispatches the click (see limitation below).

## Known limitations discovered (the "what's not possible" list for this approach)

These are inherent to the `evaluate()`-based, cross-platform injected-engine
approach and are documented, not worked around, in slice 1:

1. **Trusted input ceiling.** Playwright's real click is a *trusted* mouse event
   dispatched by the browser (CDP) at the computed action point after a
   hit-test. Over `evaluate()` we can only do a **synthetic `el.click()`**.
   Outcome-equivalent for the vast majority of apps; diverges for
   trusted-event-only handlers. Selector resolution and actionability gating
   remain exact.
2. **Async `stable` check.** Playwright's stability check compares the bounding
   box across `stableRafCount` animation frames. Slice 1 gates on the
   synchronous states only; stability is deferred to a later slice.

## Testing strategy

### Unit (fake session; synchronous per repo test rules)

Using `fakeWebViewSession`:
- `Page.attach()` issues an `evaluate()` containing the bootstrap and the
  `window.__mwInjected = new (...)` assignment.
- `getByRole('button', { name: 'Sign in' }).click()` emits an `evaluate()` whose
  selector **equals `getByRoleSelector('button', { name: 'Sign in' })` imported
  from `playwright-core`** — so the test fails if Playwright's selector format
  changes (protocol-breaking assertion).
- The click path references `window.__mwInjected.querySelector`.

### On-device e2e (the chosen verification bar)

A test app exposing a webview with a `role=button`: navigate to the webview,
`getByWebView().page().getByRole('button', { name }).click()`, assert the
observable effect. Runs against a real device webview.

## Success criteria

- `playwright-engine.ts` imports the injected `source` and `getByRoleSelector`
  from the pinned `playwright-core` with no vendored copy.
- `getByRole(...).click()` resolves elements and gates actionability through the
  injected engine, verified by the unit assertions above.
- The on-device e2e test clicks a real webview button via the new path.
- `npm run lint` passes.
- The two known limitations are documented in code/docs.

## Follow-on slices (not specified here)

1. Migrate the full locator surface (`getByText`, `getByLabel`,
   `getByPlaceholder`, `getByTestId`, `getByAltText`, `getByTitle`, `locator`,
   chaining, `nth/first/last`) to imported selector builders + injected
   `querySelector`.
2. Web-first assertion parity via the injected `expect`.
3. The async `stable` actionability check.
4. The on-device conformance suite: a real Playwright-style web test corpus run
   against the webview `Page`, establishing measured parity.
5. iOS WKWebView impossibility handling (file uploads, downloads, popups, trusted
   input): clear "unsupported on this webview" errors.
