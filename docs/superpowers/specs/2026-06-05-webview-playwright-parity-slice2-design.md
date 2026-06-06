# Webview Playwright Parity — Slice 2: Full Locator Surface on the Injected Engine

**Date:** 2026-06-05
**Status:** Design — pending review
**Scope:** Webview web automation only. The native mobilewright API is frozen.
**Predecessor:** `2026-06-05-webview-playwright-parity-slice1-design.md`

## Goal

Migrate the entire `WebLocator`/`Page` web surface off the hand-rolled selector
engine and onto Playwright's imported injected engine, so selector resolution,
role/accessible-name computation, and element-state checks are Playwright's own
code for every locator method — not just `getByRole().click()`.

This is a **full replacement**: the `WebLocatorStrategy` union, `buildFindAll`,
and `DOM_SELECTOR_ENGINE` are removed. `WebLocator` carries a single Playwright
selector string.

## Non-goals

- The native side (unchanged).
- Web-first assertion internals beyond what already rides on the migrated query
  methods (a dedicated assertion-parity pass is a later slice).
- Per-method actionability *retiming* to exact Playwright semantics (e.g.
  `isVisible()` being immediate, reads waiting for attached-not-visible). This
  slice swaps the resolution/state *mechanism* to the injected engine but keeps
  each method's current poll/timeout structure.
- iOS `browserName:'webkit'` selection and impossibility handling (later slice).
- Trusted input (documented ceiling from slice 1; dispatch stays synthetic).

## Background (verified against playwright-core@1.58.2)

- Selector builders (pure, importable) from
  `lib/utils/isomorphic/locatorUtils.js`:
  - `getByRoleSelector(role, options?)` — e.g. `getByRoleSelector('button', { name: 'Sign in' })` → `internal:role=button[name="Sign in"i]`
  - `getByTextSelector(text, exact?)` → `internal:text="Hello"i` (loose) / `…"s` (exact)
  - `getByLabelSelector(label, exact?)` → `internal:label="Email"i`
  - `getByPlaceholderSelector(text, exact?)` → `internal:attr=[placeholder="Search"i]`
  - `getByAltTextSelector(text, exact?)` → `internal:attr=[alt="logo"i]`
  - `getByTitleSelector(text, exact?)` → `internal:attr=[title="Close"i]`
  - `getByTestIdSelector(attrName, value)` → `internal:testid=[data-testid="submit"s]`
  - `exact` is a **positional boolean** for everything except `getByRoleSelector`
    (which takes an options object).
- Chaining / indexing conventions (from `lib/client/locator.js`):
  - chain: `parent + " >> " + child`
  - `first` → `" >> nth=0"`, `last` → `" >> nth=-1"`, `nth(i)` → `" >> nth=" + i`
- Injected instance API (`window.__mwInjected`):
  - `parseSelector(selectorString)` → parsed selector
  - `querySelector(parsed, root, strict)` — strict=true throws on >1 match
  - `querySelectorAll(parsed, root)` → array
  - `elementState(node, state)` / `checkElementStates(node, states)` — returns
    `undefined` when all states pass, else `{ missingState }` or `'error:notconnected'`

## Architecture

### Component 1 — `playwright-engine.ts` (extend)

Re-export all seven builders and add the test-id attribute constant:

```ts
export const TEST_ID_ATTR = 'data-testid';
export const getByRoleSelector: GetByRoleSelector = locatorUtils.getByRoleSelector;
export const getByTextSelector = locatorUtils.getByTextSelector as (text: string | RegExp, exact?: boolean) => string;
export const getByLabelSelector = locatorUtils.getByLabelSelector as (label: string | RegExp, exact?: boolean) => string;
export const getByPlaceholderSelector = locatorUtils.getByPlaceholderSelector as (text: string | RegExp, exact?: boolean) => string;
export const getByAltTextSelector = locatorUtils.getByAltTextSelector as (text: string | RegExp, exact?: boolean) => string;
export const getByTitleSelector = locatorUtils.getByTitleSelector as (text: string | RegExp, exact?: boolean) => string;
export const getByTestIdSelector = locatorUtils.getByTestIdSelector as (attrName: string, value: string | RegExp) => string;
```

The bootstrap options already set `testIdAttributeName: 'data-testid'`, matching
`TEST_ID_ATTR`.

### Component 2 — `WebLocator` carries a selector string

- Constructor: `constructor(session: WebViewSession, selector: string)` (replaces
  `strategy: WebLocatorStrategy`). `_stepFn` carried forward by `derive()`.
- Remove `_pwSelector` and `clickViaInjectedEngine` (slice-1 scaffolding).
- Two resolution primitives, used by all methods:
  - `private firstEl(): string` →
    `window.__mwInjected.querySelector(window.__mwInjected.parseSelector(${JSON.stringify(this.selector)}), document, true)`
  - collection (for `count`) →
    `window.__mwInjected.querySelectorAll(window.__mwInjected.parseSelector(${JSON.stringify(this.selector)}), document)`
- `firstElExpr(body)`, `evalOnFirst(body)`, `actOnFirst(action, what)`,
  `readFromFirst`, `readStringProp` keep their current shapes but build on the
  new `firstEl()`.
- Chaining: `child(childSelector: string)` → `derive(this.selector + ' >> ' + childSelector)`.
- `locator(css)` → `child(css)`. `getByRole(...)` → `child(getByRoleSelector(...))`,
  and likewise for the other `getBy*`.
