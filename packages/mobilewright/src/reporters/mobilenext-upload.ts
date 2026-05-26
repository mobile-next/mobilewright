import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Reporter, TestCase, TestResult, FullResult, FullConfig, Suite } from '@playwright/test/reporter';
import type { MobileNextTestResultConfig } from '../config.js';
import { uploadTestResult, getGitInfo, type UploadTestResultParams } from '@mobilewright/driver-mobilenext';

const _require = createRequire(import.meta.url);

type UploadFn = (params: UploadTestResultParams) => Promise<{ url: string }>;

interface MobileNextUploadReporterOptions {
  apiKey: string;
  jsonResultsPath: string;
  testResult: MobileNextTestResultConfig;
  _uploadFn?: UploadFn;
}

export default class MobileNextUploadReporter implements Reporter {
  private hasFailed = false;
  private hasTests = false;
  private readonly options: MobileNextUploadReporterOptions;

  constructor(options: MobileNextUploadReporterOptions) {
    this.options = options;
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    this.hasTests = suite.allTests().length > 0;
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    if (result.status === 'failed' || result.status === 'timedOut') {
      this.hasFailed = true;
    }
  }

  async onEnd(_result: FullResult): Promise<void> {
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

    const upload = this.options._uploadFn ?? uploadTestResult;

    const pkg = _require('../../package.json') as { version: string };
    const userAgent = `mobilewright/${pkg.version}`;
    const rawContent = readFileSync(this.options.jsonResultsPath, 'utf8');
    const report = JSON.parse(rawContent) as Record<string, unknown>;
    const gitInfo = getGitInfo();

    try {
      const uploadResult = await upload({
        apiKey: this.options.apiKey,
        report,
        userAgent,
        gitInfo,
        name: this.options.testResult.name,
        tags: this.options.testResult.tags,
        environment: this.options.testResult.environment,
      });
      console.log(`\n  Report uploaded: ${uploadResult.url}`);
    } catch (err) {
      console.warn(`\n  [mobilewright] Failed to upload test results: ${err}`);
    }
  }
}
