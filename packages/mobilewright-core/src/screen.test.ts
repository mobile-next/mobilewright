import { test, expect } from '@playwright/test';
import type {
  MobilewrightDriver,
  Orientation,
  AppInfo,
  DeviceInfo,
  GestureSequence,
} from '@mobilewright/protocol';
import { Screen } from './screen.js';

type CallTracker = {
  tapCalls: any[][];
  doubleTapCalls: any[][];
  longPressCalls: any[][];
  gestureCalls: any[][];
};

function createMockDriver(): MobilewrightDriver & { _tracker: CallTracker } {
  const tracker: CallTracker = {
    tapCalls: [],
    doubleTapCalls: [],
    longPressCalls: [],
    gestureCalls: [],
  };

  return {
    _tracker: tracker,
    connect: async () => ({ deviceId: 'device1', platform: 'ios' as const }),
    disconnect: async () => {},
    getViewHierarchy: async () => [],
    tap: async (...args: any[]) => { tracker.tapCalls.push(args); },
    doubleTap: async (...args: any[]) => { tracker.doubleTapCalls.push(args); },
    longPress: async (...args: any[]) => { tracker.longPressCalls.push(args); },
    typeText: async () => {},
    pressKeys: async () => {},
    clearText: async () => {},
    swipe: async () => {},
    gesture: async (...args: any[]) => { tracker.gestureCalls.push(args); },
    pressButton: async () => {},
    screenshot: async () => Buffer.from(''),
    getScreenSize: async () => ({ width: 390, height: 844, scale: 3 }),
    getOrientation: async () => 'portrait' as Orientation,
    setOrientation: async () => {},
    launchApp: async () => {},
    terminateApp: async () => {},
    listApps: async () => [] as AppInfo[],
    getForegroundApp: async () => ({ bundleId: 'com.test' }),
    installApp: async () => {},
    uninstallApp: async () => {},
    listDevices: async () => [] as DeviceInfo[],
    openUrl: async () => {},
    startRecording: async () => {},
    stopRecording: async () => ({}),
  };
}

test.describe('Screen coordinate gestures', () => {
  test('doubleTap forwards coordinates to the driver', async () => {
    const driver = createMockDriver();
    const screen = new Screen(driver);

    await screen.doubleTap(120, 240);

    expect(driver._tracker.doubleTapCalls).toEqual([[120, 240]]);
  });

  test('longPress forwards coordinates to the driver', async () => {
    const driver = createMockDriver();
    const screen = new Screen(driver);

    await screen.longPress(50, 60);

    expect(driver._tracker.longPressCalls).toEqual([[50, 60, undefined]]);
  });

  test('longPress forwards an explicit duration', async () => {
    const driver = createMockDriver();
    const screen = new Screen(driver);

    await screen.longPress(50, 60, 1500);

    expect(driver._tracker.longPressCalls).toEqual([[50, 60, 1500]]);
  });

  test('gesture forwards the sequence to the driver', async () => {
    const driver = createMockDriver();
    const screen = new Screen(driver);
    const sequence: GestureSequence = {
      pointers: [
        [{ x: 0, y: 0, time: 0 }, { x: 100, y: 100, time: 200 }],
      ],
    };

    await screen.gesture(sequence);

    expect(driver._tracker.gestureCalls).toEqual([[sequence]]);
  });
});
