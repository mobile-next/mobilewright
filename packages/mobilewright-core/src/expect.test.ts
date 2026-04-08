import { test, expect } from '@playwright/test';
import type {
  MobilewrightDriver,
  ViewNode,
  Session,
  Orientation,
  ScreenSize,
  AppInfo,
  DeviceInfo,
} from '@mobilewright/protocol';
import { Locator } from './locator.js';
import { expect as mwExpect, ExpectError } from './expect.js';

function node(
  overrides: Partial<ViewNode> & { type: string },
): ViewNode {
  return {
    isVisible: true,
    isEnabled: true,
    bounds: { x: 0, y: 0, width: 100, height: 44 },
    children: [],
    ...overrides,
  };
}

type CallTracker = {
  tapCalls: any[][];
  doubleTapCalls: any[][];
  longPressCalls: any[][];
  typeTextCalls: any[][];
  swipeCalls: any[][];
  gestureCalls: any[][];
  pressButtonCalls: any[][];
  setOrientationCalls: any[][];
  launchAppCalls: any[][];
  terminateAppCalls: any[][];
  installAppCalls: any[][];
  uninstallAppCalls: any[][];
  openUrlCalls: any[][];
};

function createMockDriver(hierarchy: ViewNode[]): MobilewrightDriver & { _tracker: CallTracker, _setHierarchy: (h: ViewNode[]) => void } {
  let currentHierarchy = hierarchy;
  const tracker: CallTracker = {
    tapCalls: [],
    doubleTapCalls: [],
    longPressCalls: [],
    typeTextCalls: [],
    swipeCalls: [],
    gestureCalls: [],
    pressButtonCalls: [],
    setOrientationCalls: [],
    launchAppCalls: [],
    terminateAppCalls: [],
    installAppCalls: [],
    uninstallAppCalls: [],
    openUrlCalls: [],
  };

  return {
    _tracker: tracker,
    _setHierarchy: (h: ViewNode[]) => { currentHierarchy = h; },
    connect: async () => ({ deviceId: 'device1', platform: 'ios' as const }),
    disconnect: async () => {},
    getViewHierarchy: async () => currentHierarchy,
    tap: async (...args: any[]) => { tracker.tapCalls.push(args); },
    doubleTap: async (...args: any[]) => { tracker.doubleTapCalls.push(args); },
    longPress: async (...args: any[]) => { tracker.longPressCalls.push(args); },
    typeText: async (...args: any[]) => { tracker.typeTextCalls.push(args); },
    swipe: async (...args: any[]) => { tracker.swipeCalls.push(args); },
    gesture: async (...args: any[]) => { tracker.gestureCalls.push(args); },
    pressButton: async (...args: any[]) => { tracker.pressButtonCalls.push(args); },
    screenshot: async () => Buffer.from(''),
    getScreenSize: async () => ({ width: 390, height: 844 }),
    getOrientation: async () => 'portrait' as Orientation,
    setOrientation: async (...args: any[]) => { tracker.setOrientationCalls.push(args); },
    launchApp: async (...args: any[]) => { tracker.launchAppCalls.push(args); },
    terminateApp: async (...args: any[]) => { tracker.terminateAppCalls.push(args); },
    listApps: async () => [] as AppInfo[],
    getForegroundApp: async () => ({ bundleId: 'com.test' }),
    installApp: async (...args: any[]) => { tracker.installAppCalls.push(args); },
    uninstallApp: async (...args: any[]) => { tracker.uninstallAppCalls.push(args); },
    listDevices: async () => [] as DeviceInfo[],
    openUrl: async (...args: any[]) => { tracker.openUrlCalls.push(args); },
    startRecording: async () => {},
    stopRecording: async () => ({ output: '' }),
  };
}

const hierarchy: ViewNode[] = [
  node({
    type: 'Window',
    children: [
      node({
        type: 'StaticText',
        label: 'Welcome',
        text: 'Welcome back!',
        identifier: 'welcomeText',
        bounds: { x: 10, y: 10, width: 200, height: 30 },
      }),
      node({
        type: 'Button',
        label: 'Submit',
        identifier: 'submitBtn',
        bounds: { x: 20, y: 100, width: 200, height: 50 },
      }),
      node({
        type: 'Button',
        label: 'Hidden',
        identifier: 'hiddenBtn',
        isVisible: false,
        bounds: { x: 20, y: 200, width: 200, height: 50 },
      }),
    ],
  }),
];

