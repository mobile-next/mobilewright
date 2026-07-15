import { Router } from 'express';
import type { Device } from '@mobilewright/core';
import type { ViewNode, ScreenSize } from '@mobilewright/protocol';
import { deriveElementList } from '../lib/locator-derivation.js';
import { logger } from '../lib/logger.js';
import { DeviceManager } from '../lib/device-manager.js';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;
const OP_TIMEOUT_MS = 10_000;

/**
 * Express router for the inspect endpoint.
 * GET /api/inspect — returns screenshot + element list from the same device moment.
 */
export function createInspectRouter(deviceManager: DeviceManager) {
  const router = Router();

  // GET /api/inspect
  // Returns screenshot + element list from the same moment (no drift).
  router.get('/inspect', async (_req, res) => {
    const device = deviceManager.device;
    if (!device) {
      res.status(409).json({ error: 'No device selected' });
      return;
    }
    if (!deviceManager.beginInspect()) {
      res.status(503).json({ error: 'Inspect already in progress' });
      return;
    }

    try {
      const { screenshotBuffer, tree, size } = await attemptWithRetry(device);

      const elements = deriveElementList(tree).map(({ node, locator, locators }, index) => ({
        index,
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
      }));

      res.json({
        screenshot: `data:image/png;base64,${screenshotBuffer.toString('base64')}`,
        screen: { width: size.width, height: size.height },
        elements,
      });
    } catch (err) {
      logger.error(`Inspect failed: ${(err as Error).message}`);
      res.status(500).json({ error: (err as Error).message });
    } finally {
      deviceManager.endInspect();
    }
  });

  return router;
}

/**
 * Run screenshot + viewTree + screenSize, retrying up to MAX_RETRIES.
 *
 * Strategy: first attempt runs all 3 in parallel for speed.  Retries
 * run only the failed ops sequentially (1 at a time) so that abandoned
 * RPCs from timed-out attempts never stack up more than 2 concurrent
 * mobilecli worker slots per retry cycle.
 */
async function attemptWithRetry(device: Device): Promise<{ screenshotBuffer: Buffer; tree: ViewNode[]; size: ScreenSize }> {
  const ops = [
    { key: 'screenshotBuffer' as const, run: () => device.screen.screenshot() },
    { key: 'tree' as const, run: () => device.screen.viewTree() },
    { key: 'size' as const, run: () => device.screenSize() },
  ];

  const results: Partial<Record<'screenshotBuffer' | 'tree' | 'size', unknown>> = {};

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const pending = ops.filter(op => !(op.key in results));
    if (pending.length === 0) break;

    if (attempt === 0) {
      const settled = await Promise.allSettled(pending.map(op => timeoutAfter(op.run() as Promise<unknown>, OP_TIMEOUT_MS)));
      for (let i = 0; i < settled.length; i++) {
        const result = settled[i];
        if (result.status === 'fulfilled') results[pending[i].key] = result.value;
      }
    } else {
      for (const op of pending) {
        try {
          results[op.key] = await timeoutAfter(op.run() as Promise<unknown>, OP_TIMEOUT_MS);
        } catch (err) {
          logger.warn(`Inspect ${op.key} attempt ${attempt + 1}/${MAX_RETRIES} failed: ${(err as Error).message}`);
        }
      }
    }

    const stillPending = ops.filter(op => !(op.key in results));
    if (stillPending.length > 0 && attempt < MAX_RETRIES - 1) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  const missing = ops.filter(op => !(op.key in results));
  if (missing.length > 0) {
    throw new Error(`Inspect failed: ${missing.map(o => o.key).join(', ')} did not complete`);
  }

  return {
    screenshotBuffer: results.screenshotBuffer as Buffer,
    tree: results.tree as ViewNode[],
    size: results.size as ScreenSize,
  };
}

/** Reject a promise if it doesn't settle within ms. */
function timeoutAfter<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) return Promise.reject(new Error('Deadline exceeded'));
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}
