import { test, expect } from '@playwright/test';
import { gestureSequenceToTapActions } from './gesture.js';

test('a single-finger swipe becomes move, down, timed moves, up', () => {
  const actions = gestureSequenceToTapActions({
    pointers: [[
      { x: 200, y: 1600, time: 0 },
      { x: 200, y: 1000, time: 150 },
      { x: 200, y: 400, time: 300 },
    ]],
  });

  expect(actions).toEqual([
    { type: 'pointerMove', x: 200, y: 1600, duration: 0 },
    { type: 'pointerDown' },
    { type: 'pointerMove', x: 200, y: 1000, duration: 150 },
    { type: 'pointerMove', x: 200, y: 400, duration: 150 },
    { type: 'pointerUp' },
  ]);
});

test('a single point becomes a tap', () => {
  const actions = gestureSequenceToTapActions({ pointers: [[{ x: 10, y: 20 }]] });
  expect(actions).toEqual([
    { type: 'pointerMove', x: 10, y: 20, duration: 0 },
    { type: 'pointerDown' },
    { type: 'pointerUp' },
  ]);
});

test('points without time produce zero-duration moves', () => {
  const actions = gestureSequenceToTapActions({ pointers: [[{ x: 0, y: 0 }, { x: 5, y: 5 }]] });
  expect(actions[2]).toEqual({ type: 'pointerMove', x: 5, y: 5, duration: 0 });
});

test('multi-touch is rejected with a clear error', () => {
  expect(() => gestureSequenceToTapActions({ pointers: [[{ x: 0, y: 0 }], [{ x: 1, y: 1 }]] }))
    .toThrow('multi-touch gestures are not supported');
});

test('an empty sequence is rejected', () => {
  expect(() => gestureSequenceToTapActions({ pointers: [] })).toThrow('at least one pointer');
});