- `first/last/nth` → `derive(this.selector + ' >> nth=' + index)` (with `0`/`-1`).
- State checks via the injected engine. Behavior verified against Playwright
  source (`server/frames.ts`): all six pass `strict: true` (multiple matches
  throw a strict-mode violation), but missing-element handling differs:

  | method | multiple matches | missing element | auto-wait |
  | --- | --- | --- | --- |
  | `isVisible` / `isHidden` | throw (strict) | return `false` | no (immediate) |
  | `isEnabled` / `isDisabled` / `isChecked` | throw (strict) | **throw** (not attached) | waits for element |

  - `isVisible`: resolve `querySelector(parsed, document, /*strict*/ true)`; if
    the element is missing → `false`; else `elementState(el, 'visible').matches`.
    A strict-mode violation propagates (rejects). `isHidden = !isVisible`.
  - `isEnabled` / `isChecked`: resolve the element (missing → in-page throw
    `"<what>: element not found"`); then `elementState(el, 'enabled'|'checked').matches`.
    `isDisabled = !isEnabled`.
  - **Timing caveat (deferred):** Playwright's `isVisible` is a single immediate
    check; our methods keep their current poll/timeout structure this slice.
    Retiming to Playwright's exact wait semantics is the later
    actionability-retiming slice. This slice folds in the *missing-element*
    semantics above (cheap while rewriting these methods) but not the timing.
  - `pollUntilVisible` polls the injected `['visible']` check.
- Reads and actions: unchanged bodies, now resolving through the new `firstEl()`.

### Component 3 — `Page` factories build selector strings

`locatorFor(selector: string)` constructs `new WebLocator(session, selector)`.
Each factory passes the builder output: `locator(css)`→`css`,
`getByRole`→`getByRoleSelector(role, { name, exact })`,
`getByText`→`getByTextSelector(text, exact)`, …,
`getByTestId`→`getByTestIdSelector(TEST_ID_ATTR, id)`. Remove the
`WebLocatorStrategy` import. `Page.attach()` injects only `bootstrapScript()`.

### Deletions

- `dom-selector-engine.ts` (and its export from `index.ts`).
- `buildFindAll` and the `WebLocatorStrategy` union in `web-locator.ts` (and any
  `WebLocatorStrategy` export from `index.ts`).
- `Page.attach()`'s `DOM_SELECTOR_ENGINE` injection.

## Data flow (unchanged shape, swapped mechanism)

`page.getByText('Hello').nth(1).click()` →
selector `internal:text="Hello"i >> nth=1` → `click()` polls
`checkElementStates(el,['visible','enabled'])` via one self-contained
`evaluate()` per poll, then a final `evaluate()` does synthetic `el.click()`.

## Error handling

- Strict resolution: `querySelector(..., true)` throws in-page when a locator
  matches >1 element — surfaced as a rejected `evaluate()`. Intentional parity
  with Playwright strict locators.
- Missing element in an action: `actOnFirst` throws `"<what>: element not found"`
  in-page (unchanged).
- Engine not initialized: in-page guard throws `"mobilewright: injected engine
  not initialized"`.

## Testing strategy

Unit tests use `fakeWebViewSession` (synchronous helpers per repo rules).

- **Selector parity (protocol-breaking):** for each factory, assert the emitted
  `evaluate()` contains `parseSelector(<exact builder output>)`, where the
  expected value is computed by importing the same builder from
  `playwright-engine.js`. Breaks if Playwright's selector format changes.
- **Engine usage:** assert resolution goes through `window.__mwInjected`
  (`querySelector`/`querySelectorAll`).
- **Chaining/nth:** `loc.getByText('x').nth(2)` → selector contains
  `>> nth=2` and the child text selector after a `>>`.
- **Behavior:** `count`, `isVisible`, `isEnabled`, `isChecked`, `textContent`,
  `innerText`, `innerHTML`, `inputValue`, `getAttribute`, `boundingBox` return
  the canned values (adapted to the injected resolution).
- **Missing-element semantics:** `isVisible` returns `false` when the element is
  absent; `isChecked`/`isEnabled` reject ("element not found") when absent.
- **Actions:** `click`/`fill`/`type`/`press`/`focus`/`hover`/`scrollIntoViewIfNeeded`
  emit an `evaluate()` referencing `window.__mwInjected` and the action body
  (e.g. `el.click()`, the fill value).
- The slice-1 `getByRole().click()` test continues to pass through the unified
  path.

Then: full core suite green, `npm run lint` clean.

## Success criteria

- No references to `WebLocatorStrategy`, `buildFindAll`, or `DOM_SELECTOR_ENGINE`
  remain in `packages/mobilewright-core/src` (excluding deleted files).
- Every `WebLocator`/`Page` factory produces a Playwright selector string via an
  imported builder, verified by protocol-breaking unit assertions.
- All `WebLocator` methods resolve through `window.__mwInjected`.
- Full core test suite passes; lint passes.

## Follow-on slices (unchanged from slice 1's queue)

1. Web-first assertion parity via the injected `expect`.
2. Per-method actionability retiming to exact Playwright semantics + `stable`.
3. On-device conformance suite.
4. iOS WKWebView `browserName:'webkit'` + impossibility handling.
