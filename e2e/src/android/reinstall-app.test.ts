import { homedir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@mobilewright/test';
import type { Locator, Screen } from '@mobilewright/core';

// Proves reinstallApp gives a fresh install: the playground's SharedPref screen persists a
// username across relaunches, and only an uninstall wipes it. Android only — on iOS the
// playground stores these in the keychain, which survives an uninstall.
const PLAYGROUND_APK = join(homedir(), 'git/playground/android/app/build/outputs/apk/debug/app-debug.apk');
const USERNAME = 'reinstall-me';

test.use({ platform: 'android', bundleId: 'com.mobilenext.playground', installApps: PLAYGROUND_APK });
// Serial on one worker: the pool hands the released emulator back to the next test, so saved
// preferences carry across tests. This assumes a single matching Android device, as in CI.
test.describe.configure({ mode: 'serial' });

async function openSharedPrefScreen(screen: Screen): Promise<void> {
  await screen.getByText('SharedPref / Keychain').tap();
  await expect(screen.getByLabel('load_button')).toBeVisible();
}

async function loadAndReadStatus(screen: Screen): Promise<Locator> {
  await screen.getByLabel('load_button').tap();
  return screen.getByLabel('status_message');
}

test('saves a username into shared preferences', async ({ screen }) => {
  await openSharedPrefScreen(screen);
  await screen.getByLabel('username_field').fill(USERNAME);
  await screen.getByLabel('save_button').tap();
  await expect(screen.getByLabel('status_message')).toHaveText('Saved');
});

test('a relaunch keeps the saved username', async ({ screen }) => {
  await openSharedPrefScreen(screen);
  const status = await loadAndReadStatus(screen);
  await expect(status).toHaveText('Loaded');
  await expect(screen.getByLabel('username_field')).toHaveText(USERNAME);
});

test.describe('with reinstallApp', () => {
  test.use({ reinstallApp: true });

  test('a reinstall wipes the saved username', async ({ screen }) => {
    await openSharedPrefScreen(screen);
    const status = await loadAndReadStatus(screen);
    await expect(status).toHaveText('No preferences found');
  });
});
