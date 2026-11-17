import { test, expect } from '@mobilewright/test';
import type { App, Device, Dialog, Screen } from 'mobilewright';
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

function acceptPermissionPrompts(screen: Screen): Dialog[] {
  const prompts: Dialog[] = [];
  screen.on('dialog', async (dialog) => {
    prompts.push(dialog);
    await dialog.accept();
  });
  return prompts;
}

async function requestCameraAndWaitUntilGranted(screen: Screen): Promise<void> {
  await requestCameraButton(screen).tap();
  await expect(cameraStatus(screen)).toHaveText('Granted');
}

async function clearDataAndRelaunch(app: App, device: Device): Promise<void> {
  await app.clearData();
  await device.launchApp(PLAYGROUND_APP);
}

async function foregroundBundleId(device: Device): Promise<string> {
  return (await device.getForegroundApp()).bundleId;
}

// ─── app.clearData() ─────────────────────────────────────────────

test('clearData stops the app and resets a granted permission, so the prompt shows again', async ({ app, device, screen }, testInfo) => {
  test.skip(isRealIosDevice(testInfo), 'clearing app data is not supported on real iOS devices');
  const prompts = acceptPermissionPrompts(screen);
  // an earlier run may have left the camera granted or denied; start from a camera that was never asked
  await clearDataAndRelaunch(app, device);
  await openPermissionsAndAlerts(screen);
  await requestCameraAndWaitUntilGranted(screen);
  expect(prompts).toHaveLength(1);

  await app.clearData();

  await expect.poll(() => foregroundBundleId(device)).not.toBe(PLAYGROUND_APP);
  await device.launchApp(PLAYGROUND_APP);
  await openPermissionsAndAlerts(screen);
  await requestCameraAndWaitUntilGranted(screen);
  expect(prompts).toHaveLength(2);
  expect(prompts[1].type()).toBe('permission');
});
