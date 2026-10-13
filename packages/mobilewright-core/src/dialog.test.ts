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

type NodeSpec = { type?: string; identifier?: string; text?: string; label?: string; x?: number; y?: number };

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
    bounds: { x: spec.x ?? 0, y: spec.y ?? 0, width: 100, height: 50 },
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

function centerOfButtonAt(y: number, x = 0): [number, number] {
  return [x + 50, y + 25];
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

// ─── iOS: view-tree builders, shaped like mobilecli's iOS dump ───────────

function iosButton(label: string, x: number, y: number): ViewNode {
  return node({ type: 'Button', label, x, y });
}

function iosAlert(title: string, message: string, children: ViewNode[]): ViewNode[] {
  return [node({ type: 'Application', label: 'Playground' }, [
    node({ type: 'Alert', label: title }, [
      node({ type: 'StaticText', label: title }),
      node({ type: 'StaticText', label: message }),
      ...children,
    ]),
  ])];
}

function iosConfirmAlert(): ViewNode[] {
  return iosAlert('Confirm Alert', 'Do you want to continue?', [iosButton('Cancel', 0, 300), iosButton('OK', 150, 300)]);
}

function iosThreeButtonAlert(): ViewNode[] {
  return iosAlert('Three Button Alert', 'Pick one of three options', [
    iosButton('Yes', 0, 100), iosButton('No', 0, 200), iosButton('Later', 0, 300),
  ]);
}

function iosPromptAlert(okButtonY = 300): ViewNode[] {
  return iosAlert('Prompt Alert', 'What is your name?', [
    node({ type: 'TextField', y: TEXT_FIELD_Y }),
    iosButton('Cancel', 0, okButtonY),
    iosButton('OK', 150, okButtonY),
  ]);
}

function iosCameraPermissionAlert(): ViewNode[] {
  return iosAlert('“Playground” would like to access the Camera.', 'Used to scan codes.', [
    iosButton('Don’t Allow', 0, 300), iosButton('Allow', 150, 300),
  ]);
}

function iosLocationPermissionAlert(): ViewNode[] {
  return iosAlert('Allow “Playground” to use your location?', 'Used to show your current location on a map.', [
    iosButton('Allow Once', 0, 100), iosButton('Allow While Using App', 0, 200), iosButton('Don’t Allow', 0, 300),
  ]);
}

function iosActionSheet(): ViewNode[] {
  return [node({ type: 'Application', label: 'Playground' }, [
    node({ type: 'Other', label: 'PopoverDismissRegion' }),
    node({ type: 'Sheet', label: 'Choose a Color' }, [
      node({ type: 'StaticText', label: 'Choose a Color' }),
      iosButton('Red', 0, 100), iosButton('Green', 0, 150), iosButton('Blue', 0, 200),
    ]),
  ])];
}

test.describe('iOS dialogs', () => {
  test('an action sheet is not reported', async () => {
    const device = createFakeDevice(iosActionSheet());
    const screen = new Screen(device.driver);
    let events = 0;
    screen.on('dialog', () => { events++; });
    expect(await screen.getByText('Red').isVisible()).toBe(true);
    expect(events).toBe(0);
  });

  test('reads an app confirm alert', async () => {
    const dialog = await firstDialogSeenBy(new Screen(createFakeDevice(iosConfirmAlert()).driver));
    expect(dialog.type()).toBe('confirm');
    expect(dialog.isSystem()).toBe(false);
    expect(dialog.title()).toBe('Confirm Alert');
    expect(dialog.message()).toBe('Do you want to continue?');
    expect(dialog.buttons()).toEqual(['Cancel', 'OK']);
  });

  test('side-by-side buttons: accept presses the right one, dismiss the left one', async () => {
    const accepting = createFakeDevice(iosConfirmAlert());
    await (await firstDialogSeenBy(new Screen(accepting.driver))).accept();
    expect(accepting.taps).toEqual([centerOfButtonAt(300, 150)]);

    const dismissing = createFakeDevice(iosConfirmAlert());
    await (await firstDialogSeenBy(new Screen(dismissing.driver))).dismiss();
    expect(dismissing.taps).toEqual([centerOfButtonAt(300)]);
  });

  test('stacked buttons: accept presses the top one, dismiss the bottom one', async () => {
    const accepting = createFakeDevice(iosThreeButtonAlert());
    await (await firstDialogSeenBy(new Screen(accepting.driver))).accept();
    expect(accepting.taps).toEqual([centerOfButtonAt(100)]);

    const dismissing = createFakeDevice(iosThreeButtonAlert());
    await (await firstDialogSeenBy(new Screen(dismissing.driver))).dismiss();
    expect(dismissing.taps).toEqual([centerOfButtonAt(300)]);
  });

  test('an alert with a text field is a prompt, and accept types into it', async () => {
    const device = createFakeDevice(iosPromptAlert());
    const dialog = await firstDialogSeenBy(new Screen(device.driver));
    expect(dialog.type()).toBe('prompt');
    device.show(iosPromptAlert(250));
    await dialog.accept('Gil');
    expect(device.typed).toEqual(['Gil']);
    expect(device.taps.at(-1)).toEqual(centerOfButtonAt(250, 150));
  });

  test('a camera permission alert is a system permission dialog', async () => {
    const device = createFakeDevice(iosCameraPermissionAlert());
    const dialog = await firstDialogSeenBy(new Screen(device.driver));
    expect(dialog.type()).toBe('permission');
    expect(dialog.isSystem()).toBe(true);
    expect(dialog.title()).toBe('“Playground” would like to access the Camera.');
    await dialog.accept();
    expect(device.taps).toEqual([centerOfButtonAt(300, 150)]);
  });

  test('accepting a location permission alert allows while using the app', async () => {
    const device = createFakeDevice(iosLocationPermissionAlert());
    await (await firstDialogSeenBy(new Screen(device.driver))).accept();
    expect(device.taps).toEqual([centerOfButtonAt(200)]);
  });

  test('dismissing a location permission alert does not allow', async () => {
    const device = createFakeDevice(iosLocationPermissionAlert());
    await (await firstDialogSeenBy(new Screen(device.driver))).dismiss();
    expect(device.taps).toEqual([centerOfButtonAt(300)]);
  });
});

// ─── waitForEvent ────────────────────────────────────────────────

function showLater(device: FakeDevice, tree: ViewNode[], ms: number): void {
  setTimeout(() => device.show(tree), ms);
}

test.describe('screen.waitForEvent(dialog)', () => {
  test('resolves with the dialog that opens after the call, polling the screen on its own', async () => {
    const device = createFakeDevice(appScreenWithButton('Continue'));
    const screen = new Screen(device.driver, { pollInterval: 10 });
    const dialogPromise = screen.waitForEvent('dialog');
    showLater(device, confirmAlert(), 50);
    const dialog = await dialogPromise;
    expect(dialog.title()).toBe('Confirm Alert');
  });

  test('leaves the dialog for the caller to answer', async () => {
    const device = createFakeDevice(confirmAlert());
    const screen = new Screen(device.driver, { pollInterval: 10 });
    const dialog = await screen.waitForEvent('dialog');
    expect(device.taps).toEqual([]);
    await dialog.dismiss();
    expect(device.taps).toEqual([centerOfButtonAt(100)]);
  });

  test('skips dialogs the predicate rejects', async () => {
    const device = createFakeDevice(simpleAlert());
    const screen = new Screen(device.driver, { pollInterval: 10 });
    const dialogPromise = screen.waitForEvent('dialog', (dialog) => dialog.type() === 'confirm');
    showLater(device, confirmAlert(), 50);
    expect((await dialogPromise).title()).toBe('Confirm Alert');
  });

  test('rejects when no dialog opens within the timeout', async () => {
    const screen = new Screen(createFakeDevice(appScreenWithButton('Continue')).driver, { pollInterval: 10 });
    await expect(screen.waitForEvent('dialog', { timeout: 100 })).rejects.toThrow('Timeout 100ms exceeded while waiting for event "dialog"');
  });

  test('other dialog listeners still see the dialog', async () => {
    const screen = new Screen(createFakeDevice(confirmAlert()).driver, { pollInterval: 10 });
    let events = 0;
    screen.on('dialog', () => { events++; });
    await screen.waitForEvent('dialog');
    expect(events).toBe(1);
  });
});
