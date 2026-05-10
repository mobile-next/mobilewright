import { test, expect as playwrightExpect } from '@playwright/test';
import type { WebViewSession } from '@mobilewright/protocol';
import { WebLocator } from './web-locator.js';
import { expect } from './expect.js';

// ─── Mock helpers ─────────────────────────────────────────────

function sessionReturning(...evaluateResponses: unknown[]): {
  session: WebViewSession;
  evaluateCalls: string[];
} {
  const evaluateCalls: string[] = [];
  let callIndex = 0;

  const session: WebViewSession = {
    evaluate: async (expr: string) => {
      evaluateCalls.push(expr);
      const idx = callIndex++;
      return (idx < evaluateResponses.length ? evaluateResponses[idx] : undefined) as any;
    },
    querySelectorAll: async () => [],
    click: async () => {},
    type: async () => {},
    getAttribute: async () => null,
    getText: async () => '',
    goto: async () => {},
    url: async () => 'https://example.com',
    title: async () => 'Example',
    reload: async () => {},
    waitForLoadState: async () => {},
    close: async () => {},
  };

  return { session, evaluateCalls };
}

// Returns a session where evaluate always returns the same value, no matter how many times called
function sessionAlwaysReturning(value: unknown) {
  const evaluateCalls: string[] = [];
  const session: WebViewSession = {
    evaluate: async (expr: string) => {
      evaluateCalls.push(expr);
      return value as any;
    },
    querySelectorAll: async () => [],
    click: async () => {}, type: async () => {}, getAttribute: async () => null,
    getText: async () => '', goto: async () => {}, url: async () => '',
    title: async () => '', reload: async () => {}, waitForLoadState: async () => {},
    close: async () => {},
  };
  return { session, evaluateCalls };
}

// ─── Strategy → JS generation ────────────────────────────────

test.describe('buildFindAll — strategy to JS', () => {
  test('css strategy generates querySelectorAll call', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, { kind: 'css', selector: '.my-btn' });
    await loc.count();
    playwrightExpect(evaluateCalls[0]).toContain('querySelectorAll(".my-btn")');
  });

  test('testId strategy generates data-testid attribute selector', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, { kind: 'testId', testId: 'submit' });
    await loc.count();
    playwrightExpect(evaluateCalls[0]).toContain('data-testid="submit"');
  });

  test('role strategy calls window.__mw.findByRole', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, { kind: 'role', role: 'button' });
    await loc.count();
    playwrightExpect(evaluateCalls[0]).toContain('window.__mw.findByRole');
    playwrightExpect(evaluateCalls[0]).toContain('"button"');
  });

  test('role strategy includes name when provided', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, { kind: 'role', role: 'button', name: 'Sign In' });
    await loc.count();
    playwrightExpect(evaluateCalls[0]).toContain('"Sign In"');
  });

  test('role strategy serialises RegExp name correctly', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, { kind: 'role', role: 'button', name: /sign/i });
    await loc.count();
    playwrightExpect(evaluateCalls[0]).toContain('/sign/i');
  });

  test('text strategy calls window.__mw.findByText', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, { kind: 'text', text: 'Hello' });
    await loc.count();
    playwrightExpect(evaluateCalls[0]).toContain('window.__mw.findByText');
    playwrightExpect(evaluateCalls[0]).toContain('"Hello"');
  });

  test('label strategy calls window.__mw.findByLabel', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, { kind: 'label', label: 'Email' });
    await loc.count();
    playwrightExpect(evaluateCalls[0]).toContain('window.__mw.findByLabel');
    playwrightExpect(evaluateCalls[0]).toContain('"Email"');
  });

  test('placeholder strategy calls window.__mw.findByAttr with placeholder', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, { kind: 'placeholder', text: 'Enter email' });
    await loc.count();
    playwrightExpect(evaluateCalls[0]).toContain("'placeholder'");
    playwrightExpect(evaluateCalls[0]).toContain('"Enter email"');
  });

  test('altText strategy calls window.__mw.findByAttr with alt', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, { kind: 'altText', text: 'logo' });
    await loc.count();
    playwrightExpect(evaluateCalls[0]).toContain("'alt'");
  });

  test('title strategy calls window.__mw.findByAttr with title', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, { kind: 'title', text: 'Close' });
    await loc.count();
    playwrightExpect(evaluateCalls[0]).toContain("'title'");
  });
});

