import type { Page, Expect } from '@playwright/test';
import { pageWithBody } from './fixtures.js';

export const stateAssertionsSpec = async (page: Page, expect: Expect): Promise<void> => {
  await page.goto(pageWithBody(`
    <div id="visible">shown</div>
    <div id="hidden" style="display:none">gone</div>
    <button id="enabled">ok</button>
    <button id="disabled" disabled>no</button>
    <input id="editable" type="text">
    <input id="readonly" type="text" readonly>
    <input id="checkbox" type="checkbox" checked>
    <input id="empty" type="text" value="">
  `));

  await expect(page.locator('#visible')).toBeVisible();
  await expect(page.locator('#hidden')).not.toBeVisible();
  await expect(page.locator('#hidden')).toBeHidden();
  await expect(page.locator('#visible')).not.toBeHidden();

  await expect(page.locator('#enabled')).toBeEnabled();
  await expect(page.locator('#disabled')).toBeDisabled();
  await expect(page.locator('#disabled')).not.toBeEnabled();

  await expect(page.locator('#editable')).toBeEditable();
  await expect(page.locator('#readonly')).not.toBeEditable();

  await expect(page.locator('#checkbox')).toBeChecked();

  await expect(page.locator('#visible')).toBeAttached();
  await expect(page.locator('#missing')).not.toBeAttached();

  await expect(page.locator('#empty')).toBeEmpty();
  await expect(page.locator('#visible')).not.toBeEmpty();

  await expect(page.locator('#visible')).toBeInViewport();
};
