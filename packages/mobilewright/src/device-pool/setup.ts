import { MobilecliDriver } from '@mobilewright/driver-mobilecli';
import { DevicePool } from './application/device-pool.js';
import { DevicePoolHttpServer } from './adapters/http-server.js';
import { COORDINATOR_URL_ENV } from './client-factory.js';
import { loadConfig, DEFAULT_ALLOCATION_TIMEOUT } from '../config.js';
import type { FullConfig } from '@playwright/test';

interface ActiveCoordinator {
  pool: DevicePool;
  server: DevicePoolHttpServer;
}

let active: ActiveCoordinator | undefined;

/**
 * Playwright globalSetup entry point. Receives the resolved FullConfig so
 * that CLI overrides (e.g. --workers 2) are reflected in maxSlots.
 */
export default async function setup(playwrightConfig: FullConfig): Promise<() => Promise<void>> {
  const config = await loadConfig(process.cwd(), playwrightConfig.configFile);
  const driver = config.driver ?? new MobilecliDriver();
  await driver.prepare?.();

  // Use the resolved worker count from Playwright's FullConfig so CLI flags
  // like --workers 2 are respected, not just the value in the config file.
  const maxSlots = playwrightConfig.workers;
  const pool = new DevicePool({ driver, maxSlots, allocationTimeoutMs: config.use?.allocationTimeout ?? DEFAULT_ALLOCATION_TIMEOUT });
  const server = new DevicePoolHttpServer({ pool });
  const port = await server.listen();

  process.env[COORDINATOR_URL_ENV] = `http://127.0.0.1:${port}`;
  active = { pool, server };

  return async () => {
    if (!active) {
      return;
    }
    await active.pool.shutdown();
    await active.server.close();
    delete process.env[COORDINATOR_URL_ENV];
    active = undefined;
  };
}