// ─── Collection methods ───────────────────────────────────────

test.describe('WebLocator.count()', () => {
  test('returns 0 when evaluate returns 0', async () => {
    const { session } = sessionReturning(0);
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    playwrightExpect(await loc.count()).toBe(0);
  });

  test('returns the element count from evaluate', async () => {
    const { session } = sessionReturning(3);
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    playwrightExpect(await loc.count()).toBe(3);
  });
});

test.describe('WebLocator.all()', () => {
  test('returns an array of WebLocators matching the count', async () => {
    const { session } = sessionReturning(3);
    const loc = new WebLocator(session, { kind: 'css', selector: '.item' });
    const all = await loc.all();
    playwrightExpect(all).toHaveLength(3);
    playwrightExpect(all[0]).toBeInstanceOf(WebLocator);
  });

  test('returns empty array when count is 0', async () => {
    const { session } = sessionReturning(0);
    const loc = new WebLocator(session, { kind: 'css', selector: '.item' });
    playwrightExpect(await loc.all()).toHaveLength(0);
  });
});

test.describe('WebLocator.first() / last() / nth()', () => {
  test('first() returns a WebLocator with nth(0) strategy', async () => {
    const { session } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    const first = loc.first();
    playwrightExpect(first).toBeInstanceOf(WebLocator);
  });

  test('nth() builds correct JS to pick from the array', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    await loc.nth(2).count();
    playwrightExpect(evaluateCalls[0]).toContain('2');
  });
});

// ─── State queries ────────────────────────────────────────────

test.describe('WebLocator.isVisible()', () => {
  test('returns true when element is visible', async () => {
    const { session } = sessionReturning(true);
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    playwrightExpect(await loc.isVisible({ timeout: 0 })).toBe(true);
  });

  test('returns false when element is not found', async () => {
    const { session } = sessionReturning(false);
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    playwrightExpect(await loc.isVisible({ timeout: 0 })).toBe(false);
  });

  test('returns false without throwing when evaluate rejects', async () => {
    const session: WebViewSession = {
      evaluate: async () => { throw new Error('evaluate failed'); },
      querySelectorAll: async () => [],
      click: async () => {}, type: async () => {}, getAttribute: async () => null,
      getText: async () => '', goto: async () => {}, url: async () => '',
      title: async () => '', reload: async () => {}, waitForLoadState: async () => {},
      close: async () => {},
    };
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    playwrightExpect(await loc.isVisible({ timeout: 0 })).toBe(false);
  });
});

test.describe('WebLocator.isHidden()', () => {
  test('returns true when element is not visible', async () => {
    const { session } = sessionReturning(false);
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    playwrightExpect(await loc.isHidden({ timeout: 0 })).toBe(true);
  });
});

test.describe('WebLocator.isEnabled()', () => {
  test('returns true when element is enabled', async () => {
    const { session } = sessionReturning(true);
    const loc = new WebLocator(session, { kind: 'css', selector: 'input' });
    playwrightExpect(await loc.isEnabled({ timeout: 0 })).toBe(true);
  });

  test('returns false when element is disabled', async () => {
    const { session } = sessionReturning(false);
    const loc = new WebLocator(session, { kind: 'css', selector: 'input' });
    playwrightExpect(await loc.isEnabled({ timeout: 0 })).toBe(false);
  });
});

test.describe('WebLocator.isChecked()', () => {
  test('returns true when element is checked', async () => {
    const { session } = sessionReturning(true);
    const loc = new WebLocator(session, { kind: 'css', selector: 'input[type=checkbox]' });
    playwrightExpect(await loc.isChecked({ timeout: 0 })).toBe(true);
  });
});

// ─── Value queries ────────────────────────────────────────────

