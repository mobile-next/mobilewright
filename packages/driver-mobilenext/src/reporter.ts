import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Reporter, TestCase, TestResult, FullResult, FullConfig, Suite, TestStep } from '@playwright/test/reporter';
import { uploadTestResult, extractGitInfoFromReport, type UploadTestResultParams } from './upload-client.js';

const _require = createRequire(import.meta.url);

export interface MobileNextTestResultConfig {
  uploadReport?: 'on' | 'off' | 'on-failure';
  name?: string;
  tags?: string[];
  environment?: string;
}

type UploadFn = (params: UploadTestResultParams) => Promise<{ url: string }>;

interface MobileNextUploadReporterOptions {
  apiKey: string;
  jsonResultsPath: string;
  testResult: MobileNextTestResultConfig;
  uploadTimeout?: number;
  _uploadFn?: UploadFn;
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

export default class MobileNextUploadReporter implements Reporter {
  private hasFailed = false;
  private hasTests = false;
  private readonly options: MobileNextUploadReporterOptions;
  private readonly snippetsByResult = new Map<TestResult, string[]>();
  private readonly snippetsByKey = new Map<string, string[]>();
  private readonly sourceCache = new Map<string, string[]>();

  constructor(options: MobileNextUploadReporterOptions) {
    this.options = options;
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    this.hasTests = suite.allTests().length > 0;
  }

  onStepEnd(_test: TestCase, result: TestResult, step: TestStep): void {
    if (step.category !== 'test.step') return;
    if (!this.snippetsByResult.has(result)) {
      this.snippetsByResult.set(result, []);
    }
    const snippet = step.location ? this.extractSnippet(step.location) : '';
    this.snippetsByResult.get(result)!.push(snippet);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === 'failed' || result.status === 'timedOut') {
      this.hasFailed = true;
    }
    this.snippetsByKey.set(`${test.id}:${result.retry}`, this.snippetsByResult.get(result) ?? []);
    this.snippetsByResult.delete(result);
  }

  async onEnd(_result: FullResult): Promise<void> {
    if (!this.hasTests) return;
    const { uploadReport } = this.options.testResult;
    if (uploadReport === 'off') return;
    if (uploadReport === 'on-failure' && !this.hasFailed) return;

    const upload = this.options._uploadFn ?? uploadTestResult;
    const pkg = _require('../package.json') as { version: string };
    const userAgent = `mobilewright/${pkg.version}`;
    const rawContent = readFileSync(this.options.jsonResultsPath, 'utf8');
    const report = JSON.parse(rawContent) as JsonReport;
    this.injectSnippets(report);
    const gitInfo = extractGitInfoFromReport(report);

    try {
      const uploadResult = await upload({
        apiKey: this.options.apiKey,
        report: report as Record<string, unknown>,
        userAgent,
        gitInfo,
        name: this.options.testResult.name,
        tags: this.options.testResult.tags,
        environment: this.options.testResult.environment,
        timeout: this.options.uploadTimeout,
      });
      console.log(`\n  Report uploaded: ${uploadResult.url}`);
    } catch (err) {
      console.warn(`\n  [mobilewright] Failed to upload test results: ${err}`);
    }
  }

  private extractSnippet(location: { file: string; line: number; column: number }): string {
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
    if (line < 2 || line > lines.length) return '';

    const lineNumWidth = String(line + 1).length;
    const pad = (n: number) => String(n).padStart(lineNumWidth, ' ');
    const snippet: string[] = [];
    snippet.push(`  ${pad(line - 1)} | ${lines[line - 2]}`);
    snippet.push(`> ${pad(line)} | ${lines[line - 1]}`);
    // Arrow under the column, accounting for the "> line | " prefix
    const arrowOffset = `  ${pad(line)} | `.length + Math.max(0, location.column - 1);
    snippet.push(' '.repeat(arrowOffset) + '^');
    if (line < lines.length) snippet.push(`  ${pad(line + 1)} | ${lines[line]}`);
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

  // Post-order traversal: children before parent — matches onStepEnd completion order.
  private walkSteps(steps: JsonStep[], queue: string[]): void {
    for (const step of steps) {
      if (step.steps?.length) this.walkSteps(step.steps, queue);
      const snippet = queue.shift();
      if (snippet) step.snippet = snippet;
    }
  }
}
