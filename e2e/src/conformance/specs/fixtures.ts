import type { Page } from '@playwright/test';

// Wrap a readable HTML body fragment into a self-contained data: URL document.
// Tests author legible HTML; the data-URL encoding stays hidden behind the name.
// Pure (no runtime dependency) so both the mobilewright and Playwright runners
// can navigate to it via page.goto().
export function pageWithBody(bodyHtml: string): string {
  const doc = `<!doctype html><meta charset="utf-8"><body>${bodyHtml}</body>`;
  return `data:text/html,${encodeURIComponent(doc)}`;
}

// True only inside an Android System WebView (UA contains "Android"); false on
// iOS WKWebView and desktop Chromium. Used to skip assertions that rely on
// capabilities the Android webview can't provide under automation.
export async function isAndroidWebView(page: Page): Promise<boolean> {
  const userAgent = await page.evaluate(() => navigator.userAgent);
  return /Android/.test(userAgent);
}
