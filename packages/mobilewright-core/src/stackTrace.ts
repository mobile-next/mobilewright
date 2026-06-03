import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

// Monorepo:  packages/mobilewright-core/src/stackTrace.ts -> packages/
// Installed: node_modules/@mobilewright/core/dist/stackTrace.js -> node_modules/@mobilewright/
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function filterStack(stack: string | undefined): string | undefined {
  if (!stack || process.env.MWDEBUGIMPL) {
    return stack;
  }

  const [head, ...frames] = stack.split('\n');
  const kept = frames.filter(line => !line.includes(FRAMEWORK_ROOT));
  return [head, ...kept].join('\n');
}

export type StepLocation = { file: string; line: number; column: number };

// Step reporter callback — structurally identical to locator.ts's StepFn,
// declared here to keep this module free of a dependency on locator.ts.
type StepReporter = (title: string, fn: () => Promise<unknown>, location: StepLocation | undefined) => Promise<unknown>;

// Run `fn` as a reporter step when a step function is set, capturing the
// caller's source location; otherwise run it directly. Shared by Locator,
// Page, WebLocator and the expect assertions so the wrapping lives in one place.
export function runStep<T>(
  stepFn: StepReporter | null | undefined,
  title: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!stepFn) {
    return fn();
  }
  const location = captureLocation();
  return stepFn(title, fn as () => Promise<unknown>, location) as Promise<T>;
}

export function captureLocation(): StepLocation | undefined {
  const frames = (new Error().stack ?? '').split('\n').slice(1);
  const userFrame = frames.find(line => line.includes('    at ') && !line.includes(FRAMEWORK_ROOT));
  if (!userFrame) {
    return undefined;
  }
  const m = userFrame.match(/at (?:.*? \()?(.+):(\d+):(\d+)\)?$/);
  if (!m) {
    return undefined;
  }
  let file = m[1];
  if (file.startsWith('file:///')) {
    try {
      file = fileURLToPath(file);
    } catch {
      return undefined;
    }
  }
  return { file, line: +m[2], column: +m[3] };
}
