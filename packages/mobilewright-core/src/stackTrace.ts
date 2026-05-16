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
