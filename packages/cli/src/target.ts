import type { Bounds } from '@mobilewright/protocol';

export type Target = { kind: 'ref'; ref: string } | { kind: 'point'; x: number; y: number };

/** Accepts "e12" (a ref from the last snapshot) or "x,y" (screen coordinates). */
export function parseTarget(arg: string): Target {
  if (/^e\d+$/.test(arg)) {
    return { kind: 'ref', ref: arg };
  }
  const match = arg.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
  if (match) {
    return { kind: 'point', x: Number(match[1]), y: Number(match[2]) };
  }
  throw new Error(`expected a ref like e12 or coordinates like 100,200, got: ${arg}`);
}

export function centerOfTarget(target: Target, refs: Record<string, Bounds>): { x: number; y: number } {
  if (target.kind === 'point') {
    return { x: target.x, y: target.y };
  }
  const bounds = refs[target.ref];
  if (!bounds) {
    throw new Error(`unknown ref ${target.ref}, run "snapshot" or "find" first`);
  }
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}
