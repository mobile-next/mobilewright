import { test, expect } from '@mobilewright/test';
import type { Screen } from 'mobilewright';
import type { TestInfo } from '@playwright/test';

const PLAYGROUND_APP = 'com.mobilenext.playground';

test.use({ bundleId: PLAYGROUND_APP });

// ─── Helpers ─────────────────────────────────────────────────────

function isRealIosDevice(testInfo: TestInfo): boolean {
  const annotation = (type: string) => testInfo.annotations.find((a) => a.type === type)?.description;
  return annotation('device.platform') === 'ios' && annotation('device.type') === 'real';
}

function cameraStatus(screen: Screen) {
  return screen.getByTestId('camera_permission_status');
}

function requestCameraButton(screen: Screen) {
  return screen.getByTestId('request_camera_permission_button');
}

async function openPermissionsAndAlerts(screen: Screen): Promise<void> {
  await screen.getByText('Permissions and Alerts').tap();
  await requestCameraButton(screen).scrollIntoViewIfNeeded();
}

async function grantCamera(screen: Screen): Promise<void> {
  // the prompt only shows when the camera was not answered before; either way the status ends up Granted
  screen.on('dialog', (dialog) => dialog.accept());
  await requestCameraButton(screen).tap();
  await expect(cameraStatus(screen)).toHaveText('Granted');
}

// ─── app.clearData() ─────────────────────────────────────────────

test('clearData resets a granted permission and stops the app', async ({ app, device, screen }, testInfo) => {
  test.skip(isRealIosDevice(testInfo), 'clearing app data is not supported on real iOS devices');
  await openPermissionsAndAlerts(screen);
  await grantCamera(screen);

  await app.clearData();

  await expect.poll(async () => (await device.getForegroundApp()).bundleId).not.toBe(PLAYGROUND_APP);
  await device.launchApp(PLAYGROUND_APP);
  await openPermissionsAndAlerts(screen);
  await expect(cameraStatus(screen)).not.toHaveText('Granted');
});
