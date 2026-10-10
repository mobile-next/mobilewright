import type { Page, Expect } from '@playwright/test';
import { pageWithBody } from './fixtures.js';

// An <iframe> whose document is `bodyHtml`. srcdoc frames share the parent's
// origin, so they are the same-origin iframes that frameLocator() can enter.
function iframeWithBody(id: string, bodyHtml: string): string {
  const doc = `<!doctype html><meta charset="utf-8"><body>${bodyHtml}</body>`;
  return `<iframe id="${id}" srcdoc="${doc.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>`;
}

export const framesSpec = async (page: Page, expect: Expect): Promise<void> => {
  await page.goto(pageWithBody(`
    <p>outside</p>
    ${iframeWithBody('app', `
      <p>inside</p>
      <button id="b" onclick="this.textContent='clicked'">press me</button>
      <input id="name" type="text">
      <ul><li>one</li><li>two</li><li>three</li></ul>
      ${iframeWithBody('nested', '<p>deep</p>')}
    `)}
  `));

  const app = page.frameLocator('#app');

  // Locators resolve inside the iframe's document, not the page's.
  await expect(app.getByText('inside')).toBeVisible();
  await expect(page.getByText('inside')).toHaveCount(0);
  await expect(app.getByText('outside')).toHaveCount(0);
  await expect(app.locator('li')).toHaveCount(3);
  await expect(app.getByRole('listitem').nth(1)).toHaveText('two');

  // Actions reach elements inside the iframe.
  await app.getByRole('button', { name: 'press me' }).click();
  await expect(app.locator('#b')).toHaveText('clicked');
  await app.locator('#name').fill('hello');
  await expect(app.locator('#name')).toHaveValue('hello');
  expect(await app.locator('#name').inputValue()).toBe('hello');

  // contentFrame() is the same frame, reached from a locator of the <iframe>.
  await expect(page.locator('#app').contentFrame().locator('#b')).toHaveText('clicked');
  await expect(app.owner()).toHaveAttribute('id', 'app');

  // Nested iframes.
  await expect(app.frameLocator('#nested').getByText('deep')).toBeVisible();
  await expect(page.locator('#app').contentFrame().locator('#nested').contentFrame().getByText('deep')).toBeVisible();

  // An iframe that is not there matches nothing.
  await expect(page.frameLocator('#nope').getByText('inside')).toHaveCount(0);
  await expect(page.frameLocator('#nope').getByText('inside')).toBeHidden();

  // The iframe loads a new document: its locators keep working.
  await page.evaluate('document.getElementById("app").srcdoc = "<p>reloaded</p>"');
  await expect(app.getByText('reloaded')).toBeVisible();
  await expect(app.getByText('inside')).toHaveCount(0);
};
