import { test, expect } from '@playwright/test';
import type { MobilewrightDriver } from '@mobilewright/protocol';
import { Keyboard } from './keyboard.js';

type FakeKeyboardDriver = Pick<MobilewrightDriver, 'isKeyboardVisible' | 'hideKeyboard'>;

function keyboardOn(driver: FakeKeyboardDriver, stepTitles: string[] = []): Keyboard {
  return new Keyboard(driver as MobilewrightDriver, (title, fn) => {
    stepTitles.push(title);
    return fn();
  });
}

function driverWithVisibleKeyboard(): FakeKeyboardDriver {
  return { isKeyboardVisible: async () => true, hideKeyboard: async () => {} };
}

function driverThatCannotCloseTheKeyboard(): FakeKeyboardDriver {
  return {
    isKeyboardVisible: async () => true,
    hideKeyboard: async () => { throw new Error('keyboard is still visible after 5s'); },
  };
}

test('isVisible reports what the driver sees', async () => {
  expect(await keyboardOn(driverWithVisibleKeyboard()).isVisible()).toBe(true);
});

test('hide fails when the keyboard stays up', async () => {
  await expect(keyboardOn(driverThatCannotCloseTheKeyboard()).hide()).rejects.toThrow('still visible');
});

test('each keyboard action is reported as a step', async () => {
  const stepTitles: string[] = [];
  const keyboard = keyboardOn(driverWithVisibleKeyboard(), stepTitles);

  await keyboard.isVisible();
  await keyboard.hide();

  expect(stepTitles).toEqual(['keyboard.isVisible()', 'keyboard.hide()']);
});
