import { readFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  Reporter,
  TestCase,
  TestError,
  TestResult,
  TestStep,
  FullResult,
  FullConfig,
  Suite,
} from '@playwright/test/reporter';
import type { TestInfo, TestResultInfo, TestStepInfo, RunResultInfo } from '@mobilewright/protocol';
import { getActiveDriver } from './driver-registry.js';

export interface ObserverReporterOptions {
  /** Path to the JSON report this run writes, if any — read lazily to build `RunResultInfo.jsonReport()`. */
  jsonResultsPath?: string;
  /** Remove the jsonResultsPath directory after the run — set only for the private tmp dir defineConfig created. */
  cleanupJsonResults?: boolean;
}

// `message` is set for thrown Errors, `value` for thrown non-Errors.
function errorText(error: TestError): string {
  return error.message ?? error.value ?? String(error);
}

function toStepInfo(step: TestStep): TestStepInfo {
  return {
    title: step.title,
    category: step.category,
    duration: step.duration,
    ...(step.error !== undefined && { error: errorText(step.error) }),
    ...(step.location !== undefined && { location: step.location }),
    steps: step.steps.map(toStepInfo),
  };
}

function toTestInfo(test: TestCase): TestInfo {
  return {
    id: test.id,
    title: test.title,
    titlePath: test.titlePath(),
    ...(test.location !== undefined && { location: test.location }),
  };
}

function toResultInfo(result: TestResult): TestResultInfo {
  return {
    status: result.status,
    retry: result.retry,
    duration: result.duration,
    errors: result.errors.map(errorText),
    steps: result.steps.map(toStepInfo),
  };
}

// An observer failure must never crash or fail the test run — warn and move on.
function warnObserverFailure(hook: string, err: unknown): void {
  console.warn(`\n  [mobilewright] Test observer ${hook} failed: ${err}`);
}

/**
 * Shim Playwright reporter that forwards test-lifecycle events to the active
 * driver's `TestObserver`, if any. No-ops entirely when no driver is
 * registered or the driver has no observer — safe to always inject.
 */
export default class ObserverReporter implements Reporter {
  private readonly options: ObserverReporterOptions;

  constructor(options: ObserverReporterOptions = {}) {
    this.options = options;
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    const observer = getActiveDriver()?.observer;
    if (!observer?.onRunStart) {
      return;
    }
    try {
      const started = observer.onRunStart({ totalTests: suite.allTests().length });
      void Promise.resolve(started).catch((err) => warnObserverFailure('onRunStart', err));
    } catch (err) {
      warnObserverFailure('onRunStart', err);
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const observer = getActiveDriver()?.observer;
    if (!observer?.onTestEnd) {
      return;
    }
    try {
      observer.onTestEnd(toTestInfo(test), toResultInfo(result));
    } catch (err) {
      warnObserverFailure('onTestEnd', err);
    }
  }

  async onEnd(result: FullResult): Promise<void> {
    const jsonResultsPath = this.options.jsonResultsPath;
    try {
      const observer = getActiveDriver()?.observer;
      if (!observer?.onRunEnd) {
        return;
      }

      const runResult: RunResultInfo = {
        status: result.status,
        startTime: result.startTime,
        duration: result.duration,
        ...(jsonResultsPath !== undefined && {
          jsonReport: async () => JSON.parse(await readFile(jsonResultsPath, 'utf8')) as unknown,
        }),
      };

      try {
        await observer.onRunEnd(runResult);
      } catch (err) {
        warnObserverFailure('onRunEnd', err);
      }
    } finally {
      if (this.options.cleanupJsonResults && jsonResultsPath !== undefined) {
        rmSync(dirname(jsonResultsPath), { recursive: true, force: true });
      }
    }
  }

  printsToStdio(): boolean {
    return false;
  }
}
