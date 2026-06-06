import { test, expect } from '@mobilewright/test';

// Set to a webview-capable app installed on the target device.
const APP_ID = 'com.example.webviewdemo';

test('clicks a real webview button via the injected Playwright engine', async ({ device, screen }) => {
  await device.launchApp(APP_ID);

  const page = await screen.getByWebView().page();

  // Self-contained fixture: clicking the button mutates document.title, which
  // we read back to confirm the click actually fired in the real webview.
  await page.goto('data:text/html,<button onclick="document.title=\'clicked\'">Sign in</button>');

  await page.getByRole('button', { name: 'Sign in' }).click();

  const title = await page.title();
  expect(title).toBe('clicked');
});
