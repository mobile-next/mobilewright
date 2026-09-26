import { Router, type RequestHandler } from 'express';
import type { Device } from '@mobilewright/core';
import type { HardwareButton, Geolocation } from '@mobilewright/protocol';
import { logger } from '../lib/logger.js';
import { DeviceError, DeviceManager } from '../lib/device-manager.js';

/** Screen gestures /api/tap can perform at a point; each is a Screen method taking (x, y). */
const TAP_GESTURES = ['tap', 'doubleTap', 'longPress'] as const;
type TapGesture = typeof TAP_GESTURES[number];

/** Hardware buttons the codegen toolbar can press. */
const RECORDER_BUTTONS: readonly HardwareButton[] = ['HOME', 'BACK', 'APP_SWITCH'];

type RequestBody = Record<string, unknown>;

/** A parsed action request: the device call to make, or why the request is invalid (400). */
type ParsedAction = { run: (device: Device) => Promise<unknown> } | { error: string };

/**
 * Express router for actions codegen performs on the device.
 * POST /api/tap, POST /api/press-button, POST /api/geolocation
 */
export function createDeviceActionsRouter(deviceManager: DeviceManager) {
  const router = Router();

  // Every action: 400 for an invalid body, 409 without a device, 503 while switching devices,
  // 500 if the device call fails.
  function deviceAction(name: string, parse: (body: RequestBody) => ParsedAction): RequestHandler {
    return async (req, res) => {
      const action = parse((req.body ?? {}) as RequestBody);
      if ('error' in action) {
        res.status(400).json({ error: action.error });
        return;
      }

      try {
        await deviceManager.withDevice(action.run);
        res.json({ ok: true });
      } catch (err) {
        const status = statusFor(err);
        if (status === 500) {
          logger.error(`${name} failed: ${(err as Error).message}`);
        }
        res.status(status).json({ error: (err as Error).message });
      }
    };
  }

  // body: { x: number, y: number, gesture?: 'tap' | 'doubleTap' | 'longPress' }, in logical screen points
  router.post('/tap', deviceAction('Tap', parseTap));
  // body: { button: 'HOME' | 'BACK' | 'APP_SWITCH' }
  router.post('/press-button', deviceAction('Press button', parsePressButton));
  // body: { geolocation: { latitude, longitude } } to set, { geolocation: null } to reset
  router.post('/geolocation', deviceAction('Set geolocation', parseGeolocation));

  return router;
}

function statusFor(err: unknown): number {
  if (err instanceof DeviceError && err.code === 'not_found') {
    return 409;
  }
  if (err instanceof DeviceError && err.code === 'in_progress') {
    return 503;
  }
  return 500;
}

function parseTap({ x, y, gesture = 'tap' }: RequestBody): ParsedAction {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { error: 'x and y must be numbers' };
  }
  if (!TAP_GESTURES.includes(gesture as TapGesture)) {
    return { error: `gesture must be one of ${TAP_GESTURES.join(', ')}` };
  }
  return { run: device => device.screen[gesture as TapGesture](x as number, y as number) };
}

function parsePressButton({ button }: RequestBody): ParsedAction {
  if (!RECORDER_BUTTONS.includes(button as HardwareButton)) {
    return { error: `button must be one of ${RECORDER_BUTTONS.join(', ')}` };
  }
  return { run: device => device.screen.pressButton(button as HardwareButton) };
}

function parseGeolocation({ geolocation }: RequestBody): ParsedAction {
  if (geolocation !== null && !isValidGeolocation(geolocation)) {
    return { error: 'geolocation must be null or { latitude: -90..90, longitude: -180..180 }' };
  }
  return { run: device => device.setGeolocation(geolocation) };
}

function isValidGeolocation(value: unknown): value is Geolocation {
  const { latitude, longitude } = (value ?? {}) as { latitude?: unknown; longitude?: unknown };
  return typeof latitude === 'number' && latitude >= -90 && latitude <= 90
    && typeof longitude === 'number' && longitude >= -180 && longitude <= 180;
}
