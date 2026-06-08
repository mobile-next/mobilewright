import { test, expect as playwrightExpect } from '@playwright/test';
import type { WebViewSession } from '@mobilewright/protocol';
import type { StepFn } from './locator.js';
import { WebLocator } from './web-locator.js';
import { Page } from './page.js';
import {
  getByRoleSelector,
  getByLabelSelector,
  getByPlaceholderSelector,
  getByAltTextSelector,
  getByTitleSelector,
  getByTestIdSelector,
  getByTextSelector,
  TEST_ID_ATTR,
} from './playwright-engine.js';
import { fakeWebViewSession } from './fake-webview-session.js';

// A step function that records the title of every step it wraps, then runs the body.
function recordingStepFn(): { stepFn: StepFn; titles: string[] } {
  const titles: string[] = [];
  const stepFn: StepFn = (title, body) => {
    titles.push(title);
    return body();
  };
  return { stepFn, titles };
}

// ─── Mock helpers ─────────────────────────────────────────────

// A session whose evaluate() returns the given values in call order.
function sessionReturning(...evaluateResponses: unknown[]) {
  return fakeWebViewSession({ evaluateResponses });
}

// A session whose evaluate() always returns the same value, no matter how many times called.
function sessionAlwaysReturning(value: unknown) {
  return fakeWebViewSession({ evaluateAlways: value, url: '', title: '' });
}

// ─── Selector resolution via the injected engine ─────────────

test.describe('selector resolution via the injected engine', () => {
  test('count() resolves the selector through window.__mwInjected.querySelectorAll', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, '.my-btn');
    await loc.count();
    playwrightExpect(evaluateCalls[0]).toContain('window.__mwInjected.querySelectorAll');
    playwrightExpect(evaluateCalls[0]).toContain('parseSelector(".my-btn")');
  });

  test('getByRole builds the exact Playwright role selector', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, getByRoleSelector('button', { name: 'Sign In' }));
    await loc.count();
    playwrightExpect(evaluateCalls[0]).toContain(`parseSelector(${JSON.stringify(getByRoleSelector('button', { name: 'Sign In' }))})`);
  });

  test('getByTestId builds the exact Playwright testid selector', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, getByTestIdSelector(TEST_ID_ATTR, 'submit'));
    await loc.count();
    playwrightExpect(evaluateCalls[0]).toContain(`parseSelector(${JSON.stringify(getByTestIdSelector(TEST_ID_ATTR, 'submit'))})`);
  });
});

// ─── Collection methods ───────────────────────────────────────

test.describe('WebLocator.count()', () => {
  test('returns 0 when evaluate returns 0', async () => {
    const { session } = sessionReturning(0);
    const loc = new WebLocator(session, '.btn');
    playwrightExpect(await loc.count()).toBe(0);
  });

  test('returns the element count from evaluate', async () => {
    const { session } = sessionReturning(3);
    const loc = new WebLocator(session, '.btn');
    playwrightExpect(await loc.count()).toBe(3);
  });
});

test.describe('WebLocator.all()', () => {
  test('returns an array of WebLocators matching the count', async () => {
    const { session } = sessionReturning(3);
    const loc = new WebLocator(session, '.item');
    const all = await loc.all();
    playwrightExpect(all).toHaveLength(3);
    playwrightExpect(all[0] instanceof WebLocator).toBe(true);
  });

  test('returns empty array when count is 0', async () => {
    const { session } = sessionReturning(0);
    const loc = new WebLocator(session, '.item');
    playwrightExpect(await loc.all()).toHaveLength(0);
  });
});

test.describe('WebLocator.first() / last() / nth()', () => {
  test('first() returns a WebLocator', async () => {
    const { session } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, '.btn');
    const first = loc.first();
    playwrightExpect(first instanceof WebLocator).toBe(true);
  });

  test('nth() composes an nth=index selector', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, '.btn');
    await loc.nth(2).count();
    playwrightExpect(evaluateCalls[0]).toContain('parseSelector(".btn >> nth=2")');
  });
});

