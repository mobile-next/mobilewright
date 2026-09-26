import { Router } from 'express';
import { DeviceError, DeviceManager } from '../lib/device-manager.js';

/**
 * Express router for device listing and selection.
 * GET /api/devices, POST /api/devices/select?device=<id>
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

  // POST /api/devices/select?device=<id>  — the platform comes from the device list
  router.post('/select', async (req, res) => {
    const id = req.query.device;
    if (typeof id !== 'string' || id === '') {
      res.status(400).json({ error: 'device query parameter is required' });
      return;
    }

    try {
      const device = (await deviceManager.listDevices()).find(d => d.id === id);
      if (!device) {
        res.status(404).json({ error: `Device '${id}' not found` });
        return;
      }
      await deviceManager.select(id, device.platform);
      res.json({ ok: true });
    } catch (err) {
      const status = err instanceof DeviceError && err.code === 'in_progress' ? 409 : 500;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  return router;
}
