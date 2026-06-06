import { test, expect as playwrightExpect } from '@playwright/test';
import { buildExpectEvaluate, textValue, type FrameExpectParams } from './web-expect-matcher.js';

test.describe('web-expect-matcher', () => {
  test('textValue builds a string matcher with flags', () => {
    playwrightExpect(textValue('Hi', { normalizeWhiteSpace: true }))
      .toEqual({ string: 'Hi', normalizeWhiteSpace: true });
  });

  test('textValue builds a regex matcher from a RegExp', () => {
    playwrightExpect(textValue(/hi/i)).toEqual({ regexSource: 'hi', regexFlags: 'i' });
  });

  test('buildExpectEvaluate calls window.__mwInjected.expect with the params', () => {
    const params: FrameExpectParams = { expression: 'to.have.text', expectedText: [textValue('Hi')], isNot: false, timeout: 0 };
    const js = buildExpectEvaluate('.btn', params);
    playwrightExpect(js).toContain('window.__mwInjected');
    playwrightExpect(js).toContain('is.expect(elements[0],');
    playwrightExpect(js).toContain('is.querySelectorAll(is.parseSelector(".btn")');
    playwrightExpect(js).toContain('"expression":"to.have.text"');
    playwrightExpect(js).toContain('"string":"Hi"');
  });
});
