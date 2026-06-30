import { Router } from 'express';
import type { Device } from '@mobilewright/core';
import type { ViewNode, ScreenSize } from '@mobilewright/protocol';
import { deriveElementList } from '../lib/locator-derivation.js';
import { logger } from '../lib/logger.js';
import { DeviceManager } from '../lib/device-manager.js';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;
const ATTEMPT_TIMEOUT_MS = 10_000;

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

      const elements = deriveElementList(tree).map(({ node, locator }, index) => ({
        index,
        type: node.type,
        label: node.label ?? null,
        text: node.text ?? null,
        bounds: node.bounds,
        isVisible: node.isVisible,
        locator,
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

/** Run screenshot + viewTree + screenSize together, retrying up to MAX_RETRIES times on failure. */
async function attemptWithRetry(device: Device): Promise<{ screenshotBuffer: Buffer; tree: ViewNode[]; size: ScreenSize }> {
  let lastErr: unknown;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      return await withTimeout(
        Promise.all([device.screen.screenshot(), device.screen.viewTree(), device.screenSize()]).then(
          ([screenshotBuffer, tree, size]) => ({ screenshotBuffer, tree, size }),
        ),
        ATTEMPT_TIMEOUT_MS,
        `Device operation timed out after ${ATTEMPT_TIMEOUT_MS}ms`,
      );
    } catch (err) {
      lastErr = err;
      logger.warn(`Inspect attempt ${i + 1}/${MAX_RETRIES} failed: ${(err as Error).message}`);
      if (i < MAX_RETRIES - 1) await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  throw lastErr;
}

/**
 * Race promise against a ms deadline. Rejects with message on timeout.
 * Note: cannot cancel the underlying promise; it continues running until the driver times out.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}
