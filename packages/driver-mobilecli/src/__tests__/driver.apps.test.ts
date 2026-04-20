import { test, expect } from '@playwright/test';
import { MobilecliDriver } from '../driver.js';

type RpcLike = {
  call: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  disconnect: () => Promise<void>;
};

function createDriverWithRpcResult(rpcResult: unknown): MobilecliDriver {
  const driver = new MobilecliDriver();
  const rpc: RpcLike = {
    call: async (_method, _params) => rpcResult,
    disconnect: async () => {},
  };

  (driver as unknown as { session: unknown }).session = {
    deviceId: 'test-device',
    platform: 'android',
    rpc,
  };

  return driver;
}

test.describe('MobilecliDriver.listApps', () => {
  test('maps app entries from result.apps', async () => {
    const driver = createDriverWithRpcResult({
      apps: [
        {
          packageName: 'com.example.android',
          appName: 'Android App',
          version: '1.2.3',
        },
        {
          bundleId: 'com.example.ios',
          appName: 'iOS App',
          version: '4.5.6',
        },
      ],
    });

    const apps = await driver.listApps();

    expect(apps).toEqual([
      {
        bundleId: 'com.example.android',
        name: 'Android App',
        version: '1.2.3',
      },
      {
        bundleId: 'com.example.ios',
        name: 'iOS App',
        version: '4.5.6',
      },
    ]);
  });

  test('throws a clear error when apps field is missing', async () => {
    const driver = createDriverWithRpcResult({});

    await expect(driver.listApps()).rejects.toThrow(
      'Invalid response for device.apps.list: expected result.apps array',
    );
  });
});