// ─── Chaining getters ─────────────────────────────────────────

test.describe('WebLocator chaining getters', () => {
  test('getByLabel composes a label selector within the parent', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, '.form');
    await loc.getByLabel('Email').count();
    playwrightExpect(evaluateCalls[0]).toContain(`parseSelector(${JSON.stringify('.form >> ' + getByLabelSelector('Email'))})`);
  });

  test('getByPlaceholder composes a placeholder selector within the parent', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, '.form');
    await loc.getByPlaceholder('Enter email').count();
    playwrightExpect(evaluateCalls[0]).toContain(`parseSelector(${JSON.stringify('.form >> ' + getByPlaceholderSelector('Enter email'))})`);
  });

  test('getByTestId composes a testid selector within the parent', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, '.form');
    await loc.getByTestId('submit').count();
    playwrightExpect(evaluateCalls[0]).toContain(`parseSelector(${JSON.stringify('.form >> ' + getByTestIdSelector(TEST_ID_ATTR, 'submit'))})`);
  });

  test('getByAltText composes an alt selector within the parent', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, '.gallery');
    await loc.getByAltText('logo').count();
    playwrightExpect(evaluateCalls[0]).toContain(`parseSelector(${JSON.stringify('.gallery >> ' + getByAltTextSelector('logo'))})`);
  });

  test('getByTitle composes a title selector within the parent', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, '.toolbar');
    await loc.getByTitle('Close').count();
    playwrightExpect(evaluateCalls[0]).toContain(`parseSelector(${JSON.stringify('.toolbar >> ' + getByTitleSelector('Close'))})`);
  });

  test('last() composes an nth=-1 selector', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, '.btn');
    await loc.last().count();
    playwrightExpect(evaluateCalls[0]).toContain('parseSelector(".btn >> nth=-1")');
  });
});

// ─── State queries ────────────────────────────────────────────

test.describe('WebLocator.isVisible()', () => {
  test('returns true when element is visible', async () => {
    const { session } = sessionReturning(true);
    const loc = new WebLocator(session, '.btn');
    playwrightExpect(await loc.isVisible({ timeout: 0 })).toBe(true);
  });

  test('returns false when element is not found', async () => {
    const { session } = sessionReturning(false);
    const loc = new WebLocator(session, '.btn');
    playwrightExpect(await loc.isVisible({ timeout: 0 })).toBe(false);
  });

  test('returns false without throwing when evaluate rejects', async () => {
    const session: WebViewSession = {
      evaluate: async () => { throw new Error('evaluate failed'); },
      goto: async () => {}, url: async () => '',
      goBack: async () => {}, goForward: async () => {},
      title: async () => '', reload: async () => {}, waitForLoadState: async () => {},
      close: async () => {},
    };
    const loc = new WebLocator(session, '.btn');
    playwrightExpect(await loc.isVisible({ timeout: 0 })).toBe(false);
  });

  test('returns true when element is visible while polling with a non-zero timeout', async () => {
    const { session } = sessionAlwaysReturning(true);
    const loc = new WebLocator(session, '.btn');
    playwrightExpect(await loc.isVisible({ timeout: 200 })).toBe(true);
  });

  test('returns false when the element stays invisible until the polling timeout elapses', async () => {
    const { session } = sessionAlwaysReturning(false);
    const loc = new WebLocator(session, '.btn');
    playwrightExpect(await loc.isVisible({ timeout: 200 })).toBe(false);
  });
});

test.describe('WebLocator.isHidden()', () => {
  test('returns true when element is not visible', async () => {
    const { session } = sessionReturning(false);
    const loc = new WebLocator(session, '.btn');
    playwrightExpect(await loc.isHidden({ timeout: 0 })).toBe(true);
  });
});