test.describe('WebLocator.textContent()', () => {
  test('returns text content after waiting for visibility', async () => {
    // First call: isVisible check → true; second: textContent expression
    const { session } = sessionReturning(true, 'Sign In');
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    playwrightExpect(await loc.textContent()).toBe('Sign In');
  });
});

test.describe('WebLocator.inputValue()', () => {
  test('returns the input value after waiting for visibility', async () => {
    const { session } = sessionReturning(true, 'john@example.com');
    const loc = new WebLocator(session, { kind: 'css', selector: 'input' });
    playwrightExpect(await loc.inputValue()).toBe('john@example.com');
  });
});

test.describe('WebLocator.getAttribute()', () => {
  test('returns the attribute value after waiting for visibility', async () => {
    const { session } = sessionReturning(true, 'primary');
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    playwrightExpect(await loc.getAttribute('class')).toBe('primary');
  });

  test('returns null when attribute is absent', async () => {
    const { session } = sessionReturning(true, null);
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    playwrightExpect(await loc.getAttribute('data-missing')).toBeNull();
  });
});

test.describe('WebLocator.getAttribute() — evaluate contains correct attribute name', () => {
  test('embeds the attribute name in the evaluate expression', async () => {
    const { session, evaluateCalls } = sessionReturning(true, 'value');
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    await loc.getAttribute('aria-label');
    playwrightExpect(evaluateCalls.some(c => c.includes('aria-label'))).toBe(true);
  });
});

// ─── waitFor ─────────────────────────────────────────────────

test.describe('WebLocator.waitFor()', () => {
  test('resolves immediately when element is already visible', async () => {
    const { session } = sessionAlwaysReturning(true);
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    await loc.waitFor({ state: 'visible', timeout: 1000 });
  });

  test('resolves when element becomes detached', async () => {
    // count: 0 → attached check fails (detached = true)
    const { session } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, { kind: 'css', selector: '.removed' });
    await loc.waitFor({ state: 'detached', timeout: 1000 });
  });

  test('rejects when element never becomes visible within timeout', async () => {
    const { session } = sessionAlwaysReturning(false);
    const loc = new WebLocator(session, { kind: 'css', selector: '.missing' });
    await playwrightExpect(
      loc.waitFor({ state: 'visible', timeout: 200 }),
    ).rejects.toThrow();
  });
});

// ─── Actions ─────────────────────────────────────────────────

test.describe('WebLocator.click()', () => {
  test('evaluates a click expression after waiting for visibility', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(true);
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    await loc.click();
    playwrightExpect(evaluateCalls.some(c => c.includes('.click()'))).toBe(true);
  });
});

test.describe('WebLocator.fill()', () => {
  test('evaluates a fill expression with the given text', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(true);
    const loc = new WebLocator(session, { kind: 'css', selector: 'input' });
    await loc.fill('hello@example.com');
    playwrightExpect(evaluateCalls.some(c => c.includes('hello@example.com'))).toBe(true);
  });
});

// ─── getText / getValue aliases ───────────────────────────────

test.describe('getText() and getValue() aliases', () => {
  test('getText() delegates to textContent()', async () => {
    const { session } = sessionReturning(true, 'Hello World');
    const loc = new WebLocator(session, { kind: 'css', selector: 'p' });
    playwrightExpect(await loc.getText()).toBe('Hello World');
  });

  test('getValue() delegates to inputValue()', async () => {
    const { session } = sessionReturning(true, 'myvalue');
    const loc = new WebLocator(session, { kind: 'css', selector: 'input' });
    playwrightExpect(await loc.getValue()).toBe('myvalue');
  });
});

// ─── expect(webLocator) assertions ───────────────────────────

test.describe('expect(webLocator).toBeVisible()', () => {
  test('passes when element is visible', async () => {
    const { session } = sessionAlwaysReturning(true);
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    await expect(loc).toBeVisible();
  });

  test('fails when element is not visible', async () => {
    const { session } = sessionAlwaysReturning(false);
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    await playwrightExpect(
      expect(loc).toBeVisible({ timeout: 200 }),
    ).rejects.toThrow();
  });

  test('not.toBeVisible passes when element is hidden', async () => {
    const { session } = sessionAlwaysReturning(false);
    const loc = new WebLocator(session, { kind: 'css', selector: '.hidden' });
    await expect(loc).not.toBeVisible();
  });
});

