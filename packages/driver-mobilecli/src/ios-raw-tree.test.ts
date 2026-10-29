import { test, expect } from '@playwright/test';
import { rawIosTreeToViewNodes, type RawIosNode } from './ios-raw-tree.js';

const OTHER = 1;
const BUTTON = 9;
const STATIC_TEXT = 48;
const APPLICATION = 2;

const visibleFrame = { X: 40, Y: 220, Width: 169, Height: 44 };

test('keeps a labelled Other node that has no identifier', () => {
  const nodes = rawIosTreeToViewNodes({
    elementType: OTHER,
    label: 'Get started',
    identifier: '',
    frame: visibleFrame,
  });

  expect(nodes).toHaveLength(1);
  expect(nodes[0]).toMatchObject({
    type: 'Other',
    label: 'Get started',
    identifier: undefined,
    isVisible: true,
    bounds: { x: 40, y: 220, width: 169, height: 44 },
  });
});

test('drops an Other node with no label or identifier and hoists its children', () => {
  const tree: RawIosNode = {
    elementType: OTHER,
    label: '',
    identifier: '',
    frame: { X: 0, Y: 0, Width: 390, Height: 844 },
    children: [
      { elementType: STATIC_TEXT, label: 'Welcome', frame: { X: 10, Y: 10, Width: 100, Height: 20 } },
      { elementType: OTHER, label: 'Get started', frame: visibleFrame },
    ],
  };

  const nodes = rawIosTreeToViewNodes(tree);

  expect(nodes.map((n) => n.label)).toEqual(['Welcome', 'Get started']);
});

test('keeps a node that is partly off-screen to the left', () => {
  const nodes = rawIosTreeToViewNodes({
    elementType: OTHER,
    label: 'Edge',
    frame: { X: -5, Y: 100, Width: 50, Height: 30 },
  });

  expect(nodes).toHaveLength(1);
  expect(nodes[0].bounds).toEqual({ x: -5, y: 100, width: 50, height: 30 });
});

test('drops a zero-size node', () => {
  const nodes = rawIosTreeToViewNodes({
    elementType: OTHER,
    label: 'Hidden',
    frame: { X: 10, Y: 10, Width: 0, Height: 0 },
  });

  expect(nodes).toEqual([]);
});

test('drops a node that is entirely off-screen', () => {
  const nodes = rawIosTreeToViewNodes({
    elementType: OTHER,
    label: 'Gone',
    frame: { X: -100, Y: 10, Width: 50, Height: 30 },
  });

  expect(nodes).toEqual([]);
});

test('keeps an unlabelled Button but never the Application root', () => {
  const nodes = rawIosTreeToViewNodes({
    elementType: APPLICATION,
    label: 'My App',
    frame: { X: 0, Y: 0, Width: 390, Height: 844 },
    children: [{ elementType: BUTTON, frame: visibleFrame }],
  });

  expect(nodes).toHaveLength(1);
  expect(nodes[0].type).toBe('Button');
});

test('nests kept children under a kept parent', () => {
  const nodes = rawIosTreeToViewNodes({
    elementType: OTHER,
    identifier: 'card',
    frame: { X: 0, Y: 0, Width: 300, Height: 200 },
    children: [{ elementType: STATIC_TEXT, label: 'Title', frame: { X: 5, Y: 5, Width: 100, Height: 20 } }],
  });

  expect(nodes).toHaveLength(1);
  expect(nodes[0].children.map((c) => c.label)).toEqual(['Title']);
});
