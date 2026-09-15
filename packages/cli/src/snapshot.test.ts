import { test, expect } from '@playwright/test';
import type { ViewNode } from '@mobilewright/protocol';
import { renderSnapshot, formatSnapshot, lineFor } from './snapshot.js';

function node(partial: Partial<ViewNode> & { type: string }): ViewNode {
  return { isVisible: true, isEnabled: true, bounds: { x: 0, y: 0, width: 10, height: 10 }, children: [], ...partial };
}

const loginScreen: ViewNode[] = [
  node({
    type: 'XCUIElementTypeOther',
    children: [
      node({ type: 'XCUIElementTypeStaticText', label: 'Welcome' }),
      node({ type: 'XCUIElementTypeTextField', placeholder: 'Email', identifier: 'email', bounds: { x: 10, y: 20, width: 100, height: 40 } }),
      node({ type: 'XCUIElementTypeButton', label: 'Sign in', isEnabled: false }),
      node({ type: 'XCUIElementTypeOther', children: [node({ type: 'android.widget.Switch', label: 'Remember me', isChecked: true })] }),
    ],
  }),
];

test('refs are numbered in document order over every node, printed or not', () => {
  const { refs } = renderSnapshot(loginScreen);
  expect(Object.keys(refs)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
  expect(refs['e3']).toEqual({ x: 10, y: 20, width: 100, height: 40 });
});

test('bare containers are skipped and their children are not indented further', () => {
  const { lines } = renderSnapshot(loginScreen);
  expect(formatSnapshot(lines)).toBe([
    '- text "Welcome" [ref=e2]',
    '- textfield [ref=e3] [testid="email"] [placeholder="Email"]',
    '- button "Sign in" [ref=e4] [disabled]',
    '- switch "Remember me" [ref=e6] [checked]',
  ].join('\n'));
});

test('children of a printed node are indented under it', () => {
  const tree = [node({ type: 'XCUIElementTypeCell', label: 'Row', children: [node({ type: 'XCUIElementTypeStaticText', text: 'Detail' })] })];
  expect(formatSnapshot(renderSnapshot(tree).lines)).toBe('- listitem "Row" [ref=e1]\n  - text "Detail" [ref=e2]');
});

test('node identity maps back to its ref so find can reuse snapshot refs', () => {
  const { nodes } = renderSnapshot(loginScreen);
  expect(nodes.get(loginScreen[0].children[2])).toBe('e4');
});

test('lineFor renders a bare container that the snapshot itself would skip', () => {
  const { lines } = renderSnapshot(loginScreen);
  expect(lines.map((l) => l.ref)).not.toContain('e1');
  expect(formatSnapshot([lineFor(loginScreen[0], 'e1')])).toBe('- listitem [ref=e1]');
});
