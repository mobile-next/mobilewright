import type { Page, Expect } from '@playwright/test';

// A real, cross-origin HTTPS page (not a data: URL) so this exercises an actual
// network navigation plus engine re-injection on the fresh document. It covers
// the subset of the web API that stays stable against a live site; the
// deterministic matcher matrix lives in the other conformance files.
const PYTHAGOREAN_ARTICLE = 'https://en.wikipedia.org/wiki/Pythagorean_theorem';

export const realNavigationSpec = async (page: Page, expect: Expect): Promise<void> => {
  await page.goto(PYTHAGOREAN_ARTICLE);
  await page.waitForLoadState('domcontentloaded');

  // Page-level state reflects the real navigation.
  await expect(page).toHaveURL(/Pythagorean_theorem/);
  await expect(page).toHaveTitle(/Pythagorean theorem/);

  // The article heading resolves by id and by accessible role+name.
  await expect(page.locator('#firstHeading')).toContainText('Pythagorean theorem');
  await expect(page.getByRole('heading', { name: /Pythagorean theorem/ }).first()).toBeVisible();

  // A real article has many links; assert a lower bound rather than an exact
  // count, which would drift as the page is edited.
  const linkCount = await page.getByRole('link').count();
  expect(linkCount).toBeGreaterThan(50);
  await expect(page.getByRole('link').first()).toBeVisible();

  // Scroll the last link (near the page bottom) into view and confirm it lands
  // in the viewport — a skin-independent target on a long article.
  const lastLink = page.getByRole('link').last();
  await lastLink.scrollIntoViewIfNeeded();
  await expect(lastLink).toBeInViewport();
};
