import { test, expect } from '@playwright/test';
import type { MobilewrightDriver, ViewNode } from '@mobilewright/protocol';
import { Screen } from './screen.js';
import type { Dialog } from './dialog.js';

type FakeDevice = {
  driver: MobilewrightDriver;
  taps: Array<[number, number]>;
  typed: string[];
  show: (tree: ViewNode[]) => void;
};

type NodeSpec = { type?: string; identifier?: string; text?: string; label?: string; y?: number };

// ─── View-tree builders, shaped like mobilecli's Android dump ───────────

const TEXT_FIELD_Y = 50;

function node(spec: NodeSpec, children: ViewNode[] = []): ViewNode {
  return {
    type: spec.type ?? 'android.widget.FrameLayout',
    identifier: spec.identifier,
    text: spec.text,
    label: spec.label,
    isVisible: true,
    isEnabled: true,
    bounds: { x: 0, y: spec.y ?? 0, width: 100, height: 50 },
    children,
  };
}

function button(identifier: string, text: string, y: number): ViewNode {
  return node({ type: 'android.widget.Button', identifier, text, y });
}

function appScreenWithButton(text: string): ViewNode[] {
  return [node({ identifier: 'android:id/content' }, [button('com.example:id/go', text, 900)])];
}

function confirmAlert(): ViewNode[] {
  return [node({ identifier: 'android:id/content' }, [
    node({ type: 'android.widget.TextView', identifier: 'com.example:id/alertTitle', text: 'Confirm Alert' }),
    node({ type: 'android.widget.TextView', identifier: 'android:id/message', text: 'Do you want to continue?' }),
    button('android:id/button2', 'CANCEL', 100),
    button('android:id/button1', 'OK', 200),
  ])];
}

function simpleAlert(): ViewNode[] {
  return [node({ identifier: 'android:id/content' }, [
    node({ type: 'android.widget.TextView', identifier: 'com.example:id/alertTitle', text: 'Simple Alert' }),
    button('android:id/button1', 'OK', 200),
  ])];
}

function listDialogWithCancel(): ViewNode[] {
  return [node({ identifier: 'android:id/content' }, [
    node({ type: 'android.widget.TextView', identifier: 'com.example:id/alertTitle', text: 'Choose a Color' }),
    node({ type: 'android.widget.ListView', identifier: 'com.example:id/select_dialog_listview' }, [
      node({ type: 'android.widget.TextView', identifier: 'android:id/text1', text: 'Red', y: 100 }),
      node({ type: 'android.widget.TextView', identifier: 'android:id/text1', text: 'Green', y: 150 }),
    ]),
    button('android:id/button2', 'CANCEL', 300),
  ])];
}

function promptAlert(okButtonY = 200): ViewNode[] {
  return [node({ identifier: 'android:id/content' }, [
    node({ type: 'android.widget.TextView', identifier: 'com.example:id/alertTitle', text: 'Prompt Alert' }),
    node({ type: 'android.widget.EditText', label: 'prompt_alert_input', y: TEXT_FIELD_Y }),
    button('android:id/button2', 'CANCEL', 100),
    button('android:id/button1', 'OK', okButtonY),
  ])];
}

function promptAlertPushedUpByKeyboard(): ViewNode[] {
  return promptAlert(150);
}

function locationPermissionDialog(): ViewNode[] {
  const id = (name: string) => `com.android.permissioncontroller:id/${name}`;
  return [node({ identifier: 'android:id/content' }, [
    node({ type: 'android.widget.TextView', identifier: id('permission_message'), text: 'Allow Playground to access this device’s location?' }),
    node({ type: 'android.widget.RadioButton', identifier: id('permission_location_accuracy_radio_fine'), text: 'Precise' }),
    button(id('permission_allow_foreground_only_button'), 'While using the app', 100),
    button(id('permission_allow_one_time_button'), 'Only this time', 200),
    button(id('permission_deny_button'), 'Don’t allow', 300),
  ])];
}

