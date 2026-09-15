import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type {
  TestObserver,
  TestInfo,
  TestResultInfo,
  TestStepInfo,
  RunResultInfo,
  TestRunInfo,
  SourceLocation,
} from '@mobilewright/protocol';
import {
  uploadTestResult,
  createTestResult,
  finishTestResult,
  extractGitInfoFromReport,
  extractGitInfoFromMetadata,
  type UploadTestResultParams,
  type CreateTestResultParams,
  type FinishTestResultParams,
  type TestRunStatus,
} from './upload-client.js';

const _require = createRequire(import.meta.url);

export interface MobileNextTestResultConfig {
  /** Upload the test report to mobilenext. 'on' always uploads, 'on-failure' uploads only when a test fails, 'off' disables uploading. Default: 'on'. */
  uploadReport?: 'on' | 'off' | 'on-failure';
  name?: string;
  tags?: string[];
  environment?: string;
}

type UploadFn = (params: UploadTestResultParams) => Promise<{ url: string }>;
type CreateFn = (params: CreateTestResultParams) => Promise<{ id: string; url: string }>;
type FinishFn = (params: FinishTestResultParams) => Promise<{ url: string }>;

export interface MobileNextTestObserverOptions {
  apiKey: string;
  testResult: MobileNextTestResultConfig;
  uploadTimeout?: number;
  _uploadFn?: UploadFn;
  _createFn?: CreateFn;
  _finishFn?: FinishFn;
}

type JsonStep = {
  title: string;
  duration: number;
  error?: unknown;
  steps?: JsonStep[];
  snippet?: string;
};

type JsonTestResult = {
  retry: number;
  steps?: JsonStep[];
};

type JsonTest = {
  results: JsonTestResult[];
};

type JsonSpec = {
  id: string;
  tests: JsonTest[];
};

type JsonSuite = {
  suites?: JsonSuite[];
  specs?: JsonSpec[];
};

type JsonReport = {
  suites?: JsonSuite[];
};

// A run that never reached its end is not a test outcome; the server derives
// passed/failed/flaky from the stats for the rest.
function terminalStatus(status: RunResultInfo['status']): TestRunStatus | undefined {
  if (status === 'interrupted' || status === 'timedout') {
    return 'errored';
  }
  return undefined;
}

/**
 * `TestObserver` implementation for `MobileNextDriver`: collects per-step
 * source snippets during the run, then on `onRunEnd` injects them into
 * Playwright's JSON report and uploads it to mobilenext.
 */
export class MobileNextTestObserver implements TestObserver {
  private hasFailed = false;
  private hasTests = false;
  /**
   * Id of the "running" row created at run start; resolves to undefined when not
   * created (on-failure mode, or create failed). A promise because the reporter does
   * not await onRunStart, and a short run can end before the create returns.
   */
  private liveTestResultId: Promise<string | undefined> = Promise.resolve(undefined);
  private readonly options: MobileNextTestObserverOptions;
  private readonly snippetsByKey = new Map<string, string[]>();
  private readonly sourceCache = new Map<string, string[]>();

  constructor(options: MobileNextTestObserverOptions) {
    this.options = options;
  }

  async onRunStart(run: TestRunInfo): Promise<void> {
    this.hasTests = run.totalTests > 0;
    if (!this.hasTests || this.options.testResult.uploadReport === 'off') {
      return;
    }
    // on-failure cannot know at start whether to upload, so it keeps the one-shot path.
    if (this.options.testResult.uploadReport === 'on-failure') {
      return;
    }
    this.liveTestResultId = this.createLiveRun(run);
    await this.liveTestResultId;
  }

  private async createLiveRun(run: TestRunInfo): Promise<string | undefined> {
    const create = this.options._createFn ?? createTestResult;
    try {
      const created = await create({
        apiKey: this.options.apiKey,
        userAgent: this.userAgent(),
        gitInfo: extractGitInfoFromMetadata(run.metadata),
        name: this.options.testResult.name,
        tags: this.options.testResult.tags,
        environment: this.options.testResult.environment,
        timeout: this.options.uploadTimeout,
      });
      console.log(`\n  Test run: ${created.url}`);
      return created.id;
    } catch (err) {
      console.warn(`\n  [mobilewright] Failed to register test run, will upload at the end: ${err}`);
      return undefined;
    }
  }

  private userAgent(): string {
    const pkg = _require('../package.json') as { version: string };
    return `mobilewright/${pkg.version}`;
  }

  onTestEnd(test: TestInfo, result: TestResultInfo): void {
    if (result.status === 'failed' || result.status === 'timedOut') {
      this.hasFailed = true;
    }
    this.snippetsByKey.set(`${test.id}:${result.retry}`, this.collectSnippets(result.steps));
  }

