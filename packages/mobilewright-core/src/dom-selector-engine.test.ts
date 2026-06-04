import { test, expect as playwrightExpect } from '@playwright/test';
import { DOM_SELECTOR_ENGINE } from './dom-selector-engine.js';

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// The selector engine is injected into a real browser as a string, so it is not
// executed here — behavioural coverage lives in the e2e webview tests. These
// guards ensure the stateful-regex resets are not dropped: a /g or /y RegExp
// advances lastIndex on every .test(), so the engine must reset it before each
// call, otherwise repeated matching across elements silently skips matches.
test.describe('DOM_SELECTOR_ENGINE stateful-regex resets', () => {
  test('resets lastIndex before every RegExp .test() (text, attribute, role matchers)', () => {
    playwrightExpect(countOccurrences(DOM_SELECTOR_ENGINE, 'lastIndex = 0')).toBeGreaterThanOrEqual(3);
  });

  test('resets the RegExp in buildTextMatcher and findByAttr', () => {
    playwrightExpect(DOM_SELECTOR_ENGINE).toContain('textOrRegex.lastIndex = 0');
  });

  test('resets the RegExp before testing the accessible name in findByRole', () => {
    playwrightExpect(DOM_SELECTOR_ENGINE).toContain('name.lastIndex = 0');
  });
});