test.describe('WebLocator.isEnabled()', () => {
  test('returns true when element is enabled', async () => {
    const { session } = sessionReturning(true);
    const loc = new WebLocator(session, 'input');
    playwrightExpect(await loc.isEnabled({ timeout: 0 })).toBe(true);
  });

  test('returns false when element is disabled', async () => {
    const { session } = sessionReturning(false);
    const loc = new WebLocator(session, 'input');
    playwrightExpect(await loc.isEnabled({ timeout: 0 })).toBe(false);
  });
});

test.describe('WebLocator.isChecked()', () => {
  test('returns true when element is checked', async () => {
    const { session } = sessionReturning(true);
    const loc = new WebLocator(session, 'input[type=checkbox]');
    playwrightExpect(await loc.isChecked({ timeout: 0 })).toBe(true);
  });
});

test.describe('WebLocator.isDisabled()', () => {
  test('returns true when the element is not enabled', async () => {
    const { session } = sessionReturning(false);
    const loc = new WebLocator(session, 'input');
    playwrightExpect(await loc.isDisabled({ timeout: 0 })).toBe(true);
  });

  test('returns false when the element is enabled', async () => {
    const { session } = sessionReturning(true);
    const loc = new WebLocator(session, 'input');
    playwrightExpect(await loc.isDisabled({ timeout: 0 })).toBe(false);
  });
});

// ─── State-query missing-element semantics ───────────────────
// Matches Playwright: isVisible → false on missing; isEnabled/isChecked throw.

test.describe('state-query missing-element semantics', () => {
  test('isVisible returns false when the element is absent', async () => {
    const { session } = sessionReturning(false);
    const loc = new WebLocator(session, '.gone');
    playwrightExpect(await loc.isVisible({ timeout: 0 })).toBe(false);
  });

  test('isEnabled rejects with "element not found" when the element is absent', async () => {
    // null = injected querySelector found nothing.
    const { session } = sessionReturning(null);
    const loc = new WebLocator(session, '.gone');
    await playwrightExpect(loc.isEnabled({ timeout: 0 })).rejects.toThrow(/element not found/);
  });

  test('isChecked rejects with "element not found" when the element is absent', async () => {
    const { session } = sessionReturning(null);
    const loc = new WebLocator(session, '.gone');
    await playwrightExpect(loc.isChecked({ timeout: 0 })).rejects.toThrow(/element not found/);
  });
});

// ─── Value queries ────────────────────────────────────────────

test.describe('WebLocator.textContent()', () => {
  test('returns text content after waiting for visibility', async () => {
    // First call: isVisible check → true; second: textContent expression
    const { session } = sessionReturning(true, 'Sign In');
    const loc = new WebLocator(session, '.btn');
    playwrightExpect(await loc.textContent()).toBe('Sign In');
  });
});

test.describe('WebLocator.innerText()', () => {
  test('returns the rendered inner text after waiting for visibility', async () => {
    const { session } = sessionReturning(true, 'Sign In');
    const loc = new WebLocator(session, '.btn');
    playwrightExpect(await loc.innerText()).toBe('Sign In');
  });
});

test.describe('WebLocator.innerHTML()', () => {
  test('returns the inner HTML after waiting for visibility', async () => {
    const { session } = sessionReturning(true, '<span>Sign In</span>');
    const loc = new WebLocator(session, '.btn');
    playwrightExpect(await loc.innerHTML()).toBe('<span>Sign In</span>');
  });
});

test.describe('WebLocator.inputValue()', () => {
  test('returns the input value after waiting for visibility', async () => {
    const { session } = sessionReturning(true, 'john@example.com');
    const loc = new WebLocator(session, 'input');
    playwrightExpect(await loc.inputValue()).toBe('john@example.com');
  });
});

