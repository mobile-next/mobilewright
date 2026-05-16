import { HttpDevicePoolClient } from './adapters/http-client.js';
import type { DevicePoolClient } from './application/ports.js';

export const COORDINATOR_URL_ENV = 'MOBILEWRIGHT_COORDINATOR_URL';

/**
 * Internal factory used by the test fixture. Throws if the coordinator was
 * not started (i.e. the user bypassed `defineConfig`).
 */
export function createDevicePoolClient(): DevicePoolClient {
  const baseUrl = process.env[COORDINATOR_URL_ENV];
  if (!baseUrl) {
    throw new Error(
      `${COORDINATOR_URL_ENV} is not set. ` +
      'Did you use defineConfig() in your mobilewright.config.ts? ' +
      'It auto-injects the device-pool coordinator.',
    );
  }
  return new HttpDevicePoolClient({ baseUrl });
}
