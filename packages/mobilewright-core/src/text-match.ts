// Playwright's text matching rules, shared by the native locator engine:
// whitespace is trimmed and collapsed on both sides; a string matches as a
// case-insensitive substring unless `exact` is set, in which case it must equal
// the whole normalized text, case-sensitively; a RegExp is tested against the
// normalized text.

export function normalizeWhiteSpace(text: string): string {
  return text.trim().replace(/​/g, '').replace(/\s+/g, ' ');
}

export function textMatches(actual: string, expected: string | RegExp, exact?: boolean): boolean {
  const normalized = normalizeWhiteSpace(actual);
  if (expected instanceof RegExp) {
    expected.lastIndex = 0;
    return expected.test(normalized);
  }
  const wanted = normalizeWhiteSpace(expected);
  if (exact) {
    return normalized === wanted;
  }
  return normalized.toLowerCase().includes(wanted.toLowerCase());
}
