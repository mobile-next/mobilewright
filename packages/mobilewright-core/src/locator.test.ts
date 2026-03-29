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
import { Locator, LocatorError } from './locator.js';

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

test.describe('Locator', () => {
  const hierarchy: ViewNode[] = [
    node({
      type: 'Window',
      children: [
        node({
          type: 'Button',
          label: 'Submit',
          identifier: 'submitBtn',
          bounds: { x: 20, y: 100, width: 200, height: 50 },
        }),
        node({
          type: 'TextField',
          label: 'Email',
          identifier: 'emailField',
          bounds: { x: 20, y: 200, width: 350, height: 44 },
        }),
        node({
          type: 'Button',
          label: 'Cancel',
          identifier: 'cancelBtn',
          isEnabled: false,
          bounds: { x: 20, y: 300, width: 200, height: 50 },
        }),
      ],
    }),
  ];

  test.describe('tap', () => {
    test('taps at center of matched element', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, {
        kind: 'label',
        value: 'Submit',
      });

      await locator.tap();

      expect(driver._tracker.tapCalls).toEqual([[120, 125]]);
    });

    test('throws LocatorError when element not found', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, {
        kind: 'label',
        value: 'Nonexistent',
      }, { timeout: 200 });

      await expect(locator.tap()).rejects.toThrow(LocatorError);
    });
  });

  test.describe('fill', () => {
    test('taps to focus then types text', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, {
        kind: 'testId',
        value: 'emailField',
      });

      await locator.fill('test@example.com');

      expect(driver._tracker.tapCalls).toEqual([[195, 222]]);
      expect(driver._tracker.typeTextCalls).toEqual([['test@example.com']]);
    });
  });

  test.describe('auto-waiting', () => {
    test('waits for element to become visible', async () => {
      const hiddenNode = node({
        type: 'Button',
        label: 'Delayed',
        identifier: 'delayedBtn',
        isVisible: false,
        bounds: { x: 10, y: 10, width: 100, height: 40 },
      });

      const visibleNode = { ...hiddenNode, isVisible: true };
      const tree = [node({ type: 'Window', children: [hiddenNode] })];
      const treeVisible = [
        node({ type: 'Window', children: [visibleNode] }),
      ];

      const driver = createMockDriver(tree);
      let callCount = 0;
      (driver as any).getViewHierarchy = async () => {
        callCount++;
        return callCount >= 3 ? treeVisible : tree;
      };

      const locator = new Locator(driver, {
        kind: 'testId',
        value: 'delayedBtn',
      }, { timeout: 2000, pollInterval: 10, stabilityDelay: 10 });

      await locator.tap();
      expect(driver._tracker.tapCalls.length).toBeGreaterThan(0);
    });

    test('rejects action on disabled element after timeout', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, {
        kind: 'testId',
        value: 'cancelBtn',
      }, { timeout: 200 });

      await expect(locator.tap()).rejects.toThrow(/not enabled/);
    });
  });

  test.describe('waitFor', () => {
    test('resolves immediately when element is already visible', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, {
        kind: 'label',
        value: 'Submit',
      });

      await locator.waitFor({ state: 'visible' });
      const text = await locator.getText({ timeout: 0 });
      expect(text).toBe('Submit');
    });

    test('waits for hidden state', async () => {
      const emptyTree: ViewNode[] = [
        node({ type: 'Window', children: [] }),
      ];
      const driver = createMockDriver(hierarchy);
      let callCount = 0;
      (driver as any).getViewHierarchy = async () => {
        callCount++;
        return callCount >= 2 ? emptyTree : hierarchy;
      };

      const locator = new Locator(driver, {
        kind: 'label',
        value: 'Submit',
      }, { timeout: 2000, pollInterval: 10 });

      // waitFor hidden should resolve once the element disappears
      await locator.waitFor({ state: 'hidden' });
    });
  });

  test.describe('getText', () => {
    test('returns text/label/value of matched element', async () => {
      const treeWithText: ViewNode[] = [
        node({
          type: 'Window',
          children: [
            node({
              type: 'StaticText',
              label: 'Welcome',
              text: 'Welcome back!',
              bounds: { x: 10, y: 10, width: 200, height: 30 },
            }),
          ],
        }),
      ];
      const driver = createMockDriver(treeWithText);
      const locator = new Locator(driver, {
        kind: 'label',
        value: 'Welcome',
      });

      const text = await locator.getText();
      expect(text).toBe('Welcome back!');
    });
  });

  test.describe('chaining', () => {
    test('supports chained locators', async () => {
      const treeWithList: ViewNode[] = [
        node({
          type: 'Window',
          children: [
            node({
              type: 'Table',
              identifier: 'list1',
              children: [
                node({
                  type: 'Cell',
                  label: 'Item 1',
                  bounds: { x: 0, y: 0, width: 390, height: 44 },
                }),
                node({
                  type: 'Cell',
                  label: 'Item 2',
                  bounds: { x: 0, y: 44, width: 390, height: 44 },
                }),
              ],
            }),
          ],
        }),
      ];

      const driver = createMockDriver(treeWithList);
      const locator = new Locator(driver, {
        kind: 'testId',
        value: 'list1',
      }).getByLabel('Item 2');

      await locator.tap();
      expect(driver._tracker.tapCalls).toEqual([[195, 66]]);
    });
  });
});
