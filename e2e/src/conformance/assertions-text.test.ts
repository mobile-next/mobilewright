import { test, expect } from '@mobilewright/test';
import { openWebviewPage, pageWithBody } from './harness.js';

test('text assertions match Playwright (incl. whitespace normalization)', async ({ device, screen }) => {
  const page = await openWebviewPage({ device, screen });

  await page.goto(pageWithBody(`
    <p id="text">  Hello   world  </p>
    <input id="value" type="text" value="john@example.com">
  `));

  // Playwright normalizes whitespace for STRING matches (so the multi-space,
  // padded text equals 'Hello world')...
  await expect(page.locator('#text')).toHaveText('Hello world');
  await expect(page.locator('#text')).not.toHaveText('Goodbye');
  // ...but NOT for REGEX matches — a regex is tested against the raw text, so it
  // must account for the actual whitespace.
  await expect(page.locator('#text')).toHaveText(/Hello\s+world/);
  await expect(page.locator('#text')).not.toHaveText(/Hello world/);

  // toContainText substring
  await expect(page.locator('#text')).toContainText('world');
  await expect(page.locator('#text')).not.toContainText('planet');

  // toHaveValue exact + regex + negative
  await expect(page.locator('#value')).toHaveValue('john@example.com');
  await expect(page.locator('#value')).toHaveValue(/@example\.com$/);
  await expect(page.locator('#value')).not.toHaveValue('other');
});