function centerOfButtonAt(y: number): [number, number] {
  return [50, y + 25];
}

// ─── Fake device: shows a tree; a tap on anything but the text field closes a dialog ───

function createFakeDevice(initial: ViewNode[]): FakeDevice {
  let tree = initial;
  const taps: Array<[number, number]> = [];
  const typed: string[] = [];
  const driver = {
    getViewHierarchy: async () => tree,
    tap: async (x: number, y: number) => {
      taps.push([x, y]);
      if (y !== centerOfButtonAt(TEXT_FIELD_Y)[1]) {
        tree = appScreenWithButton('Continue');
      }
    },
    typeText: async (text: string) => { typed.push(text); },
  } as unknown as MobilewrightDriver;
  return { driver, taps, typed, show: (t) => { tree = t; } };
}

async function firstDialogSeenBy(screen: Screen): Promise<Dialog> {
  let seen: Dialog | undefined;
  screen.once('dialog', (dialog) => { seen = dialog; });
  await screen.getByText('anything').isVisible();
  if (!seen) {
    throw new Error('no dialog event fired');
  }
  return seen;
}

// ─── Detection ──────────────────────────────────────────────────

test.describe('dialog detection', () => {
  test('reads an app confirm alert', async () => {
    const screen = new Screen(createFakeDevice(confirmAlert()).driver);
    const dialog = await firstDialogSeenBy(screen);
    expect(dialog.type()).toBe('confirm');
    expect(dialog.isSystem()).toBe(false);
    expect(dialog.title()).toBe('Confirm Alert');
    expect(dialog.message()).toBe('Do you want to continue?');
    expect(dialog.buttons()).toEqual(['CANCEL', 'OK']);
  });

  test('a single-button alert is of type alert', async () => {
    const screen = new Screen(createFakeDevice(simpleAlert()).driver);
    expect((await firstDialogSeenBy(screen)).type()).toBe('alert');
  });

  test('an alert with a text field is of type prompt', async () => {
    const screen = new Screen(createFakeDevice(promptAlert()).driver);
    expect((await firstDialogSeenBy(screen)).type()).toBe('prompt');
  });

  test('reads a system permission dialog', async () => {
    const screen = new Screen(createFakeDevice(locationPermissionDialog()).driver);
    const dialog = await firstDialogSeenBy(screen);
    expect(dialog.type()).toBe('permission');
    expect(dialog.isSystem()).toBe(true);
    expect(dialog.message()).toBe('Allow Playground to access this device’s location?');
    expect(dialog.buttons()).toEqual(['While using the app', 'Only this time', 'Don’t allow']);
  });
});

// ─── Responding ──────────────────────────────────────────────────

