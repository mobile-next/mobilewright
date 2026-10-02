import { test, expect } from '@mobilewright/test';
import type { Device, Screen, Dialog } from 'mobilewright';

const PLAYGROUND_APP = 'com.mobilenext.playground';

test.use({ platform: 'android' });

// ─── Helpers ─────────────────────────────────────────────────────

// clearAppData also resets runtime permissions, so permission prompts show up on every run.
async function openPermissionsAndAlertsWithFreshPermissions(device: Device, screen: Screen): Promise<void> {
  await device.terminateApp(PLAYGROUND_APP).catch(() => {});
  await device.clearAppData(PLAYGROUND_APP);
  await device.launchApp(PLAYGROUND_APP);
  await screen.getByText('Permissions and Alerts').tap();
}

function alertResult(screen: Screen) {
  return screen.getByLabel('alert_result');
}

function permissionStatus(screen: Screen, permission: 'camera' | 'location' | 'notifications') {
  return screen.getByLabel(`${permission}_permission_status`);
}

async function pressButton(screen: Screen, testLabel: string): Promise<void> {
  await screen.getByLabel(testLabel).tap();
}

function recordDialogs(screen: Screen, respond: (dialog: Dialog) => Promise<void>): Dialog[] {
  const seen: Dialog[] = [];
  screen.on('dialog', async (dialog) => {
    seen.push(dialog);
    await respond(dialog);
  });
  return seen;
}

// Dialogs are spotted while the screen is polled; poll until `count` dialogs were seen.
async function waitUntilDialogsSeen(screen: Screen, dialogs: Dialog[], count: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (dialogs.length < count) {
    if (Date.now() > deadline) {
      throw new Error(`expected ${count} dialog(s), saw ${dialogs.length}`);
    }
    await screen.viewTree();
  }
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

test('dismissing the camera prompt denies the camera', async ({ screen }) => {
  const dialogs = recordDialogs(screen, (dialog) => dialog.dismiss());
  await pressButton(screen, 'request_camera_permission_button');
  await waitUntilDialogsSeen(screen, dialogs, 1);
  await expect(screen.getByText('Don’t allow')).toBeHidden();
  await expect(permissionStatus(screen, 'camera')).toHaveText('Not Granted');
});

test('accepting the notifications prompt grants notifications', async ({ screen }) => {
  recordDialogs(screen, (dialog) => dialog.accept());
  await pressButton(screen, 'request_notifications_permission_button');
  await expect(permissionStatus(screen, 'notifications')).toHaveText('Granted');
});
