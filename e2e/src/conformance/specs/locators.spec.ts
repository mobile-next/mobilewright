import type { Page, Expect } from '@playwright/test';
import { pageWithBody } from './fixtures.js';

export const locatorsSpec = async (page: Page, expect: Expect): Promise<void> => {
  await page.goto(pageWithBody(`
    <button>Sign in</button>
    <a href="#">Sign in</a>
    <label>Email <input type="text" placeholder="you@example.com" data-testid="email"></label>
    <img alt="Company logo" src="x">
    <span title="Close dialog">x</span>
    <p class="greeting">Hello   world</p>
    <ul><li>one</li><li>two</li><li>three</li></ul>
  `));

  // getByRole with accessible name, exact, and regex
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'sign', exact: false })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /sign/i })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(1);

  // getByText exact vs substring vs regex
  await expect(page.getByText('Hello world')).toHaveCount(1);
  await expect(page.getByText('Hello', { exact: false })).toHaveCount(1);
  await expect(page.getByText(/hello/i)).toHaveCount(1);

  // label / placeholder / testid / alt / title
  await expect(page.getByLabel('Email')).toHaveCount(1);
  await expect(page.getByPlaceholder('you@example.com')).toHaveCount(1);
  await expect(page.getByTestId('email')).toHaveCount(1);
  await expect(page.getByAltText('Company logo')).toHaveCount(1);
  await expect(page.getByTitle('Close dialog')).toHaveCount(1);

  // raw css, count, nth/first/last, chaining
  await expect(page.locator('li')).toHaveCount(3);
  await expect(page.locator('li').first()).toHaveText('one');
  await expect(page.locator('li').nth(1)).toHaveText('two');
  await expect(page.locator('li').last()).toHaveText('three');
  await expect(page.locator('ul').getByText('two')).toHaveCount(1);
};
