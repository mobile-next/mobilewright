import type { Page, Expect } from '@playwright/test';
import { pageWithBody } from './fixtures.js';

// Assertions against a selector that matches nothing. This is where the injected
// matcher hands back a verdict with no `matches` field; if that leaks through as
// `pass: undefined`, expect() aborts with "Unexpected return from a matcher
// function" instead of failing (or passing) the way Playwright does.
export const missingElementAssertionsSpec = async (page: Page, expect: Expect): Promise<void> => {
  await page.goto(pageWithBody('<button id="present">go</button>'));

  const missing = page.locator('#nope');

  // Presence matchers: a missing element is simply absent.
  await expect(missing).not.toBeVisible();
  await expect(missing).toHaveCount(0);
  await expect(missing).toBeHidden();
  await expectOrdinaryFailure(expect, expect(missing).toBeVisible({ timeout: 1_000 }));

  // Value matchers: Playwright fails these — even negated — because there is no
  // element to read a value from. What matters here is that they fail as
  // ordinary assertion failures.
  await expectOrdinaryFailure(expect, expect(missing).toHaveText('go', { timeout: 1_000 }));
  await expectOrdinaryFailure(expect, expect(missing).not.toHaveText('go', { timeout: 1_000 }));
  await expectOrdinaryFailure(expect, expect(missing).not.toHaveAttribute('id', 'present', { timeout: 1_000 }));

  // An element that is not in the DOM yet: toBeVisible keeps polling until it
  // shows up, rather than giving up on the first look.
  await page.goto(pageWithBody(`<script>setTimeout(() => { document.body.insertAdjacentHTML('beforeend', '<p id="late">here</p>'); }, ${LATE_ELEMENT_DELAY_MS});</script>`));
  await expect(page.locator('#late')).toBeVisible({ timeout: 10_000 });
};

const LATE_ELEMENT_DELAY_MS = 1_500;

// An assertion on a missing element must reject with a normal matcher failure,
// never with Playwright's internal "Unexpected return from a matcher function".
async function expectOrdinaryFailure(expect: Expect, assertion: Promise<void>): Promise<void> {
  const error = await assertion.then(() => null, (e: Error) => e);
  expect(error).toBeTruthy();
  expect(error!.message).not.toContain('Unexpected return from a matcher function');
  expect(error!.message).toContain('expect(');
}
