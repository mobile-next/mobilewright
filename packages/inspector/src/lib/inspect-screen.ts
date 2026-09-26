// Captures one moment of the device screen for the Inspector and codegen: screenshot, element
// list with derived locators, and screen size, plus an etag that changes whenever any of them does.

import { createHash } from 'node:crypto';
import type { Device } from '@mobilewright/core';
import type { ViewNode, ScreenSize } from '@mobilewright/protocol';
import { deriveElementList, locatorMatchPosition, type ElementEntry } from './locator-derivation.js';
import { logger } from './logger.js';

/** An element as the Inspector page receives it. */
export type ElementJson = ReturnType<typeof toElementJson>;

/** One captured moment of the device screen. */
export interface InspectedScreen {
  screenshot: Buffer;
  screen: { width: number; height: number; scale: number };
  elements: ElementJson[];
  /** SHA-1 over screenshot, screen and elements: equal etags mean an identical capture. */
  etag: string;
}

/** JPEG at 60 is ~4x smaller than PNG for the same capture time. */
export const SCREENSHOT_MIME_TYPE = 'image/jpeg';
const SCREENSHOT_FORMAT = { format: 'jpeg', quality: 60 } as const;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;
const OP_TIMEOUT_MS = 10_000;

type CaptureKey = 'screenshot' | 'tree' | 'size';
type Capture = { screenshot: Buffer; tree: ViewNode[]; size: ScreenSize };

/**
 * Capture the screen at `scale` (0 < scale <= 1). `screenSize` is injected so the caller can
 * serve it from a per-connection cache.
 */
export async function inspectScreen(device: Device, scale: number, screenSize: () => Promise<ScreenSize>): Promise<InspectedScreen> {
  const { screenshot, tree, size } = await captureWithRetry({
    screenshot: () => device.screen.screenshot({ ...SCREENSHOT_FORMAT, scale }),
    tree: () => device.screen.viewTree(),
    size: screenSize,
  });
  const screen = { width: size.width, height: size.height, scale: size.scale };
  const elements = deriveElementList(tree).map((entry, index) => toElementJson(entry, index, tree));
  return { screenshot, screen, elements, etag: etagOf(screenshot, screen, elements) };
}

function toElementJson({ node, locator, locators, depth }: ElementEntry, index: number, tree: ViewNode[]) {
  return {
    index,
    depth,
    type: node.type,
    label: node.label ?? null,
    text: node.text ?? null,
    bounds: node.bounds,
    isVisible: node.isVisible,
    identifier: node.identifier ?? null,
    resourceId: node.resourceId ?? null,
    placeholder: node.placeholder ?? null,
    value: node.value ?? null,
    isEnabled: node.isEnabled ?? true,
    isSelected: node.isSelected ?? null,
    isFocused: node.isFocused ?? null,
    isChecked: node.isChecked ?? null,
    raw: node.raw ?? null,
    locator,
    locators,
    match: locator ? locatorMatchPosition(tree, node, locator) : null,
  };
}

function etagOf(screenshot: Buffer, screen: InspectedScreen['screen'], elements: ElementJson[]): string {
  return createHash('sha1')
    .update(screenshot)
    .update(JSON.stringify(screen))
    .update(JSON.stringify(elements))
    .digest('hex');
}

/**
 * Run the three captures, retrying up to MAX_RETRIES.
 *
 * Strategy: first attempt runs all 3 in parallel for speed.  Retries
 * run only the failed ops sequentially (1 at a time) so that abandoned
 * RPCs from timed-out attempts never stack up more than 2 concurrent
 * mobilecli worker slots per retry cycle.
 */
async function captureWithRetry(captures: { [K in CaptureKey]: () => Promise<Capture[K]> }): Promise<Capture> {
  const keys = Object.keys(captures) as CaptureKey[];
  const results: Partial<Capture> = {};
  const isDone = (key: CaptureKey) => key in results;
  const run = (key: CaptureKey) => timeoutAfter<unknown>(captures[key](), OP_TIMEOUT_MS);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const pending = keys.filter(key => !isDone(key));
    if (pending.length === 0) {
      break;
    }

    if (attempt === 0) {
      const settled = await Promise.allSettled(pending.map(run));
      settled.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          Object.assign(results, { [pending[i]]: result.value });
        }
      });
    } else {
      for (const key of pending) {
        try {
          Object.assign(results, { [key]: await run(key) });
        } catch (err) {
          logger.warn(`Inspect ${key} attempt ${attempt + 1}/${MAX_RETRIES} failed: ${(err as Error).message}`);
        }
      }
    }

    const isLastAttempt = attempt === MAX_RETRIES - 1;
    if (!isLastAttempt && keys.some(key => !isDone(key))) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  const missing = keys.filter(key => !isDone(key));
  if (missing.length > 0) {
    throw new Error(`Inspect failed: ${missing.join(', ')} did not complete`);
  }
  return results as Capture;
}

/** Reject a promise if it doesn't settle within ms. */
function timeoutAfter<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}
