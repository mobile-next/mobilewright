import { Router } from 'express';
import { createHash } from 'node:crypto';
import type { Device } from '@mobilewright/core';
import type { ViewNode, ScreenSize, HardwareButton, Geolocation } from '@mobilewright/protocol';
import { deriveElementList, locatorMatchPosition } from '../lib/locator-derivation.js';
import { logger } from '../lib/logger.js';
import { DeviceManager } from '../lib/device-manager.js';

/** Screen gestures /api/tap can perform at a point; each is a Screen method taking (x, y). */
const TAP_GESTURES = ['tap', 'doubleTap', 'longPress'] as const;
type TapGesture = typeof TAP_GESTURES[number];

/** Hardware buttons the codegen toolbar can press. */
const RECORDER_BUTTONS: readonly HardwareButton[] = ['HOME', 'BACK', 'APP_SWITCH'];

const SCREENSHOT_FORMAT = { format: 'jpeg', quality: 60 } as const;

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
  // GET /api/inspect?scale=0.5 — optional screenshot downscale factor, 0 < scale <= 1.
  // GET /api/inspect?etag=<etag> — 304 with no body when the payload still hashes to <etag>.
  router.get('/inspect', async (req, res) => {
    const scale = req.query.scale === undefined ? 1 : Number(req.query.scale);
    if (!(scale > 0 && scale <= 1)) {
      res.status(400).json({ error: 'scale must be a number between 0 (exclusive) and 1' });
      return;
    }

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
      const { screenshotBuffer, tree, size } = await attemptWithRetry(device, scale);

      const elements = deriveElementList(tree).map(({ node, locator, locators, depth }, index) => ({
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
      }));

      const screen = { width: size.width, height: size.height, scale: size.scale };
      const etag = payloadEtag(screenshotBuffer, screen, elements);
      if (req.query.etag === etag) {
        res.status(304).end();
        return;
      }

      res.json({
        screenshot: `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`,
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

  // POST /api/tap  body: { x: number, y: number, gesture?: 'tap' | 'doubleTap' | 'longPress' }
  // Coordinates are logical screen points; gesture defaults to 'tap'.
  router.post('/tap', async (req, res) => {
    const device = deviceManager.device;
    if (!device) {
      res.status(409).json({ error: 'No device selected' });
      return;
    }

    const { x, y, gesture = 'tap' } = (req.body ?? {}) as { x?: unknown; y?: unknown; gesture?: unknown };
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      res.status(400).json({ error: 'x and y must be numbers' });
      return;
    }
    if (!TAP_GESTURES.includes(gesture as TapGesture)) {
      res.status(400).json({ error: `gesture must be one of ${TAP_GESTURES.join(', ')}` });
      return;
    }

    try {
      await device.screen[gesture as TapGesture](x as number, y as number);
      res.json({ ok: true });
    } catch (err) {
      logger.error(`Tap failed: ${(err as Error).message}`);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/geolocation  body: { geolocation: { latitude, longitude } } to set, { geolocation: null } to reset
  router.post('/geolocation', async (req, res) => {
    const device = deviceManager.device;
    if (!device) {
      res.status(409).json({ error: 'No device selected' });
      return;
    }

    const { geolocation } = (req.body ?? {}) as { geolocation?: unknown };
    if (geolocation !== null && !isValidGeolocation(geolocation)) {
      res.status(400).json({ error: 'geolocation must be null or { latitude: -90..90, longitude: -180..180 }' });
      return;
    }

    try {
      await device.setGeolocation(geolocation);
      res.json({ ok: true });
    } catch (err) {
      logger.error(`Set geolocation failed: ${(err as Error).message}`);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/press-button  body: { button: 'HOME' | 'BACK' | 'APP_SWITCH' }
  router.post('/press-button', async (req, res) => {
    const device = deviceManager.device;
    if (!device) {
      res.status(409).json({ error: 'No device selected' });
      return;
    }

    const { button } = (req.body ?? {}) as { button?: unknown };
    if (!RECORDER_BUTTONS.includes(button as HardwareButton)) {
      res.status(400).json({ error: `button must be one of ${RECORDER_BUTTONS.join(', ')}` });
      return;
    }

    try {
      await device.screen.pressButton(button as HardwareButton);
      res.json({ ok: true });
    } catch (err) {
      logger.error(`Press button failed: ${(err as Error).message}`);
      res.status(500).json({ error: (err as Error).message });
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
async function attemptWithRetry(device: Device, scale: number): Promise<{ screenshotBuffer: Buffer; tree: ViewNode[]; size: ScreenSize }> {
  const ops = [
    { key: 'screenshotBuffer' as const, run: () => timedScreenshot(device, scale) },
    { key: 'tree' as const, run: () => device.screen.viewTree() },
    { key: 'size' as const, run: () => cachedScreenSize(device) },
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

function isValidGeolocation(value: unknown): value is Geolocation {
  const { latitude, longitude } = (value ?? {}) as { latitude?: unknown; longitude?: unknown };
  return typeof latitude === 'number' && latitude >= -90 && latitude <= 90
    && typeof longitude === 'number' && longitude >= -180 && longitude <= 180;
}

/** SHA-1 over everything the inspect payload carries, so equal etags mean an identical response. */
function payloadEtag(screenshot: Buffer, screen: unknown, elements: unknown): string {
  return createHash('sha1')
    .update(screenshot)
    .update(JSON.stringify(screen))
    .update(JSON.stringify(elements))
    .digest('hex');
}

// Screen size never changes for a connected device, yet the call costs ~250ms, so ask once per
// device. The Device object is replaced on every (re)connect, which starts a fresh cache.
// ponytail: stale after the device rotates; key by orientation if codegen gains a rotate control.
const screenSizes = new WeakMap<Device, Promise<ScreenSize>>();

function cachedScreenSize(device: Device): Promise<ScreenSize> {
  let size = screenSizes.get(device);
  if (!size) {
    size = device.screenSize();
    // A failed call must not stick; the next frame retries.
    size.catch(() => screenSizes.delete(device));
    screenSizes.set(device, size);
  }
  return size;
}

/** Take a screenshot and log how long it took and how big it is. */
async function timedScreenshot(device: Device, scale: number): Promise<Buffer> {
  const startedAt = performance.now();
  const buffer = await device.screen.screenshot({ ...SCREENSHOT_FORMAT, scale });
  const elapsedMs = Math.round(performance.now() - startedAt);
  logger.info(`Screenshot took ${elapsedMs}ms, ${buffer.length} bytes, scale ${scale}`);
  return buffer;
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
