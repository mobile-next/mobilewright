import { readFile } from 'node:fs/promises';
import type {
  Reporter,
  TestCase,
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
}

function toStepInfo(step: TestStep): TestStepInfo {
  return {
    title: step.title,
    category: step.category,
    duration: step.duration,
    ...(step.error?.message !== undefined && { error: step.error.message }),
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
    errors: result.errors.map((e) => e.message ?? String(e)),
    steps: result.steps.map(toStepInfo),
  };
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
    void observer.onRunStart({ totalTests: suite.allTests().length });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const observer = getActiveDriver()?.observer;
    if (!observer?.onTestEnd) {
      return;
    }
    observer.onTestEnd(toTestInfo(test), toResultInfo(result));
  }

  async onEnd(result: FullResult): Promise<void> {
    const observer = getActiveDriver()?.observer;
    if (!observer?.onRunEnd) {
      return;
    }

    const jsonResultsPath = this.options.jsonResultsPath;
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
      console.warn(`\n  [mobilewright] Test observer onRunEnd failed: ${err}`);
    }
  }

  printsToStdio(): boolean {
    return false;
  }
}
