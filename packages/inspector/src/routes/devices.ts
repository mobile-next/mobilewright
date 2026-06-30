import { Router } from 'express';
import { DeviceError, DeviceManager } from '../lib/device-manager.js';

/**
 * Express router for device listing and selection.
 * GET /api/devices, POST /api/devices/:id/select
 */
export function createDevicesRouter(deviceManager: DeviceManager) {
  const router = Router();

  // GET /api/devices
  router.get('/', async (_req, res) => {
    try {
      const devices = await deviceManager.listDevices();
      res.json({ devices, activeId: deviceManager.deviceInfo?.id ?? null });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/devices/:id/select  body: { platform: 'ios' | 'android' }
  router.post('/:id/select', async (req, res) => {
    const { id } = req.params;
    const { platform } = (req.body ?? {}) as { platform?: string };

    if (platform !== 'ios' && platform !== 'android') {
      res.status(400).json({ error: 'platform must be \'ios\' or \'android\'' });
      return;
    }

    try {
      const devices = await deviceManager.listDevices();
      if (!devices.some(d => d.id === id && d.platform === platform)) {
        res.status(404).json({ error: `Device '${id}' not found` });
        return;
      }
      await deviceManager.select(id, platform);
      res.json({ ok: true });
    } catch (err) {
      const status = err instanceof DeviceError && (err.code === 'blocked' || err.code === 'in_progress') ? 409 : 500;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  return router;
}
