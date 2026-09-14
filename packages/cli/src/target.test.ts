import { test, expect } from '@playwright/test';
import { parseTarget, centerOfTarget } from './target.js';

const refs = { e5: { x: 10, y: 20, width: 100, height: 40 } };

test('a ref resolves to the center of its remembered bounds', () => {
  expect(centerOfTarget(parseTarget('e5'), refs)).toEqual({ x: 60, y: 40 });
});

test('coordinates are used as-is', () => {
  expect(centerOfTarget(parseTarget('100,200.5'), refs)).toEqual({ x: 100, y: 200.5 });
});

test('an unknown ref tells the agent to snapshot first', () => {
  expect(() => centerOfTarget(parseTarget('e9'), refs)).toThrow('run "snapshot" or "find" first');
});

test('anything else is rejected', () => {
  expect(() => parseTarget('button')).toThrow('expected a ref like e12');
});
