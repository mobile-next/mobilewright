import type { GesturePoint, GestureSequence } from './types.js';

/** WDA-style pointer action, the flat shape mobilecli's `device.io.gesture` expects. */
export interface TapAction {
  type: 'pointerMove' | 'pointerDown' | 'pointerUp' | 'pause';
  x?: number;
  y?: number;
  /** Milliseconds */
  duration?: number;
}

/**
 * Flatten a GestureSequence (one path of timed points per finger) into the
 * flat TapAction[] that mobilecli understands:
 *   pointerMove(start) -> pointerDown -> pointerMove(each next point, timed) -> pointerUp
 */
export function gestureSequenceToTapActions(sequence: GestureSequence): TapAction[] {
  const paths = sequence.pointers.filter(path => path.length > 0);
  if (paths.length === 0) {
    throw new Error('gesture requires at least one pointer with at least one point');
  }

  // TapAction has no pointer id, so mobilecli can only drive one finger.
  // Multi-touch needs a protocol change on the mobilecli side first.
  if (paths.length > 1) {
    throw new Error(`multi-touch gestures are not supported by this driver (got ${paths.length} pointers)`);
  }

  return pathToTapActions(paths[0]);
}

function pathToTapActions(path: GesturePoint[]): TapAction[] {
  const [first, ...rest] = path;
  const start: TapAction[] = [
    { type: 'pointerMove', x: first.x, y: first.y, duration: 0 },
    { type: 'pointerDown' },
  ];

  const moves = rest.map((point, i) => {
    const previousTime = path[i].time ?? 0;
    const duration = Math.max(0, (point.time ?? previousTime) - previousTime);
    return { type: 'pointerMove', x: point.x, y: point.y, duration } as TapAction;
  });

  return [...start, ...moves, { type: 'pointerUp' }];
}
