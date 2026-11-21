import { test, expect as playwrightExpect } from '@playwright/test';
import { buildExpectEvaluate, missingElementVerdict, textValue, type ExpectResult, type FrameExpectParams } from './web-expect-matcher.js';

function verdictWhenNothingMatches(expression: string, opts: { isNot: boolean } = { isNot: false }): ExpectResult {
  return missingElementVerdict({ expression, isNot: opts.isNot, timeout: 0 });
}

function evaluateFor(expression: string): string {
  return buildExpectEvaluate('.btn', { expression, isNot: false, timeout: 0 });
}

const MISSING_ELEMENT_GUARD = 'if (elements.length === 0) { return null; }';

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

  test('buildExpectEvaluate returns null instead of calling the matcher when no element matches', () => {
    playwrightExpect(evaluateFor('to.be.visible')).toContain(MISSING_ELEMENT_GUARD);
  });

  test('buildExpectEvaluate lets array matchers see an empty element list', () => {
    playwrightExpect(evaluateFor('to.have.count')).not.toContain(MISSING_ELEMENT_GUARD);
    playwrightExpect(evaluateFor('to.have.text.array')).not.toContain(MISSING_ELEMENT_GUARD);
  });
});

// Mirrors the no-element branch of playwright-core's Frame._expectInternal.
test.describe('missingElementVerdict', () => {
  test('a missing element is hidden', () => {
    playwrightExpect(verdictWhenNothingMatches('to.be.hidden')).toEqual({ matches: true });
  });

  test('a missing element is detached', () => {
    playwrightExpect(verdictWhenNothingMatches('to.be.detached')).toEqual({ matches: true });
  });

  test('a missing element is not visible, so toBeVisible keeps waiting', () => {
    playwrightExpect(verdictWhenNothingMatches('to.be.visible')).toEqual({ matches: false, missingReceived: true });
  });

  for (const expression of ['to.be.visible', 'to.be.attached', 'to.be.in.viewport']) {
    test(`not ${expression} passes on a missing element`, () => {
      playwrightExpect(verdictWhenNothingMatches(expression, { isNot: true })).toEqual({ matches: false });
    });
  }

  test('not.toBeHidden keeps waiting on a missing element', () => {
    playwrightExpect(verdictWhenNothingMatches('to.be.hidden', { isNot: true })).toEqual({ matches: true, missingReceived: true });
  });

  test('any other matcher reports the element as missing and does not pass', () => {
    playwrightExpect(verdictWhenNothingMatches('to.have.text')).toEqual({ matches: false, missingReceived: true });
    playwrightExpect(verdictWhenNothingMatches('to.have.text', { isNot: true })).toEqual({ matches: true, missingReceived: true });
  });
});
