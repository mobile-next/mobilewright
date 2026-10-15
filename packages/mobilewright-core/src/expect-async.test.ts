import { test, expect } from '@playwright/test';
import type { StepFn } from './locator.js';
import { expect as mwExpect, ExpectError, setSoftFailureHandler, setDefaultStepFn } from './expect.js';

// A step function that records the title of every step it wraps, then runs the body.
function recordingStepFn(): { stepFn: StepFn; titles: string[] } {
  const titles: string[] = [];
  const stepFn: StepFn = (title, body) => {
    titles.push(title);
    return body();
  };
  return { stepFn, titles };
}

// Returns 1, 2, 3, ... on each call, so a poll has to retry to see a later value.
function counter(): () => number {
  let count = 0;
  return () => ++count;
}

async function errorOf(action: Promise<unknown>): Promise<Error> {
  try {
    await action;
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected the action to fail');
}

test.describe('expect(promise).rejects', () => {
  test('toThrow passes when the promise rejects', async () => {
    await mwExpect(Promise.reject(new Error('boom'))).rejects.toThrow();
  });

  test('toThrow matches a substring of the rejection message', async () => {
    await mwExpect(Promise.reject(new Error('Locator timed out after 5000ms'))).rejects.toThrow('timed out');
  });

  test('toThrow matches a regex against the rejection message', async () => {
    await mwExpect(Promise.reject(new Error('Locator timed out after 5000ms'))).rejects.toThrow(/after \d+ms$/);
  });

  test('toThrow fails when the rejection message does not match', async () => {
    const error = await errorOf(mwExpect(Promise.reject(new Error('boom'))).rejects.toThrow('kaboom'));
    expect(error).toBeInstanceOf(ExpectError);
  });

  test('not.toThrow passes when the rejection message does not match', async () => {
    await mwExpect(Promise.reject(new Error('boom'))).rejects.not.toThrow('kaboom');
  });

  test('fails when the promise resolves', async () => {
    const error = await errorOf(mwExpect(Promise.resolve(42)).rejects.toThrow());
    expect(error).toBeInstanceOf(ExpectError);
    expect(error.message).toBe('Expected promise to reject, but it resolved with 42');
  });

  test('other matchers run against the rejection reason', async () => {
    const rejection = Promise.reject(new TypeError('bad input'));
    await mwExpect(rejection).rejects.toBeInstanceOf(TypeError);
    await mwExpect(rejection).rejects.toHaveProperty('message', 'bad input');
  });

  test('a rejection with a non-Error value can be matched', async () => {
    await mwExpect(Promise.reject('just a string')).rejects.toBe('just a string');
  });

  test('fails when the value is not a promise', async () => {
    const error = await errorOf(mwExpect(42).rejects.toThrow());
    expect(error).toBeInstanceOf(ExpectError);
    expect(error.message).toBe('Expected a promise, but received 42');
  });

  test('keeps the custom message', async () => {
    const error = await errorOf(mwExpect(Promise.resolve(1), 'tap must time out').rejects.toThrow());
    expect(error.message).toMatch(/^tap must time out\n\nExpected promise to reject/);
  });

  test('works with expect.soft', async () => {
    const recorded: ExpectError[] = [];
    setSoftFailureHandler((error) => { recorded.push(error); });
    try {
      await mwExpect.soft(Promise.resolve(1)).rejects.toThrow();
    } finally {
      setSoftFailureHandler((error) => { throw error; });
    }
    expect(recorded).toHaveLength(1);
  });

  test('reports one step titled expect.rejects.toThrow()', async () => {
    const { stepFn, titles } = recordingStepFn();
    setDefaultStepFn(stepFn);
    try {
      await mwExpect(Promise.reject(new Error('boom'))).rejects.toThrow('boom');
    } finally {
      setDefaultStepFn(null);
    }
    expect(titles).toEqual(['expect.rejects.toThrow()']);
  });
});

test.describe('expect(promise).resolves', () => {
  test('matchers run against the resolved value', async () => {
    await mwExpect(Promise.resolve(42)).resolves.toBe(42);
    await mwExpect(Promise.resolve([1, 2])).resolves.toContain(2);
  });

  test('not inverts the matcher', async () => {
    await mwExpect(Promise.resolve(42)).resolves.not.toBe(7);
  });

  test('fails when the promise rejects', async () => {
    const error = await errorOf(mwExpect(Promise.reject(new Error('boom'))).resolves.toBe(42));
    expect(error).toBeInstanceOf(ExpectError);
    expect(error.message).toBe('Expected promise to resolve, but it rejected with Error: boom');
  });
});

test.describe('expect.poll', () => {
  test('retries until the value matches', async () => {
    const nextCount = counter();
    await mwExpect.poll(nextCount, { intervals: [10] }).toBe(3);
  });

  test('accepts an async function', async () => {
    const nextCount = counter();
    await mwExpect.poll(async () => nextCount(), { intervals: [10] }).toBeGreaterThan(2);
  });

  test('not retries until the value stops matching', async () => {
    const nextCount = counter();
    await mwExpect.poll(nextCount, { intervals: [10] }).not.toBeLessThan(3);
  });

  test('retries when the polled function throws', async () => {
    const nextCount = counter();
    const failTwiceThenSucceed = (): string => {
      if (nextCount() < 3) {
        throw new Error('not ready');
      }
      return 'ready';
    };
    await mwExpect.poll(failTwiceThenSucceed, { intervals: [10] }).toBe('ready');
  });

  test('times out with the last mismatch', async () => {
    const error = await errorOf(mwExpect.poll(() => 'portrait', { timeout: 200, intervals: [20] }).toBe('landscape'));
    expect(error).toBeInstanceOf(ExpectError);
    expect(error.message).toContain('Timeout 200ms exceeded while waiting on the predicate');
    expect(error.message).toContain('Expected "landscape", but received "portrait"');
  });

  test('times out with the last error thrown by the polled function', async () => {
    const alwaysFails = (): number => {
      throw new Error('device not ready');
    };
    const error = await errorOf(mwExpect.poll(alwaysFails, { timeout: 200, intervals: [20] }).toBe(1));
    expect(error.message).toContain('device not ready');
  });

  test('the message option prefixes the failure', async () => {
    const error = await errorOf(mwExpect.poll(() => 1, { timeout: 100, intervals: [20], message: 'app should leave the foreground' }).toBe(2));
    expect(error.message).toMatch(/^app should leave the foreground\n\nTimeout 100ms/);
  });

  test('waits between attempts using the intervals, repeating the last one', async () => {
    const calledAt: number[] = [];
    const recordCall = (): number => calledAt.push(Date.now());
    await mwExpect.poll(recordCall, { intervals: [10, 50] }).toBe(4);
    const gaps = calledAt.slice(1).map((time, i) => time - calledAt[i]);
    expect(gaps[0]).toBeGreaterThanOrEqual(10);
    expect(gaps[1]).toBeGreaterThanOrEqual(50);
    expect(gaps[2]).toBeGreaterThanOrEqual(50);
  });

  test('reports one step for the whole poll, not one per attempt', async () => {
    const { stepFn, titles } = recordingStepFn();
    const nextCount = counter();
    setDefaultStepFn(stepFn);
    try {
      await mwExpect.poll(nextCount, { intervals: [10] }).toBe(3);
      await mwExpect.poll(() => 1, { intervals: [10] }).not.toBe(2);
    } finally {
      setDefaultStepFn(null);
    }
    expect(titles).toEqual(['expect.poll.toBe()', 'expect.poll.not.toBe()']);
  });

  test('timeout: 0 keeps polling with no time limit', async () => {
    const nextCount = counter();
    await mwExpect.poll(nextCount, { timeout: 0, intervals: [10] }).toBe(3);
  });

  test('uses the whole timeout even when the next interval would overshoot it', async () => {
    const startedAt = Date.now();
    const becomesTrueAfter150ms = (): boolean => Date.now() - startedAt >= 150;
    // with 1000ms intervals the only in-time retry is a short last one before the deadline
    await mwExpect.poll(becomesTrueAfter150ms, { timeout: 300, intervals: [1000] }).toBe(true);
  });

  test('accepts a message string instead of options', async () => {
    const error = await errorOf(mwExpect.poll(() => 1, 'orientation should flip').toBe(2));
    expect(error.message).toMatch(/^orientation should flip\n\nTimeout 5000ms/);
  });

  test('combines with expect.soft', async () => {
    const recorded: ExpectError[] = [];
    setSoftFailureHandler((error) => { recorded.push(error); });
    try {
      await mwExpect.soft.poll(() => 1, { timeout: 100, intervals: [20] }).toBe(2);
      await mwExpect.soft.poll(() => 1, { timeout: 100, intervals: [20] }).not.toBe(1);
    } finally {
      setSoftFailureHandler((error) => { throw error; });
    }
    expect(recorded).toHaveLength(2);
    expect(recorded[0].message).toContain('Timeout 100ms exceeded');
  });

  test('soft poll reports a step titled expect.soft.poll', async () => {
    const { stepFn, titles } = recordingStepFn();
    setDefaultStepFn(stepFn);
    try {
      await mwExpect.soft.poll(() => 1).toBe(1);
    } finally {
      setDefaultStepFn(null);
    }
    expect(titles).toEqual(['expect.soft.poll.toBe()']);
  });

  test('is not mistaken for a promise when awaited by accident', async () => {
    const assertions = mwExpect.poll(() => 1);
    expect(await assertions).toBe(assertions);
  });
});
