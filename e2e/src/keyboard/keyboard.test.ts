import { test, expect } from '@mobilewright/test';
import type { Device, Screen } from 'mobilewright';

const PLAYGROUND_APP = 'com.mobilenext.playground';

async function openBasicUiScreen(device: Device, screen: Screen): Promise<void> {
  await device.terminateApp(PLAYGROUND_APP).catch(() => {});
  await device.launchApp(PLAYGROUND_APP);
  await screen.getByText('Basic UI').tap();
  await expect(textField(screen)).toBeVisible();
}

function textField(screen: Screen) {
  return screen.getByTestId('text_field');
}

async function focusTextFieldAndWaitForKeyboard(screen: Screen): Promise<void> {
  await textField(screen).tap();
  await expect.poll(() => screen.keyboard.isVisible()).toBe(true);
}

test.beforeEach(async ({ device, screen }) => {
  await openBasicUiScreen(device, screen);
});

test('isVisible is false when no field is focused', async ({ screen }) => {
  const visible = await screen.keyboard.isVisible();

  expect(visible).toBe(false);
});

test('isVisible is true when a text field is focused', async ({ screen }) => {
  await focusTextFieldAndWaitForKeyboard(screen);

  const visible = await screen.keyboard.isVisible();

  expect(visible).toBe(true);
});

test('hide closes the keyboard', async ({ screen }) => {
  await focusTextFieldAndWaitForKeyboard(screen);

  await screen.keyboard.hide();

  const visible = await screen.keyboard.isVisible();

  expect(visible).toBe(false);
});

test('hide with no keyboard showing stays on the same screen', async ({ screen }) => {
  await screen.keyboard.hide();

  await expect(textField(screen)).toBeVisible();
});

test('a tap straight after hide lands on the app, not the keyboard', async ({ screen }) => {
  await focusTextFieldAndWaitForKeyboard(screen);

  await screen.keyboard.hide();
  await screen.getByTestId('picker').tap();

  await expect(screen.getByText('Option B')).toBeVisible();
});
