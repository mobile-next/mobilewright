---
sidebar_position: 7
title: Web Views
---

# Web Views

Many mobile apps embed web content in a native **web view** (`WKWebView` on iOS, Android System WebView on Android, or a React Native web view). Mobilewright lets you drive that web content with the **same web API as [Playwright](https://playwright.dev)** — the same locators, the same actions, and the same web‑first assertions.

This is not a look‑alike API. Under the hood Mobilewright runs Playwright's own injected engine inside the web view, and the objects you get back (`Page`, `Locator`) **implement Playwright's interfaces**. That means a test written against `@playwright/test` can run, unchanged, against a web view on a real device.

## Requirements

This guide is about web views **embedded inside a native app** — it is *not* a way to automate a standalone browser over the Chrome DevTools Protocol (CDP). Mobilewright attaches to the web view through the app process, so:

- **The app must be debuggable.** Mobilewright can only inspect and inject into a web view that the OS allows it to attach to:
  - **Android** — the app must be built with `android:debuggable="true"` (a debug build). Release builds disable web view debugging.
  - **iOS** — the app must carry the `get-task-allow` entitlement (a development/debug build, including Simulator builds). App Store / distribution builds do not.
- It must be a real, in-app web view (`WKWebView`, Android System WebView, or a React Native web view) — not native UI that merely looks web-like.

If the app isn't debuggable, `getByWebView()` won't find a web view to attach to.

## Getting a page

From a `screen`, locate the web view and call `.page()` to attach to it:

```typescript
import { test, expect } from '@mobilewright/test';

test('open the in-app browser', async ({ device, screen }) => {
  await device.launchApp('com.example.app');

  // Navigate to the screen that hosts the web view (app-specific):
  await screen.getByText('Web View').tap();

  // Attach to the web view and get a Playwright-style Page:
  const page = await screen.getByWebView().page();

  await page.goto('https://example.com');
  await expect(page.getByRole('heading')).toHaveText('Example Domain');
});
```

`screen.getByWebView()` resolves the web view in the current screen. If an app shows **more than one** web view, pick one by position with `.first()`, `.last()`, or `.nth(i)`:

```typescript
const page = await screen.getByWebView().nth(1).page();
```

Or select a specific web view by its **native testId** — the accessibility identifier on the web view element (`resource-id` on Android, e.g. a React Native `<WebView testID="checkout">`; `accessibilityIdentifier` on iOS):

```typescript
const page = await screen.getByWebView({ testId: 'checkout' }).page();
```

## Driving the page

A web `Page` exposes the Playwright locator factories and navigation methods you already know:

```typescript
// Locators — same builders as Playwright
page.locator('#submit');
page.getByRole('button', { name: 'Sign in' });
page.getByText('Welcome back');
page.getByLabel('Email');
page.getByPlaceholder('you@example.com');
page.getByTestId('cart');
page.getByAltText('Company logo');
page.getByTitle('Close');

// Navigation
await page.goto('https://example.com/login');
await page.reload();
await page.goBack();
await page.goForward();
await page.waitForLoadState('domcontentloaded');
await page.waitForURL(/\/dashboard/);

const title = await page.title();
const html = await page.content();
const ua = await page.evaluate(() => navigator.userAgent);
```

Locators support the usual actions and queries, and they **auto-wait** just like native locators (see [Auto-waiting](./auto-waiting)):

```typescript
await page.getByPlaceholder('Email').fill('user@example.com');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.locator('#search').press('Enter');
await page.getByText('Terms').hover();
await page.locator('#footer-link').scrollIntoViewIfNeeded();

const count = await page.getByRole('listitem').count();
const value = await page.locator('#email').inputValue();
```

## Assertions

Web views use Playwright's **web-first assertions**, which retry until the condition holds or the timeout elapses:

```typescript
await expect(page.locator('#status')).toBeVisible();
await expect(page.getByRole('heading')).toHaveText('Dashboard');
await expect(page.locator('input[name="email"]')).toHaveValue(/@example\.com$/);
await expect(page.getByRole('listitem')).toHaveCount(3);
await expect(page.locator('#btn')).toHaveClass(/primary/);
await expect(page).toHaveURL(/\/dashboard/);
await expect(page).toHaveTitle(/Dashboard/);
```

Both `expect` from `@mobilewright/test` and `expect` from `@playwright/test` work on web pages and locators — they route through the same injected matcher, so the results are identical.

## Sharing code with Playwright

Because Mobilewright's web `Page` and `Locator` **implement Playwright's `Page` and `Locator`**, you can write a test body **once** and run it both on a device (Mobilewright) and in a desktop browser (Playwright) — no copy‑paste, no adapter layer.

The pattern is: extract the test body into a function that receives `page` and `expect` as parameters (typed against `@playwright/test`), then call it from a thin wrapper in each runner.

**1. The shared spec** — `specs/login.spec.ts`:

```typescript
import { type Page, type Expect } from '@playwright/test';

// Pure test logic. Imports nothing from a specific runner — it receives the
// page and expect, so the exact same code runs under either runtime.
export async function loginSpec(page: Page, expect: Expect): Promise<void> {
  await page.getByPlaceholder('Email').fill('user@example.com');
  await page.getByPlaceholder('Password').fill('correct horse');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading')).toHaveText('Welcome');
}
```

**2. The Mobilewright runner** — `login.test.ts` (runs on a real device's web view):

```typescript
import { test } from '@mobilewright/test';
import { expect } from '@playwright/test';
import { loginSpec } from './specs/login.spec';

test('login works in the app web view', async ({ device, screen }) => {
  await device.launchApp('com.example.app');
  await screen.getByText('Web View').tap();

  const page = await screen.getByWebView().page();
  await page.goto('https://example.com/login');

  await loginSpec(page, expect);
});
```

**3. The Playwright runner** — `login.pw.ts` (runs in a desktop browser):

```typescript
import { test, expect } from '@playwright/test';
import { loginSpec } from './specs/login.spec';

test('login works in the browser', async ({ page }) => {
  await page.goto('https://example.com/login');
  await loginSpec(page, expect);
});
```

The body in `loginSpec` is identical for both. The only per-runtime code is *how the `page` is obtained* — from a launched app's web view on device, or from Playwright's `page` fixture in the browser. This makes Playwright a useful **parity oracle**: if a spec passes in the browser but fails on device, your app behaves differently there.

:::tip
Keep the runners apart with file naming. Point Mobilewright at `*.test.ts` and Playwright at `*.pw.ts` (via `testMatch` in each config) so neither runner picks up the other's wrapper, and the shared `*.spec.ts` files are imported by both but run by neither.
:::

## How it works

When you attach to a web view, Mobilewright injects Playwright's own selector-and-assertion engine into the page. Locators are resolved in-page by that engine, and every web-first assertion runs Playwright's matcher inside the web view — so selector semantics, whitespace normalization, and matcher behavior match Playwright exactly.

The engine is re-injected automatically after navigations (a fresh document drops it), including page-initiated redirects, so your locators keep working across `goto`, `reload`, and in-page navigation.

## Supported API and limitations

The web-first surface for driving content is supported: navigation, the `getBy*` locators, actions (`click`, `fill`, `type`, `press`, `hover`, `focus`, `scrollIntoViewIfNeeded`), value/state queries, and the web-first `expect` matchers (`toBeVisible`, `toHaveText`, `toHaveValue`, `toHaveCount`, `toHaveAttribute`, `toHaveClass`, `toHaveCSS`, `toHaveId`, `toHaveJSProperty`, `toBeChecked`, `toBeEnabled`, `toBeEditable`, `toHaveURL`, `toHaveTitle`, …).

Some Playwright capabilities have no equivalent inside an embedded web view and will throw if called:

- Network interception (`page.route`, `routeFromHAR`)
- Screenshots / visual snapshots (`page.screenshot`, `toHaveScreenshot`)
- Dialogs, downloads, file choosers, and multiple tabs / popups
- `page.pdf`, `page.addInitScript`, browser contexts

### Platform notes

- **`page.url()` is synchronous** (matching Playwright) and returns the last URL from a navigation Mobilewright drove. After a link click or in-app redirect it can lag — use `expect(page).toHaveURL(...)` or `page.waitForURL(...)` for live, auto-waiting checks.
- **`toBeFocused()` is not reliable on Android.** The embedded Android System WebView ignores programmatic focus without renderer focus emulation (a capability that isn't available there), so `document.activeElement` doesn't update. Focus assertions work on iOS and in desktop Chromium.
