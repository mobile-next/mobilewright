import { test, expect } from '@playwright/test';
import type { ViewNode } from '@mobilewright/protocol';
import { locatorForNode, locatorForStrategy } from './codegen.js';
import { buildStrategy } from './find-options.js';

function node(partial: Partial<ViewNode> & { type: string }): ViewNode {
  return { isVisible: true, isEnabled: true, bounds: { x: 0, y: 0, width: 1, height: 1 }, children: [], ...partial };
}

test('a test id wins over everything else', () => {
  expect(locatorForNode(node({ type: 'XCUIElementTypeButton', identifier: 'login', label: 'Log in' }))).toBe('screen.getByTestId(\'login\')');
});

test('an interactive role with a label becomes getByRole with a name', () => {
  expect(locatorForNode(node({ type: 'android.widget.Button', label: 'Log in' }))).toBe('screen.getByRole(\'button\', { name: \'Log in\' })');
});

test('static text falls back to label, then text, then placeholder, then raw type', () => {
  expect(locatorForNode(node({ type: 'XCUIElementTypeStaticText', label: 'Hi' }))).toBe('screen.getByLabel(\'Hi\')');
  expect(locatorForNode(node({ type: 'android.widget.TextView', text: 'Hi' }))).toBe('screen.getByText(\'Hi\')');
  expect(locatorForNode(node({ type: 'XCUIElementTypeTextField', placeholder: 'Email' }))).toBe('screen.getByPlaceholder(\'Email\')');
  expect(locatorForNode(node({ type: 'XCUIElementTypeCell' }))).toBe('screen.getByType(\'XCUIElementTypeCell\')');
});

test('quotes inside names are escaped', () => {
  expect(locatorForNode(node({ type: 'XCUIElementTypeStaticText', text: 'Don\'t' }))).toBe('screen.getByText(\'Don\\\'t\')');
});

test('line breaks and control characters inside names are escaped', () => {
  expect(locatorForNode(node({ type: 'android.widget.TextView', text: 'Line 1\nLine 2\r\tend' }))).toBe('screen.getByText(\'Line 1\\nLine 2\\r\\u0009end\')');
});

test('find flags render as the same chained locator a test would write', () => {
  expect(locatorForStrategy(buildStrategy({ role: 'button', name: 'Go' }))).toBe('screen.getByRole(\'button\', { name: \'Go\' })');
  expect(locatorForStrategy(buildStrategy({ text: '/sign in/i', exact: true }))).toBe('screen.getByText(/sign in/i, { exact: true })');
  expect(locatorForStrategy(buildStrategy({ role: 'listitem', hasText: 'Milk', last: true }))).toBe('screen.getByRole(\'listitem\').filter({ hasText: \'Milk\' }).last()');
  expect(locatorForStrategy(buildStrategy({ role: 'button', text: 'Go', nth: '2' }))).toBe('screen.getByText(\'Go\').and(screen.getByRole(\'button\')).nth(2)');
});
