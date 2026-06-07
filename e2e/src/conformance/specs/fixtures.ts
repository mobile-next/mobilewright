// Wrap a readable HTML body fragment into a self-contained data: URL document.
// Tests author legible HTML; the data-URL encoding stays hidden behind the name.
// Pure (no runtime dependency) so both the mobilewright and Playwright runners
// can navigate to it via page.goto().
export function pageWithBody(bodyHtml: string): string {
  const doc = `<!doctype html><meta charset="utf-8"><body>${bodyHtml}</body>`;
  return `data:text/html,${encodeURIComponent(doc)}`;
}
