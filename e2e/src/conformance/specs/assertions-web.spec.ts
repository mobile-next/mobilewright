import type { Page, Expect } from '@playwright/test';
import { pageWithBody } from './fixtures.js';

export const webAssertionsSpec = async (page: Page, expect: Expect): Promise<void> => {
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
};
