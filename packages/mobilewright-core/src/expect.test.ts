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
