import { test, expect as pwExpect } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { WebLocator } from './web-locator.js';
import { fakeWebViewSession } from './fake-webview-session.js';

// Proof that Playwright's OWN expect() (from @playwright/test) can drive a
// mobilewright WebLocator: the web-first matchers call locator._expect() after
// gating on locator.constructor.name === 'Locator'. The fake session returns a
// canned injected-expect verdict, so these run without a device.

// A WebLocator whose injected expect() always reports the given match result.
function webLocatorWhoseMatchIs(matches: boolean): Locator {
  const { session } = fakeWebViewSession({ evaluateAlways: { matches } });
  return new WebLocator(session, 'internal:role=button') as unknown as Locator;
}

test('WebLocator is accepted by Playwright matchers (constructor.name === Locator)', () => {
  const locator = webLocatorWhoseMatchIs(true);
  pwExpect((locator as object).constructor.name).toBe('Locator');
});

test('expect(locator).toBeVisible() passes when the injected matcher matches', async () => {
  const locator = webLocatorWhoseMatchIs(true);
  await pwExpect(locator).toBeVisible({ timeout: 0 });
});

test('expect(locator).not.toBeVisible() passes when it does not match', async () => {
  const locator = webLocatorWhoseMatchIs(false);
  await pwExpect(locator).not.toBeVisible({ timeout: 0 });
});

test('expect(locator).toBeVisible() throws when the injected matcher does not match', async () => {
  const locator = webLocatorWhoseMatchIs(false);
  let threw = false;
  try {
    await pwExpect(locator).toBeVisible({ timeout: 0 });
  } catch {
    threw = true;
  }
  pwExpect(threw).toBe(true);
});
