import { test, expect } from '@playwright/test';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TestCase, TestResult, TestStep, FullConfig, FullResult, Suite } from '@playwright/test/reporter';
import type { MobilewrightDriver, TestObserver, TestRunInfo, TestInfo, TestResultInfo, RunResultInfo } from '@mobilewright/protocol';
import ObserverReporter from './observer-reporter.js';
import { setActiveDriver } from './driver-registry.js';

interface RecordingObserver extends TestObserver {
  runStarts: TestRunInfo[];
  testEnds: Array<{ test: TestInfo; result: TestResultInfo }>;
  runEnds: RunResultInfo[];
}

function makeRecordingObserver(): RecordingObserver {
  const observer: RecordingObserver = {
    runStarts: [],
    testEnds: [],
    runEnds: [],
    onRunStart(run) {
      observer.runStarts.push(run);
    },
    onTestEnd(testInfo, resultInfo) {
      observer.testEnds.push({ test: testInfo, result: resultInfo });
    },
    onRunEnd(resultInfo) {
      observer.runEnds.push(resultInfo);
      return Promise.resolve();
    },
  };
  return observer;
}

function fakeSuite(testCount: number): Suite {
  return { allTests: () => new Array(testCount).fill({}) } as unknown as Suite;
}

function fakeTestCase(overrides: Partial<{ id: string; title: string; titlePath: string[] }> = {}): TestCase {
  const titlePath = overrides.titlePath ?? ['example.spec.ts', 'suite', 'a test'];
  return {
    id: overrides.id ?? 'test-1',
    title: overrides.title ?? 'a test',
    titlePath: () => titlePath,
    location: { file: 'example.spec.ts', line: 5, column: 3 },
  } as unknown as TestCase;
}

function fakeStep(overrides: Partial<{ title: string; category: string; duration: number; error: { message: string }; steps: TestStep[] }> = {}): TestStep {
  return {
    title: overrides.title ?? 'a step',
    category: overrides.category ?? 'test.step',
    duration: overrides.duration ?? 12,
    steps: overrides.steps ?? [],
    ...(overrides.error && { error: overrides.error }),
  } as unknown as TestStep;
}

function fakeTestResult(
  overrides: Partial<{ status: string; retry: number; duration: number; errors: Array<{ message: string }>; steps: TestStep[] }> = {},
): TestResult {
  return {
    status: overrides.status ?? 'passed',
    retry: overrides.retry ?? 0,
    duration: overrides.duration ?? 100,
    errors: overrides.errors ?? [],
    steps: overrides.steps ?? [],
  } as unknown as TestResult;
}

test.afterEach(() => {
  setActiveDriver(undefined);
});

test('onBegin forwards the scheduled test count to observer.onRunStart', () => {
  const observer = makeRecordingObserver();
  setActiveDriver({ observer } as unknown as MobilewrightDriver);

  const reporter = new ObserverReporter();
  reporter.onBegin({} as FullConfig, fakeSuite(3));

  expect(observer.runStarts).toEqual([{ totalTests: 3 }]);
});

test('onTestEnd maps the test case and result into the slim protocol shapes', () => {
  const observer = makeRecordingObserver();
  setActiveDriver({ observer } as unknown as MobilewrightDriver);

  const reporter = new ObserverReporter();
  const innerStep = fakeStep({ title: 'inner', duration: 3 });
  const outerStep = fakeStep({ title: 'outer', duration: 10, steps: [innerStep], error: { message: 'boom' } });
  const testCase = fakeTestCase({ id: 'spec-1', title: 'does a thing', titlePath: ['file.spec.ts', 'does a thing'] });
  const result = fakeTestResult({ status: 'failed', retry: 1, duration: 50, errors: [{ message: 'oops' }], steps: [outerStep] });

  reporter.onTestEnd(testCase, result);

  expect(observer.testEnds).toHaveLength(1);
  const recorded = observer.testEnds[0]!;
  expect(recorded.test.id).toBe('spec-1');
  expect(recorded.test.title).toBe('does a thing');
  expect(recorded.test.titlePath).toEqual(['file.spec.ts', 'does a thing']);
  expect(recorded.result.status).toBe('failed');
  expect(recorded.result.retry).toBe(1);
  expect(recorded.result.errors).toEqual(['oops']);
  expect(recorded.result.steps).toHaveLength(1);
  expect(recorded.result.steps[0]!.title).toBe('outer');
  expect(recorded.result.steps[0]!.error).toBe('boom');
  expect(recorded.result.steps[0]!.steps).toHaveLength(1);
  expect(recorded.result.steps[0]!.steps[0]!.title).toBe('inner');
});

test('onEnd awaits observer.onRunEnd and its jsonReport() reads the results file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mw-observer-reporter-test-'));
  const filePath = join(dir, 'results.json');
  writeFileSync(filePath, JSON.stringify({ hello: 'world' }));

  const observer = makeRecordingObserver();
  setActiveDriver({ observer } as unknown as MobilewrightDriver);

  const reporter = new ObserverReporter({ jsonResultsPath: filePath });
  await reporter.onEnd({ status: 'passed', startTime: new Date(), duration: 500 } as FullResult);

  expect(observer.runEnds).toHaveLength(1);
  const report = await observer.runEnds[0]!.jsonReport?.();
  expect(report).toEqual({ hello: 'world' });

  rmSync(dir, { recursive: true });
});

