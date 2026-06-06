import { test, expect as playwrightExpect } from '@playwright/test';
import type { WebViewSession } from '@mobilewright/protocol';
import type { StepFn } from './locator.js';
import { WebLocator } from './web-locator.js';
import { expect } from './expect.js';
import { fakeWebViewSession } from './fake-webview-session.js';

// Fake session whose evaluate() always returns the given injected-expect verdict.
function sessionMatching(verdict: { matches: boolean; received?: unknown; missingReceived?: boolean }) {
  return fakeWebViewSession({ evaluateAlways: verdict, url: '', title: '' });
}

function webLocator(session: WebViewSession): WebLocator {
  return new WebLocator(session, '.btn');
}

test.describe('web assertions route through the injected expect()', () => {
  test('toBeVisible passes when the injected matcher matches', async () => {
    const { session } = sessionMatching({ matches: true });
    await expect(webLocator(session)).toBeVisible();
  });

  test('toBeVisible rejects when the injected matcher does not match', async () => {
    const { session } = sessionMatching({ matches: false, received: 'hidden' });
    await playwrightExpect(expect(webLocator(session)).toBeVisible({ timeout: 200 })).rejects.toThrow();
  });

  test('not.toBeVisible passes when the matcher does not match', async () => {
    const { session } = sessionMatching({ matches: false });
    await expect(webLocator(session)).not.toBeVisible();
  });

  test('emits the exact Playwright expression for toHaveText', async () => {
    const { session, evaluateCalls } = sessionMatching({ matches: true });
    await expect(webLocator(session)).toHaveText('Hi');
    playwrightExpect(evaluateCalls[0]).toContain('is.expect(elements[0],');
    playwrightExpect(evaluateCalls[0]).toContain('"expression":"to.have.text"');
    playwrightExpect(evaluateCalls[0]).toContain('"string":"Hi"');
    playwrightExpect(evaluateCalls[0]).toContain('"normalizeWhiteSpace":true');
  });

  test('toContainText uses to.have.text with matchSubstring', async () => {
    const { session, evaluateCalls } = sessionMatching({ matches: true });
    await expect(webLocator(session)).toContainText('dash');
    playwrightExpect(evaluateCalls[0]).toContain('"expression":"to.have.text"');
    playwrightExpect(evaluateCalls[0]).toContain('"matchSubstring":true');
  });

  test('toHaveCount uses expectedNumber', async () => {
    const { session, evaluateCalls } = sessionMatching({ matches: true });
    await expect(webLocator(session)).toHaveCount(3);
    playwrightExpect(evaluateCalls[0]).toContain('"expression":"to.have.count"');
    playwrightExpect(evaluateCalls[0]).toContain('"expectedNumber":3');
  });

  test('toHaveAttribute carries the attribute name in expressionArg', async () => {
    const { session, evaluateCalls } = sessionMatching({ matches: true });
    await expect(webLocator(session)).toHaveAttribute('data-variant', 'primary');
    playwrightExpect(evaluateCalls[0]).toContain('"expression":"to.have.attribute.value"');
    playwrightExpect(evaluateCalls[0]).toContain('"expressionArg":"data-variant"');
    playwrightExpect(evaluateCalls[0]).toContain('"string":"primary"');
  });

  test('toBeChecked passes expectedValue', async () => {
    const { session, evaluateCalls } = sessionMatching({ matches: true });
    await expect(webLocator(session)).toBeChecked();
    playwrightExpect(evaluateCalls[0]).toContain('"expression":"to.be.checked"');
    playwrightExpect(evaluateCalls[0]).toContain('"checked":true');
  });

  test('new matchers map to their injected expressions', async () => {
    const { session, evaluateCalls } = sessionMatching({ matches: true });
    const loc = webLocator(session);
    await expect(loc).toHaveClass('active');
    await expect(loc).toContainClass('act');
    await expect(loc).toHaveCSS('color', 'red');
    await expect(loc).toHaveId('main');
    await expect(loc).toBeFocused();
    await expect(loc).toBeEditable();
    await expect(loc).toBeAttached();
    await expect(loc).toBeInViewport();
    await expect(loc).toHaveJSProperty('checked', true);
    const joined = evaluateCalls.join('\n');
    playwrightExpect(joined).toContain('"to.have.class"');
    playwrightExpect(joined).toContain('"to.contain.class"');
    playwrightExpect(joined).toContain('"to.have.css"');
    playwrightExpect(joined).toContain('"expressionArg":"color"');
    playwrightExpect(joined).toContain('"to.have.id"');
    playwrightExpect(joined).toContain('"to.be.focused"');
    playwrightExpect(joined).toContain('"to.be.editable"');
    playwrightExpect(joined).toContain('"to.be.attached"');
    playwrightExpect(joined).toContain('"to.be.in.viewport"');
    playwrightExpect(joined).toContain('"to.have.property"');
    playwrightExpect(joined).toContain('"expressionArg":"checked"');
  });

  test('assertions emit expect steps', async () => {
    const titles: string[] = [];
    const stepFn: StepFn = (title, body) => { titles.push(title); return body(); };
    const { session } = sessionMatching({ matches: true });
    const loc = webLocator(session);
    loc._stepFn = stepFn;
    await expect(loc).toBeVisible();
    playwrightExpect(titles).toContain('expect.toBeVisible()');
  });
});
