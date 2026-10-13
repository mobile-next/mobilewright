import { test, expect } from '@mobilewright/test';
import type { Device, Screen, Dialog } from 'mobilewright';

const PLAYGROUND_APP = 'com.mobilenext.playground';

// ─── Helpers ─────────────────────────────────────────────────────

// On Android, clearAppData also resets runtime permissions, so permission prompts show up on every run.
// On an iOS simulator it does not: reset them with `xcrun simctl privacy <udid> reset all <bundle>`,
// and reinstall the app to reset notifications.
async function openPermissionsAndAlertsWithFreshPermissions(device: Device, screen: Screen): Promise<void> {
  await device.terminateApp(PLAYGROUND_APP).catch(() => {});
  await device.clearAppData(PLAYGROUND_APP);
  await device.launchApp(PLAYGROUND_APP);
  await screen.getByText('Permissions and Alerts').tap();
}

function alertResult(screen: Screen) {
  return screen.getByTestId('alert_result');
}

function deniedStatus(platform: 'ios' | 'android' | undefined): string {
  return platform === 'ios' ? 'Denied' : 'Not Granted';
}

function permissionStatus(screen: Screen, permission: 'camera' | 'location' | 'notifications') {
  return screen.getByTestId(`${permission}_permission_status`);
}

async function pressButton(screen: Screen, testId: string): Promise<void> {
  // the alert buttons sit below the fold on smaller screens, and iOS only lists rendered rows
  const button = screen.getByTestId(testId);
  await button.scrollIntoViewIfNeeded();
  await button.tap();
}

function recordDialogs(screen: Screen, respond: (dialog: Dialog) => Promise<void>): Dialog[] {
  const seen: Dialog[] = [];
  screen.on('dialog', async (dialog) => {
    seen.push(dialog);
    await respond(dialog);
  });
  return seen;
}

test.beforeEach(async ({ device, screen }) => {
  await openPermissionsAndAlertsWithFreshPermissions(device, screen);
});

// ─── App alerts ──────────────────────────────────────────────────

test('dismissing a confirm alert presses Cancel', async ({ screen }) => {
  const dialogs = recordDialogs(screen, (dialog) => dialog.dismiss());
  await pressButton(screen, 'show_confirm_alert_button');
  await expect(alertResult(screen)).toHaveText('Cancel');
  expect(dialogs).toHaveLength(1);
  expect(dialogs[0].type()).toBe('confirm');
  expect(dialogs[0].title()).toBe('Confirm Alert');
  expect(dialogs[0].message()).toBe('Do you want to continue?');
});

test('accepting a prompt types the answer and presses OK', async ({ screen }) => {
  recordDialogs(screen, (dialog) => dialog.accept('Gil'));
  await pressButton(screen, 'show_prompt_alert_button');
  await expect(alertResult(screen)).toHaveText('Hello, Gil');
});

test('a button can be pressed by its caption', async ({ screen }) => {
  recordDialogs(screen, (dialog) => dialog.tap('Later'));
  await pressButton(screen, 'show_three_button_alert_button');
  await expect(alertResult(screen)).toHaveText('Later');
});

test('an alert that pops up while waiting is handled within the expect timeout', async ({ screen }) => {
  recordDialogs(screen, (dialog) => dialog.accept());
  await pressButton(screen, 'show_delayed_alert_button');
  await expect(alertResult(screen)).toHaveText('OK', { timeout: 5000 });
});

test('an alert covering the next tap target is handled and the tap goes through', async ({ screen }) => {
  await pressButton(screen, 'show_simple_alert_button');
  const dialogs = recordDialogs(screen, (dialog) => dialog.accept());
  await pressButton(screen, 'show_confirm_alert_button');
  expect(dialogs.map((dialog) => dialog.title())).toEqual(['Simple Alert']);
  // the confirm alert opened by the tap is reported too, and accepted
  await expect(alertResult(screen)).toHaveText('OK');
});

// ─── System permission dialogs ───────────────────────────────────

test('accepting the location prompt grants location', async ({ screen }) => {
  const dialogs = recordDialogs(screen, (dialog) => dialog.accept());
  await pressButton(screen, 'request_location_permission_button');
  await expect(permissionStatus(screen, 'location')).toHaveText('Granted');
  expect(dialogs[0].type()).toBe('permission');
  expect(dialogs[0].isSystem()).toBe(true);
});

test('dismissing the camera prompt denies the camera', async ({ screen, platform }) => {
  const dialogPromise = screen.waitForEvent('dialog');
  await pressButton(screen, 'request_camera_permission_button');
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe('permission');
  await dialog.dismiss();
  await expect(screen.getByText(/Don’t allow/i)).toBeHidden();
  await expect(permissionStatus(screen, 'camera')).toHaveText(deniedStatus(platform));
});

test('accepting the notifications prompt grants notifications', async ({ screen }) => {
  recordDialogs(screen, (dialog) => dialog.accept());
  await pressButton(screen, 'request_notifications_permission_button');
  await expect(permissionStatus(screen, 'notifications')).toHaveText('Granted');
});

// ─── Sheets are not dialogs ──────────────────────────────────────

test('an action sheet is left alone, and the test picks an option with a locator', async ({ screen }) => {
  const dialogs = recordDialogs(screen, (dialog) => dialog.accept());
  await pressButton(screen, 'show_action_sheet_button');
  await screen.getByText(/^red$/i).tap();
  await expect(alertResult(screen)).toHaveText('Red');
  expect(dialogs).toHaveLength(0);
});

test('a bottom sheet is left alone, and the test picks an option with a locator', async ({ screen, platform }) => {
  test.skip(platform === 'ios', 'bottom sheets are an Android control');
  const dialogs = recordDialogs(screen, (dialog) => dialog.accept());
  await pressButton(screen, 'show_bottom_sheet_button');
  await screen.getByText(/^red$/i).tap();
  await expect(alertResult(screen)).toHaveText('Red');
  expect(dialogs).toHaveLength(0);
});
