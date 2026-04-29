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

  test.describe('value assertions', () => {
    test('toBe passes with equal values', () => {
      mwExpect(42).toBe(42);
      mwExpect('hello').toBe('hello');
      mwExpect(true).toBe(true);
    });

    test('toBe fails with different values', () => {
      expect(() => mwExpect(236.25).toBe(431.93)).toThrow(ExpectError);
    });

    test('toBe uses Object.is semantics', () => {
      expect(() => mwExpect(NaN).toBe(NaN)).not.toThrow();
      expect(() => mwExpect(0).toBe(-0)).toThrow(ExpectError);
    });

    test('not.toBe passes with different values', () => {
      mwExpect(1).not.toBe(2);
    });

    test('not.toBe fails with equal values', () => {
      expect(() => mwExpect(42).not.toBe(42)).toThrow(ExpectError);
    });

    test('toEqual passes with deep equality', () => {
      mwExpect({ a: 1, b: [2, 3] }).toEqual({ a: 1, b: [2, 3] });
    });

    test('toEqual fails with different objects', () => {
      expect(() => mwExpect({ a: 1 }).toEqual({ a: 2 })).toThrow(ExpectError);
    });

    test('toBeTruthy and toBeFalsy', () => {
      mwExpect(1).toBeTruthy();
      mwExpect('yes').toBeTruthy();
      mwExpect(0).toBeFalsy();
      mwExpect('').toBeFalsy();
      mwExpect(null).toBeFalsy();
    });

    test('toBeGreaterThan and toBeLessThan', () => {
      mwExpect(10).toBeGreaterThan(5);
      mwExpect(5).toBeLessThan(10);
      expect(() => mwExpect(5).toBeGreaterThan(10)).toThrow(ExpectError);
      expect(() => mwExpect(10).toBeLessThan(5)).toThrow(ExpectError);
    });

    test('toBeCloseTo passes within precision', () => {
      mwExpect(0.1 + 0.2).toBeCloseTo(0.3);
      mwExpect(1.005).toBeCloseTo(1.0, 1);
    });

    test('toBeCloseTo fails outside precision', () => {
      expect(() => mwExpect(0.5).toBeCloseTo(1.0)).toThrow(ExpectError);
    });

    test('toContain works with arrays and strings', () => {
      mwExpect([1, 2, 3]).toContain(2);
      mwExpect('hello world').toContain('world');
      expect(() => mwExpect([1, 2]).toContain(5)).toThrow(ExpectError);
    });

    test('toBeNull and toBeUndefined', () => {
      mwExpect(null).toBeNull();
      mwExpect(undefined).toBeUndefined();
      expect(() => mwExpect(0).toBeNull()).toThrow(ExpectError);
      expect(() => mwExpect(null).toBeUndefined()).toThrow(ExpectError);
    });

    test('toMatch passes with regex', () => {
      mwExpect('hello world').toMatch(/world/);
      mwExpect('abc123').toMatch('\\d+');
    });

    test('toMatch fails when no match', () => {
      expect(() => mwExpect('hello').toMatch(/xyz/)).toThrow(ExpectError);
    });

    test('toBeInstanceOf passes with correct type', () => {
      mwExpect(new Error('test')).toBeInstanceOf(Error);
      mwExpect([1, 2]).toBeInstanceOf(Array);
    });

    test('toBeInstanceOf fails with wrong type', () => {
      expect(() => mwExpect('hello').toBeInstanceOf(Array)).toThrow(ExpectError);
    });

    test('toBeDefined passes with defined values', () => {
      mwExpect(0).toBeDefined();
      mwExpect('').toBeDefined();
      mwExpect(null).toBeDefined();
    });

    test('toBeDefined fails with undefined', () => {
      expect(() => mwExpect(undefined).toBeDefined()).toThrow(ExpectError);
    });

    test('toBeGreaterThanOrEqual and toBeLessThanOrEqual', () => {
      mwExpect(10).toBeGreaterThanOrEqual(10);
      mwExpect(10).toBeGreaterThanOrEqual(5);
      mwExpect(5).toBeLessThanOrEqual(5);
      mwExpect(5).toBeLessThanOrEqual(10);
      expect(() => mwExpect(5).toBeGreaterThanOrEqual(10)).toThrow(ExpectError);
      expect(() => mwExpect(10).toBeLessThanOrEqual(5)).toThrow(ExpectError);
    });

    test('toBeNaN passes with NaN', () => {
      mwExpect(NaN).toBeNaN();
    });

    test('toBeNaN fails with number', () => {
      expect(() => mwExpect(42).toBeNaN()).toThrow(ExpectError);
    });

    test('toContainEqual passes with deep match', () => {
      mwExpect([{ a: 1 }, { b: 2 }]).toContainEqual({ b: 2 });
    });

    test('toContainEqual fails when no deep match', () => {
      expect(() => mwExpect([{ a: 1 }]).toContainEqual({ a: 2 })).toThrow(ExpectError);
    });

    test('toHaveLength passes with correct length', () => {
      mwExpect([1, 2, 3]).toHaveLength(3);
      mwExpect('hello').toHaveLength(5);
    });

    test('toHaveLength fails with wrong length', () => {
      expect(() => mwExpect([1, 2]).toHaveLength(5)).toThrow(ExpectError);
    });

    test('toHaveProperty passes with existing key', () => {
      mwExpect({ name: 'Gil' }).toHaveProperty('name');
      mwExpect({ name: 'Gil' }).toHaveProperty('name', 'Gil');
    });

    test('toHaveProperty fails with missing key or wrong value', () => {
      expect(() => mwExpect({ a: 1 }).toHaveProperty('b')).toThrow(ExpectError);
      expect(() => mwExpect({ a: 1 }).toHaveProperty('a', 2)).toThrow(ExpectError);
    });

    test('toMatchObject passes with subset', () => {
      mwExpect({ a: 1, b: 2, c: 3 }).toMatchObject({ a: 1, c: 3 });
    });

    test('toMatchObject fails with different values', () => {
      expect(() => mwExpect({ a: 1 }).toMatchObject({ a: 2 })).toThrow(ExpectError);
    });

    test('toStrictEqual passes with same type and value', () => {
      mwExpect({ a: 1 }).toStrictEqual({ a: 1 });
    });

    test('toStrictEqual fails with different values', () => {
      expect(() => mwExpect({ a: 1 }).toStrictEqual({ a: 2 })).toThrow(ExpectError);
    });

    test('toThrow passes when function throws', () => {
      mwExpect(() => { throw new Error('boom'); }).toThrow();
      mwExpect(() => { throw new Error('boom'); }).toThrow('boom');
      mwExpect(() => { throw new Error('boom'); }).toThrow(/bo+m/);
    });

    test('toThrow fails when function does not throw', () => {
      expect(() => mwExpect(() => {}).toThrow()).toThrow(ExpectError);
    });

    test('toThrow fails with non-function', () => {
      expect(() => mwExpect(42).toThrow()).toThrow(ExpectError);
    });

    test('toThrow fails when error does not match', () => {
      expect(() => mwExpect(() => { throw new Error('boom'); }).toThrow('bang')).toThrow(ExpectError);
    });

    test('locators still route to LocatorAssertions', async () => {
      const driver = createMockDriver(hierarchy);
      const locator = new Locator(driver, { kind: 'testId', value: 'submitBtn' });
      // This should use LocatorAssertions, not ValueAssertions
      await mwExpect(locator).toBeVisible();
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