test.describe('WebLocator.boundingBox()', () => {
  test('returns a Bounds object with x, y, width, and height', async () => {
    // isVisible → true, then the getBoundingClientRect expression → a rect.
    const { session } = sessionReturning(true, { x: 10, y: 20, width: 100, height: 40 });
    const loc = new WebLocator(session, '.btn');
    const box = await loc.boundingBox();
    // The Bounds contract clients depend on: all four numeric fields present.
    playwrightExpect(box).toEqual({ x: 10, y: 20, width: 100, height: 40 });
  });

  test('returns null when the element is absent', async () => {
    const { session } = sessionReturning(true, null);
    const loc = new WebLocator(session, '.missing');
    playwrightExpect(await loc.boundingBox()).toBeNull();
  });
});

test.describe('WebLocator.getAttribute()', () => {
  test('returns the attribute value after waiting for visibility', async () => {
    const { session } = sessionReturning(true, 'primary');
    const loc = new WebLocator(session, '.btn');
    playwrightExpect(await loc.getAttribute('class')).toBe('primary');
  });

  test('returns null when attribute is absent', async () => {
    const { session } = sessionReturning(true, null);
    const loc = new WebLocator(session, '.btn');
    playwrightExpect(await loc.getAttribute('data-missing')).toBeNull();
  });
});

test.describe('WebLocator.getAttribute() — evaluate contains correct attribute name', () => {
  test('embeds the attribute name in the evaluate expression', async () => {
    const { session, evaluateCalls } = sessionReturning(true, 'value');
    const loc = new WebLocator(session, '.btn');
    await loc.getAttribute('aria-label');
    playwrightExpect(evaluateCalls.some(c => c.includes('aria-label'))).toBe(true);
  });
});

// ─── waitFor ─────────────────────────────────────────────────

test.describe('WebLocator.waitFor()', () => {
  test('resolves immediately when element is already visible', async () => {
    const { session } = sessionAlwaysReturning(true);
    const loc = new WebLocator(session, '.btn');
    await loc.waitFor({ state: 'visible', timeout: 1000 });
  });

  test('resolves when element becomes detached', async () => {
    // count: 0 → attached check fails (detached = true)
    const { session } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, '.removed');
    await loc.waitFor({ state: 'detached', timeout: 1000 });
  });

  test('rejects when element never becomes visible within timeout', async () => {
    const { session } = sessionAlwaysReturning(false);
    const loc = new WebLocator(session, '.missing');
    await playwrightExpect(
      loc.waitFor({ state: 'visible', timeout: 200 }),
    ).rejects.toThrow();
  });
});

// ─── Actions ─────────────────────────────────────────────────

test.describe('WebLocator.click()', () => {
  test('evaluates a click expression after waiting for visibility', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(true);
    const loc = new WebLocator(session, '.btn');
    await loc.click();
    playwrightExpect(evaluateCalls.some(c => c.includes('.click()'))).toBe(true);
  });

  test('asserts the element exists, throwing in-page rather than silently no-op', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(true);
    const loc = new WebLocator(session, '.btn');
    await loc.click();
    const js = evaluateCalls.find(c => c.includes('.click()')) ?? '';
    playwrightExpect(js).toContain('throw new Error');
    playwrightExpect(js).toContain('element not found');
  });
});

test.describe('WebLocator.fill()', () => {
  test('evaluates a fill expression with the given text', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(true);
    const loc = new WebLocator(session, 'input');
    await loc.fill('hello@example.com');
    playwrightExpect(evaluateCalls.some(c => c.includes('hello@example.com'))).toBe(true);
  });
});

test.describe('getByRole().click() via the injected engine', () => {
  test('resolves and clicks through window.__mwInjected using the exact Playwright selector', async () => {
    // Every evaluate resolves true: the actionability poll passes on the first
    // read, so click() proceeds to dispatch.
    const { session, evaluateCalls } = sessionAlwaysReturning(true);
    const page = await Page.attach(session);

    await page.getByRole('button', { name: 'Sign in' }).click();

    const expectedSelector = getByRoleSelector('button', { name: 'Sign in' });
    const usesInjectedSelector = evaluateCalls.some((c) =>
      c.includes('window.__mwInjected') &&
      c.includes(`parseSelector(${JSON.stringify(expectedSelector)})`),
    );
    const dispatchesClick = evaluateCalls.some((c) => c.includes('el.click()'));
    playwrightExpect(usesInjectedSelector).toBe(true);
    playwrightExpect(dispatchesClick).toBe(true);
  });
});

