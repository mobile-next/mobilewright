import type { Page, Expect } from '@playwright/test';
import { pageWithBody, isAndroidWebView } from './fixtures.js';

export const actionsSpec = async (page: Page, expect: Expect): Promise<void> => {
  await page.goto(pageWithBody(`
    <button id="b" onclick="this.textContent='clicked'">press me</button>
    <input id="fill" type="text">
    <input id="type" type="text">
    <input id="key" type="text" onkeydown="this.value='key:'+event.key">
    <input id="focusable" type="text">
    <div id="hovered">idle</div>
    <button id="hover" onmouseover="document.getElementById('hovered').textContent='hovered'">hover me</button>
    <div style="height:2000px"></div>
    <button id="bottom">bottom</button>
  `));

  // click
  await page.locator('#b').click();
  await expect(page.locator('#b')).toHaveText('clicked');

  // fill
  await page.locator('#fill').fill('hello@example.com');
  await expect(page.locator('#fill')).toHaveValue('hello@example.com');

  // type (appends)
  await page.locator('#type').type('abc');
  await expect(page.locator('#type')).toHaveValue('abc');

  // press
  await page.locator('#key').press('Enter');
  await expect(page.locator('#key')).toHaveValue('key:Enter');

  // focus — Android System WebView ignores programmatic el.focus() without
  // renderer focus emulation (a CDP-only capability we don't have on Android),
  // so activeElement never updates. Known gap: skip the focus assertion there.
  const onAndroid = await isAndroidWebView(page);
  if (!onAndroid) {
    await page.locator('#focusable').focus();
    await expect(page.locator('#focusable')).toBeFocused();
  }

  // hover
  await page.locator('#hover').hover();
  await expect(page.locator('#hovered')).toHaveText('hovered');

  // scrollIntoViewIfNeeded — no throw, element becomes in viewport
  await page.locator('#bottom').scrollIntoViewIfNeeded();
  await expect(page.locator('#bottom')).toBeInViewport();
};
