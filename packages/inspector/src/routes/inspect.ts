import { Router } from 'express';
import { inspectScreen, SCREENSHOT_MIME_TYPE } from '../lib/inspect-screen.js';
import { logger } from '../lib/logger.js';
import { DeviceManager } from '../lib/device-manager.js';

/**
 * Express router for the inspect endpoint.
 * GET /api/inspect — returns screenshot + element list from the same device moment.
 */
export function createInspectRouter(deviceManager: DeviceManager) {
  const router = Router();

  // GET /api/inspect
  // Returns screenshot + element list from the same moment (no drift).
  // GET /api/inspect?scale=0.5 — optional screenshot downscale factor, 0 < scale <= 1.
  // GET /api/inspect?etag=<etag> — 304 with no body when the capture still hashes to <etag>.
  router.get('/inspect', async (req, res) => {
    const scale = req.query.scale === undefined ? 1 : Number(req.query.scale);
    if (!(scale > 0 && scale <= 1)) {
      res.status(400).json({ error: 'scale must be a number between 0 (exclusive) and 1' });
      return;
    }

    // Claim the inspect slot before looking at the device: mid-switch there is briefly no device,
    // and that must read as "busy" (503), not "disconnected" (409).
    if (!deviceManager.beginInspect()) {
      res.status(503).json({ error: 'Inspect already in progress' });
      return;
    }

    try {
      const device = deviceManager.device;
      if (!device) {
        res.status(409).json({ error: 'No device selected' });
        return;
      }

      const { screenshot, screen, elements, etag } = await inspectScreen(device, scale, () => deviceManager.screenSize());
      if (req.query.etag === etag) {
        res.status(304).end();
        return;
      }

      res.json({
        screenshot: `data:${SCREENSHOT_MIME_TYPE};base64,${screenshot.toString('base64')}`,
        screen,
        elements,
        etag,
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