test.describe('expect(webLocator).toBeEnabled()', () => {
  test('passes when element is enabled', async () => {
    const { session } = sessionAlwaysReturning(true);
    const loc = new WebLocator(session, { kind: 'css', selector: 'input' });
    await expect(loc).toBeEnabled();
  });

  test('not.toBeEnabled passes when element is disabled', async () => {
    const { session } = sessionAlwaysReturning(false);
    const loc = new WebLocator(session, { kind: 'css', selector: 'input' });
    await expect(loc).not.toBeEnabled();
  });
});

test.describe('expect(webLocator).toBeChecked()', () => {
  test('passes when element is checked', async () => {
    const { session } = sessionAlwaysReturning(true);
    const loc = new WebLocator(session, { kind: 'css', selector: 'input[type=checkbox]' });
    await expect(loc).toBeChecked();
  });
});

test.describe('expect(webLocator).toHaveText()', () => {
  test('passes when text matches exactly', async () => {
    const { session } = sessionReturning(true, 'Sign In');
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    await expect(loc).toHaveText('Sign In');
  });

  test('passes when text matches a regex', async () => {
    const { session } = sessionReturning(true, 'Sign In Now');
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    await expect(loc).toHaveText(/Sign In/);
  });

  test('fails when text does not match', async () => {
    const { session } = sessionAlwaysReturning('Cancel');
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    await playwrightExpect(
      expect(loc).toHaveText('Sign In', { timeout: 200 }),
    ).rejects.toThrow();
  });
});

test.describe('expect(webLocator).toContainText()', () => {
  test('passes when text contains the substring', async () => {
    const { session } = sessionReturning(true, 'Welcome to the dashboard');
    const loc = new WebLocator(session, { kind: 'css', selector: 'h1' });
    await expect(loc).toContainText('dashboard');
  });
});

test.describe('expect(webLocator).toHaveValue()', () => {
  test('passes when input value matches', async () => {
    const { session } = sessionReturning(true, 'john@example.com');
    const loc = new WebLocator(session, { kind: 'css', selector: 'input' });
    await expect(loc).toHaveValue('john@example.com');
  });
});

test.describe('expect(webLocator).toHaveAttribute()', () => {
  test('passes when attribute value matches', async () => {
    // isVisible → true, getAttribute → 'primary'
    const { session } = sessionReturning(true, 'primary');
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    await expect(loc).toHaveAttribute('data-variant', 'primary');
  });

  test('passes when attribute matches a regex', async () => {
    const { session } = sessionReturning(true, 'btn-primary');
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    await expect(loc).toHaveAttribute('class', /primary/);
  });

  test('fails when attribute is absent', async () => {
    const { session } = sessionAlwaysReturning(null);
    const loc = new WebLocator(session, { kind: 'css', selector: '.btn' });
    await playwrightExpect(
      expect(loc).toHaveAttribute('data-missing', 'value', { timeout: 200 }),
    ).rejects.toThrow();
  });
});

test.describe('expect(webLocator).toHaveCount()', () => {
  test('passes when count matches', async () => {
    const { session } = sessionAlwaysReturning(3);
    const loc = new WebLocator(session, { kind: 'css', selector: '.item' });
    await expect(loc).toHaveCount(3);
  });

  test('fails when count does not match', async () => {
    const { session } = sessionAlwaysReturning(1);
    const loc = new WebLocator(session, { kind: 'css', selector: '.item' });
    await playwrightExpect(
      expect(loc).toHaveCount(5, { timeout: 200 }),
    ).rejects.toThrow();
  });

  test('not.toHaveCount passes when count differs', async () => {
    const { session } = sessionAlwaysReturning(2);
    const loc = new WebLocator(session, { kind: 'css', selector: '.item' });
    await expect(loc).not.toHaveCount(5);
  });
});
