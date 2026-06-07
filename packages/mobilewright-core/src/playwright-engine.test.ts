import { test, expect as playwrightExpect } from '@playwright/test';
import {
  bootstrapScript,
  detectBrowserName,
  getByRoleSelector,
  getByTextSelector,
  getByLabelSelector,
  getByPlaceholderSelector,
  getByAltTextSelector,
  getByTitleSelector,
  getByTestIdSelector,
  TEST_ID_ATTR,
  INJECTED_SOURCE,
} from './playwright-engine.js';

test.describe('playwright-engine adapter', () => {
  test('re-exports getByRoleSelector producing the exact Playwright role selector', () => {
    // If Playwright ever changes its selector format, this assertion breaks —
    // which is the point: our selectors must stay byte-identical to Playwright's.
    playwrightExpect(getByRoleSelector('button', { name: 'Sign in' }))
      .toBe('internal:role=button[name="Sign in"i]');
    playwrightExpect(getByRoleSelector('button', { name: 'Sign in', exact: true }))
      .toBe('internal:role=button[name="Sign in"s]');
    playwrightExpect(getByRoleSelector('button')).toBe('internal:role=button');
  });

  test('INJECTED_SOURCE is the non-trivial Playwright injected bundle', () => {
    playwrightExpect(INJECTED_SOURCE.length).toBeGreaterThan(100_000);
    playwrightExpect(INJECTED_SOURCE).toContain('InjectedScript');
  });

  test('re-exports the other selector builders with exact Playwright output', () => {
    playwrightExpect(getByTextSelector('Hello')).toBe('internal:text="Hello"i');
    playwrightExpect(getByTextSelector('Hello', { exact: true })).toBe('internal:text="Hello"s');
    playwrightExpect(getByLabelSelector('Email')).toBe('internal:label="Email"i');
    playwrightExpect(getByPlaceholderSelector('Search')).toBe('internal:attr=[placeholder="Search"i]');
    playwrightExpect(getByAltTextSelector('logo')).toBe('internal:attr=[alt="logo"i]');
    playwrightExpect(getByTitleSelector('Close')).toBe('internal:attr=[title="Close"i]');
    playwrightExpect(getByTestIdSelector(TEST_ID_ATTR, 'submit')).toBe('internal:testid=[data-testid="submit"s]');
  });

  test('detectBrowserName returns webkit for WKWebView UA and chromium for Chrome UA', () => {
    const wkUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
    const androidUA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36';
    playwrightExpect(detectBrowserName(wkUA)).toBe('webkit');
    playwrightExpect(detectBrowserName(androidUA)).toBe('chromium');
  });

  test('bootstrapScript inlines the browser detection and passes options', () => {
    const script = bootstrapScript();
    playwrightExpect(script).toContain('navigator.userAgent');
    playwrightExpect(script).toContain('"testIdAttributeName":"data-testid"');
    playwrightExpect(script).toContain('window.__mwInjected = new (module.exports.InjectedScript())(globalThis,');
  });

  test('bootstrapScript instantiates InjectedScript onto window.__mwInjected', () => {
    const script = bootstrapScript();
    playwrightExpect(script).toContain(INJECTED_SOURCE);
    playwrightExpect(script).toContain('window.__mwInjected = new (module.exports.InjectedScript())(globalThis,');
    playwrightExpect(script).toContain('"testIdAttributeName":"data-testid"');
  });
});