test.describe('WebLocator.hover()', () => {
  test('waits for the element to be visible before dispatching the hover events', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(true);
    const loc = new WebLocator(session, '.btn');
    await loc.hover();
    // Like click/fill/type, hover must first run the injected visibility check
    // before acting — otherwise it acts on a stale match.
    const visibilityCheckIndex = evaluateCalls.findIndex(c => c.includes('elementState(el,'));
    const hoverIndex = evaluateCalls.findIndex(c => c.includes('mouseover'));
    playwrightExpect(visibilityCheckIndex).toBeGreaterThanOrEqual(0);
    playwrightExpect(hoverIndex).toBeGreaterThan(visibilityCheckIndex);
  });
});

// ─── getText / getValue aliases ───────────────────────────────

test.describe('getText() and getValue() aliases', () => {
  test('getText() delegates to textContent()', async () => {
    const { session } = sessionReturning(true, 'Hello World');
    const loc = new WebLocator(session, 'p');
    playwrightExpect(await loc.getText()).toBe('Hello World');
  });

  test('getValue() delegates to inputValue()', async () => {
    const { session } = sessionReturning(true, 'myvalue');
    const loc = new WebLocator(session, 'input');
    playwrightExpect(await loc.getValue()).toBe('myvalue');
  });
});

// ─── Step instrumentation ────────────────────────────────────

test.describe('WebLocator step instrumentation', () => {
  test('actions emit a named step matching the method call', async () => {
    const { session } = sessionAlwaysReturning(true);
    const { stepFn, titles } = recordingStepFn();
    const loc = new WebLocator(session, '.btn');
    loc._stepFn = stepFn;

    await loc.click();
    await loc.fill('hello');
    await loc.type('world');
    await loc.press('Enter');
    await loc.focus();
    await loc.hover();
    await loc.scrollIntoViewIfNeeded();

    playwrightExpect(titles).toEqual([
      'locator.click()',
      'locator.fill("hello")',
      'locator.type("world")',
      'locator.press("Enter")',
      'locator.focus()',
      'locator.hover()',
      'locator.scrollIntoViewIfNeeded()',
    ]);
  });

  test('chaining composes the child selector within the parent', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(0);
    const loc = new WebLocator(session, '.form');
    await loc.getByText('Submit').count();
    // The child query is scoped to the parent via Playwright's `>>` combinator.
    playwrightExpect(evaluateCalls[0]).toContain(`parseSelector(${JSON.stringify('.form >> ' + getByTextSelector('Submit'))})`);
  });

  test('chaining propagates the step function to descendants', async () => {
    const { session } = sessionAlwaysReturning(true);
    const { stepFn } = recordingStepFn();
    const loc = new WebLocator(session, '.form');
    loc._stepFn = stepFn;

    playwrightExpect(loc.locator('.field')._stepFn).toBe(stepFn);
    playwrightExpect(loc.getByRole('button')._stepFn).toBe(stepFn);
    playwrightExpect(loc.nth(2)._stepFn).toBe(stepFn);
    playwrightExpect(loc.first()._stepFn).toBe(stepFn);
  });

  test('actions run normally when no step function is set', async () => {
    const { session, evaluateCalls } = sessionAlwaysReturning(true);
    const loc = new WebLocator(session, '.btn');
    await loc.click();
    playwrightExpect(evaluateCalls.some(c => c.includes('.click()'))).toBe(true);
  });

  test('value queries are NOT wrapped as steps', async () => {
    const { session } = sessionReturning(true, 'Sign In');
    const { stepFn, titles } = recordingStepFn();
    const loc = new WebLocator(session, '.btn');
    loc._stepFn = stepFn;
    await loc.textContent();
    playwrightExpect(titles).toEqual([]);
  });
});
