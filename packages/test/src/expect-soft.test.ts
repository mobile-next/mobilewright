import { test, expect } from './fixtures.js';

// A soft failure marks the test failed, so each test undoes that once it has
// inspected what the runner recorded.
function takeRecordedErrors(): { message?: string }[] {
  const info = test.info();
  const errors = [...info.errors];
  info.errors.length = 0;
  info.status = 'passed';
  return errors;
}

test.describe('expect.soft with the Playwright runner', () => {
  test('records the failure on the test and keeps running', async () => {
    expect.soft(1).toBe(2);
    const reachedNextLine = true;

    const errors = takeRecordedErrors();
    expect(reachedNextLine).toBe(true);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Expected 2, but received 1');
  });

  test('collects every soft failure, not just the first', async () => {
    expect.soft(1).toBe(2);
    expect.soft('a', 'letters must match').toBe('b');

    const errors = takeRecordedErrors();
    expect(errors).toHaveLength(2);
    expect(errors[1].message).toContain('letters must match');
  });

  test('records nothing when the soft assertion passes', async () => {
    expect.soft(1).toBe(1);
    expect(takeRecordedErrors()).toHaveLength(0);
  });
});
