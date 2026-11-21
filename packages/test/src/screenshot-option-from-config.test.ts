import { test, expect } from './fixtures.js';

// runs only in the 'screenshot-from-config' project, which sets use: { screenshot: 'on' }
test('screenshot option set in the config overrides the only-on-failure default', ({ screenshot }) => {
  expect(screenshot).toBe('on');
});