test('onEnd removes the results directory when cleanupJsonResults is set, even without an onRunEnd hook', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mw-observer-reporter-test-'));
  const filePath = join(dir, 'results.json');
  writeFileSync(filePath, JSON.stringify({}));
  setActiveDriver({ observer: {} } as unknown as MobilewrightDriver);

  const reporter = new ObserverReporter({ jsonResultsPath: filePath, cleanupJsonResults: true });
  await reporter.onEnd({ status: 'passed', startTime: new Date(), duration: 0 } as FullResult);

  expect(existsSync(dir)).toBe(false);
});

test('onEnd leaves the results file in place when cleanupJsonResults is not set', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mw-observer-reporter-test-'));
  const filePath = join(dir, 'results.json');
  writeFileSync(filePath, JSON.stringify({}));
  const observer = makeRecordingObserver();
  setActiveDriver({ observer } as unknown as MobilewrightDriver);

  const reporter = new ObserverReporter({ jsonResultsPath: filePath });
  await reporter.onEnd({ status: 'passed', startTime: new Date(), duration: 0 } as FullResult);

  expect(existsSync(filePath)).toBe(true);
  rmSync(dir, { recursive: true });
});

test('onTestEnd maps non-Error thrown values using the error value fallback', () => {
  const observer = makeRecordingObserver();
  setActiveDriver({ observer } as unknown as MobilewrightDriver);

  const step = fakeStep({ title: 'step', error: { value: 'thrown-string' } as { message: string } });
  const result = fakeTestResult({ errors: [{ value: 'thrown-string' } as { message: string }], steps: [step] });

  const reporter = new ObserverReporter();
  reporter.onTestEnd(fakeTestCase(), result);

  expect(observer.testEnds[0]!.result.errors).toEqual(['thrown-string']);
  expect(observer.testEnds[0]!.result.steps[0]!.error).toBe('thrown-string');
});

test('onEnd does not attach jsonReport when no jsonResultsPath was configured', async () => {
  const observer = makeRecordingObserver();
  setActiveDriver({ observer } as unknown as MobilewrightDriver);

  const reporter = new ObserverReporter();
  await reporter.onEnd({ status: 'passed', startTime: new Date(), duration: 0 } as FullResult);

  expect(observer.runEnds[0]!.jsonReport).toBeUndefined();
});

test('onEnd does not throw when the observer rejects', async () => {
  const failingObserver: TestObserver = {
    onRunEnd: () => Promise.reject(new Error('boom')),
  };
  setActiveDriver({ observer: failingObserver } as unknown as MobilewrightDriver);

  const reporter = new ObserverReporter();
  await expect(reporter.onEnd({ status: 'passed', startTime: new Date(), duration: 0 } as FullResult)).resolves.not.toThrow();
});

test('onBegin and onTestEnd do not throw when the observer throws', () => {
  const failingObserver: TestObserver = {
    onRunStart: () => { throw new Error('boom'); },
    onTestEnd: () => { throw new Error('boom'); },
  };
  setActiveDriver({ observer: failingObserver } as unknown as MobilewrightDriver);

  const reporter = new ObserverReporter();
  expect(() => reporter.onBegin({} as FullConfig, fakeSuite(1))).not.toThrow();
  expect(() => reporter.onTestEnd(fakeTestCase(), fakeTestResult())).not.toThrow();
});

test('onBegin does not leave an unhandled rejection when observer.onRunStart rejects', async () => {
  const failingObserver: TestObserver = {
    onRunStart: () => Promise.reject(new Error('boom')),
  };
  setActiveDriver({ observer: failingObserver } as unknown as MobilewrightDriver);

  const reporter = new ObserverReporter();
  reporter.onBegin({} as FullConfig, fakeSuite(1));
  // Give the rejection a microtask to surface — the test fails on unhandledRejection if unhandled.
  await new Promise((resolve) => setImmediate(resolve));
});

test('reporter methods no-op when no driver is registered', () => {
  setActiveDriver(undefined);
  const reporter = new ObserverReporter();
  expect(() => reporter.onBegin({} as FullConfig, fakeSuite(1))).not.toThrow();
  expect(() => reporter.onTestEnd(fakeTestCase(), fakeTestResult())).not.toThrow();
});

test('reporter methods no-op when the registered driver has no observer', () => {
  setActiveDriver({} as unknown as MobilewrightDriver);
  const reporter = new ObserverReporter();
  expect(() => reporter.onBegin({} as FullConfig, fakeSuite(1))).not.toThrow();
  expect(() => reporter.onTestEnd(fakeTestCase(), fakeTestResult())).not.toThrow();
});

test('printsToStdio returns false', () => {
  const reporter = new ObserverReporter();
  expect(reporter.printsToStdio()).toBe(false);
});
