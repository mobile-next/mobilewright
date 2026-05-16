import { sleep } from './sleep.js';

const POLL_INTERVAL = 100;

export async function retryUntil<T>(
  poll: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeout: number,
  failMessage: string | (() => string),
): Promise<void> {
  const deadline = Date.now() + timeout;

  while (true) {
    const value = await poll();
    if (predicate(value)) {
      return;
    }

    if (Date.now() >= deadline) {
      const msg = typeof failMessage === 'function' ? failMessage() : failMessage;
      throw new Error(msg);
    }

    await sleep(POLL_INTERVAL);
  }
}
