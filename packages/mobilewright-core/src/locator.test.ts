import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import type {
  MobilewrightDriver,
  ViewNode,
  Orientation,
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
    getScreenSize: async () => ({ width: 390, height: 844, scale: 3 }),
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
    stopRecording: async () => ({}),
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

  test.describe('swipe', () => {
    test('swipes from element center in the given direction', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, { kind: 'label', value: 'Submit' });

      await locator.swipe({ direction: 'left' });

      expect(driver._tracker.swipeCalls).toEqual([['left', { startX: 120, startY: 125 }]]);
    });

    test('throws LocatorError when element not found', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, { kind: 'label', value: 'Nonexistent' }, { timeout: 200 });

      await expect(locator.swipe({ direction: 'left' })).rejects.toThrow(LocatorError);
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

    test('isVisible rethrows non-locator errors', async () => {
      const driver = createMockDriver([]);
      driver.getViewHierarchy = async () => {
        throw new Error('device disconnected');
      };

      const locator = new Locator(driver, { kind: 'testId', value: 'missing' });

      await expect(locator.isVisible()).rejects.toThrow('device disconnected');
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

  test.describe('collection methods', () => {
    const listTree: ViewNode[] = [
      node({
        type: 'Window',
        children: [
          node({ type: 'Cell', label: 'Apple', bounds: { x: 0, y: 0, width: 390, height: 44 } }),
          node({ type: 'Cell', label: 'Banana', bounds: { x: 0, y: 44, width: 390, height: 44 } }),
          node({ type: 'Cell', label: 'Cherry', bounds: { x: 0, y: 88, width: 390, height: 44 } }),
        ],
      }),
    ];

    test('count returns number of matching elements', async () => {
      const driver = createMockDriver(listTree);
      const locator = new Locator(driver, { kind: 'type', value: 'Cell' });

      const result = await locator.count();
      expect(result).toBe(3);
    });

    test('count returns zero when nothing matches', async () => {
      const driver = createMockDriver(listTree);
      const locator = new Locator(driver, { kind: 'type', value: 'Button' });

      const result = await locator.count();
      expect(result).toBe(0);
    });

    test('all returns a locator for each match', async () => {
      const driver = createMockDriver(listTree);
      const locator = new Locator(driver, { kind: 'type', value: 'Cell' });

      const locators = await locator.all();
      expect(locators).toHaveLength(3);

      const texts = await Promise.all(locators.map(l => l.getText()));
      expect(texts).toEqual(['Apple', 'Banana', 'Cherry']);
    });

    test('first returns the first match', async () => {
      const driver = createMockDriver(listTree);
      const locator = new Locator(driver, { kind: 'type', value: 'Cell' });

      const text = await locator.first().getText();
      expect(text).toBe('Apple');
    });

    test('last returns the last match', async () => {
      const driver = createMockDriver(listTree);
      const locator = new Locator(driver, { kind: 'type', value: 'Cell' });

      const text = await locator.last().getText();
      expect(text).toBe('Cherry');
    });

    test('nth returns the element at the given index', async () => {
      const driver = createMockDriver(listTree);
      const locator = new Locator(driver, { kind: 'type', value: 'Cell' });

      const text = await locator.nth(1).getText();
      expect(text).toBe('Banana');
    });

    test('nth supports negative indices', async () => {
      const driver = createMockDriver(listTree);
      const locator = new Locator(driver, { kind: 'type', value: 'Cell' });

      const text = await locator.nth(-2).getText();
      expect(text).toBe('Banana');
    });

    test('nth taps the correct element', async () => {
      const driver = createMockDriver(listTree);
      const locator = new Locator(driver, { kind: 'type', value: 'Cell' });

      await locator.nth(2).tap();
      expect(driver._tracker.tapCalls).toEqual([[195, 110]]);
    });
  });

  test.describe('filter / and / or', () => {
    const tree: ViewNode[] = [
      node({
        type: 'Window',
        children: [
          node({ type: 'Cell', label: 'Apple', text: 'Apple', bounds: { x: 0, y: 0, width: 390, height: 44 } }),
          node({ type: 'Cell', label: 'Banana', text: 'Banana', bounds: { x: 0, y: 44, width: 390, height: 44 } }),
          node({ type: 'Button', label: 'Apple', identifier: 'appleBtn', bounds: { x: 0, y: 88, width: 390, height: 44 } }),
        ],
      }),
    ];

    test('filter narrows by hasText', async () => {
      const driver = createMockDriver(tree);
      const cells = new Locator(driver, { kind: 'type', value: 'Cell' });

      const text = await cells.filter({ hasText: 'Banana' }).getText();
      expect(text).toBe('Banana');
    });

    test('and matches elements satisfying both locators', async () => {
      const driver = createMockDriver(tree);
      const byRole = new Locator(driver, { kind: 'role', value: 'button' });
      const byLabel = new Locator(driver, { kind: 'label', value: 'Apple' });

      const matched = byRole.and(byLabel);
      const count = await matched.count();
      const id = (await matched.all())[0];
      expect(count).toBe(1);
      expect(await id.getText()).toBe('Apple');
    });

    test('or matches elements satisfying either locator', async () => {
      const driver = createMockDriver(tree);
      const cells = new Locator(driver, { kind: 'type', value: 'Cell' });
      const buttons = new Locator(driver, { kind: 'role', value: 'button' });

      const count = await cells.or(buttons).count();
      expect(count).toBe(3);
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

  test.describe('doubleTap', () => {
    test('double-taps at the center of the matched element', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, { kind: 'label', value: 'Submit' });

      await locator.doubleTap();

      expect(driver._tracker.doubleTapCalls).toEqual([[120, 125]]);
    });

    test('throws LocatorError when element not found', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, { kind: 'label', value: 'Nonexistent' }, { timeout: 100 });

      await expect(locator.doubleTap()).rejects.toThrow(LocatorError);
    });
  });

  test.describe('longPress', () => {
    test('long-presses at the center of the matched element', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, { kind: 'label', value: 'Submit' });

      await locator.longPress();

      expect(driver._tracker.longPressCalls).toEqual([[120, 125, undefined]]);
    });

    test('passes duration through to the driver', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, { kind: 'label', value: 'Submit' });

      await locator.longPress({ duration: 1500 });

      expect(driver._tracker.longPressCalls).toEqual([[120, 125, 1500]]);
    });
  });

  test.describe('exists', () => {
    test('returns true when the element is present', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, { kind: 'label', value: 'Submit' });

      expect(await locator.exists()).toBe(true);
    });

    test('returns false when the element is absent', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, { kind: 'label', value: 'Nonexistent' });

      expect(await locator.exists()).toBe(false);
    });
  });

  test.describe('boolean state queries', () => {
    test('isEnabled returns true for an enabled element', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, { kind: 'label', value: 'Submit' });

      expect(await locator.isEnabled()).toBe(true);
    });

    test('isEnabled returns false for a disabled element', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, { kind: 'label', value: 'Cancel' });

      expect(await locator.isEnabled()).toBe(false);
    });

    test('isSelected returns true when the node has isSelected set', async () => {
      const tree: ViewNode[] = [node({ type: 'Window', children: [node({ type: 'Tab', label: 'Home', isSelected: true })] })];
      const driver = createMockDriver(tree);
      const locator = new Locator(driver, { kind: 'label', value: 'Home' });

      expect(await locator.isSelected()).toBe(true);
    });

    test('isSelected returns false when isSelected is not set', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, { kind: 'label', value: 'Submit' });

      expect(await locator.isSelected()).toBe(false);
    });

    test('isFocused returns true when the node has isFocused set', async () => {
      const tree: ViewNode[] = [node({ type: 'Window', children: [node({ type: 'TextField', label: 'Search', isFocused: true })] })];
      const driver = createMockDriver(tree);
      const locator = new Locator(driver, { kind: 'label', value: 'Search' });

      expect(await locator.isFocused()).toBe(true);
    });

    test('isChecked returns true when the node has isChecked set', async () => {
      const tree: ViewNode[] = [node({ type: 'Window', children: [node({ type: 'Checkbox', label: 'Agree', isChecked: true })] })];
      const driver = createMockDriver(tree);
      const locator = new Locator(driver, { kind: 'label', value: 'Agree' });

      expect(await locator.isChecked()).toBe(true);
    });

    test('isChecked returns false when isChecked is not set', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, { kind: 'label', value: 'Submit' });

      expect(await locator.isChecked()).toBe(false);
    });
  });

  test.describe('boundingBox', () => {
    test('returns the x, y, width, height of the visible element', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, { kind: 'label', value: 'Submit' });

      const box = await locator.boundingBox();

      expect(box).toEqual({ x: 20, y: 100, width: 200, height: 50 });
    });
  });

  test.describe('getValue', () => {
    test('returns the value property of the element when present', async () => {
      const tree: ViewNode[] = [node({ type: 'Window', children: [node({ type: 'Slider', label: 'Volume', value: '75%' })] })];
      const driver = createMockDriver(tree);
      const locator = new Locator(driver, { kind: 'label', value: 'Volume' });

      expect(await locator.getValue()).toBe('75%');
    });

    test('returns an empty string when value is not set', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, { kind: 'label', value: 'Submit' });

      expect(await locator.getValue()).toBe('');
    });
  });

  test.describe('waitFor enabled and disabled states', () => {
    test('resolves immediately when element is already enabled', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, { kind: 'label', value: 'Submit' });

      await locator.waitFor({ state: 'enabled' });
    });

    test('resolves immediately when element is already disabled', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, { kind: 'label', value: 'Cancel' });

      await locator.waitFor({ state: 'disabled' });
    });
  });

  test.describe('scrollIntoViewIfNeeded', () => {
    test('returns immediately without swiping when element is already in the viewport', async () => {
      const driver = createMockDriver(hierarchy);
      // Submit button at x:20 y:100 w:200 h:50 — fully inside the 390×844 screen
      const locator = new Locator(driver, { kind: 'label', value: 'Submit' });

      await locator.scrollIntoViewIfNeeded();

      expect(driver._tracker.swipeCalls).toHaveLength(0);
    });

    test('swipes up when the element is below the visible viewport', async () => {
      const belowBounds = { x: 0, y: 900, width: 390, height: 44 };
      const inViewBounds = { x: 0, y: 400, width: 390, height: 44 };
      const belowTree: ViewNode[] = [node({ type: 'Window', children: [node({ type: 'Button', label: 'Far', bounds: belowBounds })] })];
      const inViewTree: ViewNode[] = [node({ type: 'Window', children: [node({ type: 'Button', label: 'Far', bounds: inViewBounds })] })];

      const driver = createMockDriver(belowTree);
      let callCount = 0;
      driver.getViewHierarchy = async () => {
        callCount++;
        return callCount >= 2 ? inViewTree : belowTree;
      };

      const locator = new Locator(driver, { kind: 'label', value: 'Far' });
      await locator.scrollIntoViewIfNeeded({ maxSwipes: 5 });

      // centerY of belowBounds = 900 + 22 = 922 > 844, so swipeDirectionToReveal returns 'up'
      expect(driver._tracker.swipeCalls[0]).toEqual(['up']);
    });

    test('swipes down when the element is above the visible viewport', async () => {
      const aboveBounds = { x: 0, y: -200, width: 390, height: 44 };
      const inViewBounds = { x: 0, y: 400, width: 390, height: 44 };
      const aboveTree: ViewNode[] = [node({ type: 'Window', children: [node({ type: 'Button', label: 'Far', bounds: aboveBounds })] })];
      const inViewTree: ViewNode[] = [node({ type: 'Window', children: [node({ type: 'Button', label: 'Far', bounds: inViewBounds })] })];

      const driver = createMockDriver(aboveTree);
      let callCount = 0;
      driver.getViewHierarchy = async () => {
        callCount++;
        return callCount >= 2 ? inViewTree : aboveTree;
      };

      const locator = new Locator(driver, { kind: 'label', value: 'Far' });
      await locator.scrollIntoViewIfNeeded({ maxSwipes: 5 });

      // centerY of aboveBounds = -200 + 22 = -178, not > 844, so swipeDirectionToReveal returns 'down'
      expect(driver._tracker.swipeCalls[0]).toEqual(['down']);
    });

    test('throws LocatorError when element never enters the viewport within maxSwipes', async () => {
      const outOfViewBounds = { x: 0, y: 900, width: 390, height: 44 };
      const outOfViewTree: ViewNode[] = [node({ type: 'Window', children: [node({ type: 'Button', label: 'Far', bounds: outOfViewBounds })] })];

      const driver = createMockDriver(outOfViewTree);
      const locator = new Locator(driver, { kind: 'label', value: 'Far' });

      await expect(locator.scrollIntoViewIfNeeded({ maxSwipes: 1 })).rejects.toThrow(LocatorError);
    });
  });

  test.describe('screenshot', () => {
    test('returns a buffer cropped to the element bounds', async () => {
      const screenWidth = 390;
      const screenHeight = 844;
      const fullImage = await sharp({
        create: { width: screenWidth, height: screenHeight, channels: 3, background: { r: 100, g: 150, b: 200 } },
      }).png().toBuffer();

      const driver = createMockDriver(hierarchy);
      driver.screenshot = async () => fullImage;

      // Submit button: x:20, y:100, width:200, height:50
      const locator = new Locator(driver, { kind: 'label', value: 'Submit' });
      const cropped = await locator.screenshot();

      const meta = await sharp(cropped).metadata();
      expect(meta.width).toBe(200);
      expect(meta.height).toBe(50);
    });
  });
});
