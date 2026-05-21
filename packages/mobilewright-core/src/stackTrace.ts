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
