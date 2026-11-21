import { test, expect } from './fixtures.js';

test('screenshot option defaults to only-on-failure so failed tests keep their screenshot', ({ screenshot }) => {
  expect(screenshot).toBe('only-on-failure');
});