test.describe('responding to a dialog', () => {
  test('accept presses the positive button', async () => {
    const device = createFakeDevice(confirmAlert());
    await (await firstDialogSeenBy(new Screen(device.driver))).accept();
    expect(device.taps).toEqual([centerOfButtonAt(200)]);
  });

  test('dismiss presses the negative button', async () => {
    const device = createFakeDevice(confirmAlert());
    await (await firstDialogSeenBy(new Screen(device.driver))).dismiss();
    expect(device.taps).toEqual([centerOfButtonAt(100)]);
  });

  test('dismiss presses the only button of a single-button alert', async () => {
    const device = createFakeDevice(simpleAlert());
    await (await firstDialogSeenBy(new Screen(device.driver))).dismiss();
    expect(device.taps).toEqual([centerOfButtonAt(200)]);
  });

  test('accept on a prompt types the text before pressing OK', async () => {
    const device = createFakeDevice(promptAlert());
    await (await firstDialogSeenBy(new Screen(device.driver))).accept('Gil');
    expect(device.typed).toEqual(['Gil']);
    expect(device.taps.at(-1)).toEqual(centerOfButtonAt(200));
  });

  test('accept on a prompt presses OK where it is after the keyboard moved it', async () => {
    const device = createFakeDevice(promptAlert());
    const dialog = await firstDialogSeenBy(new Screen(device.driver));
    device.show(promptAlertPushedUpByKeyboard());
    await dialog.accept('Gil');
    expect(device.taps.at(-1)).toEqual(centerOfButtonAt(150));
  });

  test('accept on a permission dialog allows while using the app', async () => {
    const device = createFakeDevice(locationPermissionDialog());
    await (await firstDialogSeenBy(new Screen(device.driver))).accept();
    expect(device.taps).toEqual([centerOfButtonAt(100)]);
  });

  test('dismiss on a permission dialog denies', async () => {
    const device = createFakeDevice(locationPermissionDialog());
    await (await firstDialogSeenBy(new Screen(device.driver))).dismiss();
    expect(device.taps).toEqual([centerOfButtonAt(300)]);
  });

  test('tap presses a button by caption, ignoring case', async () => {
    const device = createFakeDevice(confirmAlert());
    await (await firstDialogSeenBy(new Screen(device.driver))).tap('Cancel');
    expect(device.taps).toEqual([centerOfButtonAt(100)]);
  });

  test('tap on a missing caption lists the available buttons', async () => {
    const dialog = await firstDialogSeenBy(new Screen(createFakeDevice(confirmAlert()).driver));
    await expect(dialog.tap('Maybe')).rejects.toThrow('Buttons: ["CANCEL","OK"]');
  });
});

// ─── Screen integration ──────────────────────────────────────────

test.describe('screen.on(dialog)', () => {
  test('a dialog covering the target is handled and the tap goes through', async () => {
    const device = createFakeDevice(confirmAlert());
    const screen = new Screen(device.driver, { timeout: 1000, pollInterval: 10 });
    screen.on('dialog', (dialog) => dialog.dismiss());
    await screen.getByText('Continue').tap();
    expect(device.taps).toEqual([centerOfButtonAt(100), centerOfButtonAt(900)]);
  });

  test('an action sheet (a list dialog) is not reported, so a blanket handler leaves it alone', async () => {
    const device = createFakeDevice(listDialogWithCancel());
    const screen = new Screen(device.driver);
    let events = 0;
    screen.on('dialog', async (dialog) => {
      events++;
      await dialog.accept();
    });
    expect(await screen.getByText('Red').isVisible()).toBe(true);
    expect(events).toBe(0);
    expect(device.taps).toEqual([]);
  });

  test('without a listener the dialog is left alone', async () => {
    const device = createFakeDevice(confirmAlert());
    const screen = new Screen(device.driver);
    expect(await screen.getByText('OK').isVisible()).toBe(true);
    expect(device.taps).toEqual([]);
  });

  test('the same dialog is reported once, not on every poll', async () => {
    const device = createFakeDevice(confirmAlert());
    const screen = new Screen(device.driver);
    let events = 0;
    screen.on('dialog', () => { events++; });
    await screen.getByText('OK').isVisible();
    await screen.getByText('OK').isVisible();
    expect(events).toBe(1);
  });

  test('the same dialog showing again after it closed is reported again', async () => {
    const device = createFakeDevice(confirmAlert());
    const screen = new Screen(device.driver);
    let events = 0;
    screen.on('dialog', () => { events++; });
    await screen.getByText('OK').isVisible();
    device.show(appScreenWithButton('Continue'));
    await screen.getByText('Continue').isVisible();
    device.show(confirmAlert());
    await screen.getByText('OK').isVisible();
    expect(events).toBe(2);
  });

  test('off stops reporting dialogs', async () => {
    const screen = new Screen(createFakeDevice(confirmAlert()).driver);
    let events = 0;
    const handler = () => { events++; };
    screen.on('dialog', handler);
    screen.off('dialog', handler);
    await screen.getByText('OK').isVisible();
    expect(events).toBe(0);
  });
});
