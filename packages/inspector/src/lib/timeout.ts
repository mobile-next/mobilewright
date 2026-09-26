/** Reject if `promise` doesn't settle within `ms`; the underlying call keeps running. */
export function timeoutAfter<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}
