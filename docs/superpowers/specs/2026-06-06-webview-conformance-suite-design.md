# Webview Conformance Suite + iOS Engine Detection

**Date:** 2026-06-06
**Status:** Design — pending review
**Scope:** Webview web automation only. The native mobilewright API is frozen.
**Predecessors:** slices 1–3 (injected engine, full locator surface, web-first assertions).

## Goal

Prove — on a real device webview — that mobilewright's web `Page`/`WebLocator`/
`expect` behave like Playwright, by running a corpus of Playwright-style web
tests against an actual iOS WKWebView. The corpus is written exactly as Playwright
web tests; passing against the webview `Page` is the parity evidence, and any
failure is a discovered gap.

This is the verification bar chosen during the original brainstorm ("against a
real device webview"). It runs on-device (manual / not CI), like the existing
e2e tests.

A small core change ships with it: the injected-engine bootstrap detects the
browser engine in-page so WKWebView is configured as `webkit` (not `chromium`),
making iOS conformance valid.

## Target environment

- App: `com.mobilenext.playground` (installed on the target device).
- Navigation to the webview: launch the app, tap the **Webview** button, which
  opens a screen containing a WebView. Then `screen.getByWebView().page()`.
- Platform: iOS (WKWebView). `browserName` resolves to `webkit` via in-page
  detection (below).
- Fixtures: self-contained `data:` URLs (no server, no network), authored as
  readable HTML in the test code.

## Core change: in-page `browserName` detection

`playwright-engine.ts` `bootstrapScript()` currently hard-codes
`browserName: 'chromium'` in the InjectedScript options. Playwright uses
`browserName` for engine-specific branches (some role/CSS/visibility quirks), so
running the Chromium configuration inside WKWebView risks false conformance
failures.

Change: a small pure helper `detectBrowserName(userAgent: string): 'webkit' |
'chromium'` (exported from `playwright-engine.ts`) returns `'webkit'` when the
UA matches `/AppleWebKit/` without `/Chrome\//`, else `'chromium'`. The bootstrap
IIFE calls `detectBrowserName(navigator.userAgent)` in-page and passes the result
into the InjectedScript options instead of the hard-coded constant. WKWebView's
UA contains `AppleWebKit` without `Chrome/`; Android System WebView / Chromium
contains `Chrome/`. This keeps the decision self-contained in the adapter — no
platform plumbing through `Page.attach`/`WebViewSession`.

Because the bootstrap is a string evaluated in-page, the helper's source is
inlined into `bootstrapScript()`'s output (its `.toString()` is embedded), while
the same exported helper is unit-tested off-device. Heuristic, but standard.

### Why not thread platform through the API

`Page.attach(session)` has no platform handle, and `WebViewSession` does not
carry one. UA detection avoids adding that dependency while getting the right
engine config for the only two webview families we target.

## Architecture

### Component 1 — `e2e/src/conformance/harness.ts`

- `openWebviewPage({ device, screen }): Promise<Page>` — launches
  `com.mobilenext.playground`, taps the Webview button
  (`screen.getByText('Webview').tap()`), and returns
  `screen.getByWebView().page()`. The single owner of the native path; every
  conformance test starts from the returned `Page`.
- `pageWithBody(bodyHtml: string): string` — wraps a readable body fragment in a
  minimal document and encodes it as a data URL:
  ```ts
  return `data:text/html,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><body>${bodyHtml}</body>`)}`;
  ```
  Tests author legible multi-line HTML; the data-URL conversion is hidden behind
  the name.
- To amortize slow device launches, the harness reuses one `Page` across the
  tests in a file (obtained once per file), and each test calls
  `page.goto(pageWithBody(...))` to load its fixture.

### Component 2 — Corpus files under `e2e/src/conformance/`

Each test: load one readable fixture via `page.goto(pageWithBody(html))`, then
run related checks (grouped per fixture to amortize device cost). Written exactly
as Playwright web tests.

- `locators.test.ts` — every factory: `getByRole` (with `name`, `exact`, regex),
  `getByText` (exact / substring / regex), `getByLabel`, `getByPlaceholder`,
  `getByTestId`, `getByAltText`, `getByTitle`, `locator(css)`, `nth`/`first`/
  `last`, and parent→child chaining. Asserted via `count()` and `textContent()`.
- `actions.test.ts` — `click`, `fill`, `type`, `press`, `focus`, `hover`,
  `scrollIntoViewIfNeeded`; each verified by an in-DOM effect (e.g. click flips
  visible text; fill sets `value`; the fixture wires handlers that mutate the
  DOM/title).
- `assertions-state.test.ts` — `toBeVisible`, `toBeHidden`, `toBeEnabled`,
  `toBeDisabled`, `toBeEditable`, `toBeFocused`, `toBeAttached`,
  `toBeInViewport`, `toBeChecked`, `toBeEmpty` — positive and negative cases.
- `assertions-text.test.ts` — `toHaveText`, `toContainText`, `toHaveValue` with
  exact, substring, regex, and whitespace-normalization edge cases.
- `assertions-web.test.ts` — `toHaveCount`, `toHaveAttribute`, `toHaveClass`,
  `toContainClass`, `toHaveCSS`, `toHaveId`, `toHaveJSProperty` — positive and
  negative cases.

## Data flow

`launchApp(playground)` → tap **Webview** → `screen.getByWebView().page()` →
per test: `page.goto(pageWithBody(<readable html>))` → Playwright-style
locators/assertions against the WKWebView `Page` → pass = parity holds.

## Error handling / expected outcomes

- A conformance test failing is a *finding*, not a harness bug: it marks a real
  divergence between mobilewright and Playwright to triage (engine config,
  unimplemented behavior, or an `evaluate()`-ceiling limit such as trusted
  input).
- Trusted-input-only behaviors are out of scope for assertions (slice-1
  documented ceiling); fixtures avoid relying on them.
- The suite is device-gated: it is not part of the normal `npm test`/CI run;
  it is invoked explicitly against a connected device.

## Testing strategy

- The conformance corpus *is* the test artifact (run on-device).
- The one shippable unit test: `playwright-engine.test.ts` gains a case pinning
  the `browserName` detection — a WKWebView-style UA resolves to `webkit`, a
  Chrome-style UA resolves to `chromium`. Implemented by exposing the detection
  as a small pure helper (e.g. `detectBrowserName(userAgent: string): 'webkit' |
  'chromium'`) used inside `bootstrapScript()`, so it is unit-testable off-device.
- Full off-device suite + lint remain green (only `playwright-engine.ts` changes
  in core; new unit test added).

## Success criteria

- `bootstrapScript()` emits engine-detected `browserName`; `detectBrowserName`
  unit test passes for both UA families; off-device suite + lint green.
- `harness.ts` exposes `openWebviewPage` and `pageWithBody`.
- The five corpus files exist and are authored as Playwright-style web tests with
  readable HTML fixtures, covering every locator factory, action, and implemented
  matcher (positive + negative).
- Running the corpus on a `com.mobilenext.playground` device produces a pass/fail
  report; failures are triaged as findings (documented), not silently ignored.

## Follow-on (unchanged queue)

1. Per-method actionability retiming to exact Playwright semantics + `stable`.
2. iOS WKWebView impossibility handling (uploads/downloads/popups/trusted input)
   — informed by conformance findings.
3. Triage + fix whatever the conformance run surfaces.