test.describe('expect', () => {
  test.describe('toBeVisible', () => {
    test('passes when element is visible', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, {
        kind: 'testId',
        value: 'submitBtn',
      });

      await mwExpect(locator).toBeVisible();
    });

    test('fails when element is not visible', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, {
        kind: 'testId',
        value: 'hiddenBtn',
      });

      await expect(
        mwExpect(locator).toBeVisible({ timeout: 200 }),
      ).rejects.toThrow(ExpectError);
    });
  });

  test.describe('not.toBeVisible', () => {
    test('passes when element is not visible', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, {
        kind: 'testId',
        value: 'hiddenBtn',
      });

      await mwExpect(locator).not.toBeVisible();
    });

    test('passes when element does not exist', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, {
        kind: 'testId',
        value: 'nonExistent',
      });

      await mwExpect(locator).not.toBeVisible();
    });
  });

  test.describe('toHaveText', () => {
    test('passes with exact text match', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, {
        kind: 'testId',
        value: 'welcomeText',
      });

      await mwExpect(locator).toHaveText('Welcome back!');
    });

    test('passes with regex match', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, {
        kind: 'testId',
        value: 'welcomeText',
      });

      await mwExpect(locator).toHaveText(/welcome/i);
    });

    test('fails with wrong text', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, {
        kind: 'testId',
        value: 'welcomeText',
      });

      await expect(
        mwExpect(locator).toHaveText('Wrong text', { timeout: 200 }),
      ).rejects.toThrow(ExpectError);
    });
  });

  test.describe('toContainText', () => {
    test('passes when text contains substring', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, {
        kind: 'testId',
        value: 'welcomeText',
      });

      await mwExpect(locator).toContainText('back');
    });
  });

  test.describe('toBeEnabled', () => {
    test('passes when element is enabled', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, {
        kind: 'testId',
        value: 'submitBtn',
      });

      await mwExpect(locator).toBeEnabled();
    });
  });

  test.describe('toBeDisabled', () => {
    test('passes when element is disabled', async () => {
      const disabledTree: ViewNode[] = [
        node({
          type: 'Window',
          children: [
            node({
              type: 'Button',
              label: 'Submit',
              identifier: 'disabledBtn',
              isEnabled: false,
              bounds: { x: 20, y: 100, width: 200, height: 50 },
            }),
          ],
        }),
      ];
      const driver = createMockDriver(disabledTree);
      const locator = new Locator(driver, { kind: 'testId', value: 'disabledBtn' });
      await mwExpect(locator).toBeDisabled();
    });

    test('fails when element is enabled', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, { kind: 'testId', value: 'submitBtn' });
      await expect(
        mwExpect(locator).toBeDisabled({ timeout: 200 }),
      ).rejects.toThrow(ExpectError);
    });
  });

  test.describe('toBeSelected', () => {
    test('passes when element is selected', async () => {
      const selectedTree: ViewNode[] = [
        node({
          type: 'Window',
          children: [
            node({
              type: 'Tab',
              label: 'Home',
              identifier: 'homeTab',
              isSelected: true,
              bounds: { x: 0, y: 0, width: 100, height: 44 },
            }),
          ],
        }),
      ];
      const driver = createMockDriver(selectedTree);
      const locator = new Locator(driver, { kind: 'testId', value: 'homeTab' });
      await mwExpect(locator).toBeSelected();
    });
  });

  test.describe('toBeFocused', () => {
    test('passes when element is focused', async () => {
      const focusedTree: ViewNode[] = [
        node({
          type: 'Window',
          children: [
            node({
              type: 'TextField',
              label: 'Email',
              identifier: 'emailField',
              isFocused: true,
              bounds: { x: 0, y: 0, width: 300, height: 44 },
            }),
          ],
        }),
      ];
      const driver = createMockDriver(focusedTree);
      const locator = new Locator(driver, { kind: 'testId', value: 'emailField' });
      await mwExpect(locator).toBeFocused();
    });
  });

  test.describe('toBeHidden', () => {
    test('passes when element is not visible', async () => {
      const hiddenTree: ViewNode[] = [
        node({
          type: 'Window',
          children: [
            node({
              type: 'Button',
              label: 'Secret',
              identifier: 'secretBtn',
              isVisible: false,
              bounds: { x: 0, y: 0, width: 100, height: 44 },
            }),
          ],
        }),
      ];
      const driver = createMockDriver(hiddenTree);
      const locator = new Locator(driver, { kind: 'testId', value: 'secretBtn' });
      await mwExpect(locator).toBeHidden();
    });

    test('passes when element does not exist', async () => {
      const emptyTree: ViewNode[] = [
        node({ type: 'Window', children: [] }),
      ];
      const driver = createMockDriver(emptyTree);
      const locator = new Locator(driver, { kind: 'testId', value: 'nonexistent' });
      await mwExpect(locator).toBeHidden();
    });

    test('fails when element is visible', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, { kind: 'label', value: 'Submit' });
      await expect(mwExpect(locator).toBeHidden({ timeout: 200 })).rejects.toThrow(
        /Expected element to be hidden/,
      );
    });
  });

  test.describe('toBeChecked', () => {
    test('passes when element is checked', async () => {
      const checkedTree: ViewNode[] = [
        node({
          type: 'Window',
          children: [
            node({
              type: 'Checkbox',
              label: 'Agree',
              identifier: 'agreeCheck',
              isChecked: true,
              bounds: { x: 0, y: 0, width: 44, height: 44 },
            }),
          ],
        }),
      ];
      const driver = createMockDriver(checkedTree);
      const locator = new Locator(driver, { kind: 'testId', value: 'agreeCheck' });
      await mwExpect(locator).toBeChecked();
    });

    test('not.toBeChecked passes when unchecked', async () => {
      const uncheckedTree: ViewNode[] = [
        node({
          type: 'Window',
          children: [
            node({
              type: 'Checkbox',
              label: 'Agree',
              identifier: 'agreeCheck',
              isChecked: false,
              bounds: { x: 0, y: 0, width: 44, height: 44 },
            }),
          ],
        }),
      ];
      const driver = createMockDriver(uncheckedTree);
      const locator = new Locator(driver, { kind: 'testId', value: 'agreeCheck' });
      await mwExpect(locator).not.toBeChecked();
    });
  });

  test.describe('toHaveValue', () => {
    test('passes with exact value match', async () => {
      const valueTree: ViewNode[] = [
        node({
          type: 'Window',
          children: [
            node({
              type: 'Slider',
              label: 'Volume',
              identifier: 'volumeSlider',
              value: '75%',
              bounds: { x: 0, y: 0, width: 300, height: 44 },
            }),
          ],
        }),
      ];
      const driver = createMockDriver(valueTree);
      const locator = new Locator(driver, { kind: 'testId', value: 'volumeSlider' });
      await mwExpect(locator).toHaveValue('75%');
    });

    test('passes with regex value match', async () => {
      const valueTree: ViewNode[] = [
        node({
          type: 'Window',
          children: [
            node({
              type: 'Slider',
              label: 'Volume',
              identifier: 'volumeSlider',
              value: '75%',
              bounds: { x: 0, y: 0, width: 300, height: 44 },
            }),
          ],
        }),
      ];
      const driver = createMockDriver(valueTree);
      const locator = new Locator(driver, { kind: 'testId', value: 'volumeSlider' });
      await mwExpect(locator).toHaveValue(/\d+%/);
    });
  });

  test.describe('auto-retry', () => {
    test('retries until assertion passes', async () => {
      const initialTree: ViewNode[] = [
        node({
          type: 'Window',
          children: [
            node({
              type: 'StaticText',
              label: 'Status',
              identifier: 'status',
              text: 'Loading...',
            }),
          ],
        }),
      ];
      const updatedTree: ViewNode[] = [
        node({
          type: 'Window',
          children: [
            node({
              type: 'StaticText',
              label: 'Status',
              identifier: 'status',
              text: 'Done!',
            }),
          ],
        }),
      ];

      let callCount = 0;
      const driver = createMockDriver(initialTree);
      // Override getViewHierarchy to switch after 3 calls
      (driver as any).getViewHierarchy = async () => {
        callCount++;
        return callCount >= 3 ? updatedTree : initialTree;
      };

      const locator = new Locator(driver, {
        kind: 'testId',
        value: 'status',
      });

      await mwExpect(locator).toHaveText('Done!', { timeout: 2000 });
    });
  });
});