  async onRunEnd(result: RunResultInfo): Promise<void> {
    if (!this.hasTests) {
      return;
    }
    const { uploadReport } = this.options.testResult;
    if (uploadReport === 'off') {
      return;
    }
    if (uploadReport === 'on-failure' && !this.hasFailed) {
      return;
    }

    const liveId = await this.liveTestResultId;
    const rawReport = await result.jsonReport?.();
    if (!rawReport) {
      console.warn('\n  [mobilewright] No JSON report available; skipping test result upload.');
      if (liveId !== undefined) {
        // Finalize the live run anyway so it never stays "running".
        await this.finishLiveRun(liveId, {} as JsonReport, 'errored').catch((err: unknown) => {
          console.warn(`\n  [mobilewright] Failed to finish test result: ${err}`);
        });
      }
      return;
    }
    const report = rawReport as JsonReport;
    this.injectSnippets(report);

    try {
      const uploadResult = liveId !== undefined
        ? await this.finishLiveRun(liveId, report, terminalStatus(result.status))
        : await this.uploadWholeRun(report);
      console.log(`\n  Report uploaded: ${uploadResult.url}`);
    } catch (err) {
      console.warn(`\n  [mobilewright] Failed to upload test results: ${err}`);
    }
  }

  private finishLiveRun(testResultId: string, report: JsonReport, status: TestRunStatus | undefined): Promise<{ url: string }> {
    const finish = this.options._finishFn ?? finishTestResult;
    return finish({
      apiKey: this.options.apiKey,
      testResultId,
      report: report as Record<string, unknown>,
      status,
      timeout: this.options.uploadTimeout,
    });
  }

  private uploadWholeRun(report: JsonReport): Promise<{ url: string }> {
    const upload = this.options._uploadFn ?? uploadTestResult;
    return upload({
      apiKey: this.options.apiKey,
      report: report as Record<string, unknown>,
      userAgent: this.userAgent(),
      gitInfo: extractGitInfoFromReport(report as Record<string, unknown>),
      name: this.options.testResult.name,
      tags: this.options.testResult.tags,
      environment: this.options.testResult.environment,
      timeout: this.options.uploadTimeout,
    });
  }

  // Post-order traversal of the slim step tree — children before parent,
  // matching the completion order Playwright's own onStepEnd produced.
  private collectSnippets(steps: TestStepInfo[]): string[] {
    const snippets: string[] = [];
    const walk = (nodes: TestStepInfo[]): void => {
      for (const step of nodes) {
        walk(step.steps);
        if (step.category === 'test.step') {
          snippets.push(step.location ? this.extractSnippet(step.location) : '');
        }
      }
    };
    walk(steps);
    return snippets;
  }

  private extractSnippet(location: SourceLocation): string {
    let lines = this.sourceCache.get(location.file);
    if (!lines) {
      try {
        lines = readFileSync(location.file, 'utf-8').split('\n');
        this.sourceCache.set(location.file, lines);
      } catch {
        return '';
      }
    }
    const line = location.line; // 1-based
    if (line < 2 || line > lines.length) {
      return '';
    }

    const lineNumWidth = String(line + 1).length;
    const pad = (n: number) => String(n).padStart(lineNumWidth, ' ');
    const snippet: string[] = [];
    snippet.push(`  ${pad(line - 1)} | ${lines[line - 2]}`);
    snippet.push(`> ${pad(line)} | ${lines[line - 1]}`);
    // Arrow under the column, accounting for the "> line | " prefix
    const arrowOffset = `  ${pad(line)} | `.length + Math.max(0, location.column - 1);
    snippet.push(' '.repeat(arrowOffset) + '^');
    if (line < lines.length) {
      snippet.push(`  ${pad(line + 1)} | ${lines[line]}`);
    }
    return snippet.join('\n');
  }

  private injectSnippets(report: JsonReport): void {
    for (const suite of report.suites ?? []) {
      this.walkSuite(suite);
    }
  }

  private walkSuite(suite: JsonSuite): void {
    for (const sub of suite.suites ?? []) {
      this.walkSuite(sub);
    }
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        for (const result of test.results) {
          const snippets = this.snippetsByKey.get(`${spec.id}:${result.retry}`);
          if (result.steps?.length && snippets?.length) {
            this.walkSteps(result.steps, snippets.slice());
          }
        }
      }
    }
  }

  // Post-order traversal: children before parent — matches the snippet collection order.
  private walkSteps(steps: JsonStep[], queue: string[]): void {
    for (const step of steps) {
      if (step.steps?.length) {
        this.walkSteps(step.steps, queue);
      }
      const snippet = queue.shift();
      if (snippet) {
        step.snippet = snippet;
      }
    }
  }
}
