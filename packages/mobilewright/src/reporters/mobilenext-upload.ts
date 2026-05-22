import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';
import type { MobileNextTestResultConfig } from '../config.js';
import { uploadTestResult, type UploadTestResultParams } from './upload-client.js';

type UploadFn = (params: UploadTestResultParams) => Promise<{ url: string }>;

interface MobileNextUploadReporterOptions {
  apiKey: string;
  jsonResultsPath: string;
  outputDir: string;
  testResult: MobileNextTestResultConfig;
  _uploadFn?: UploadFn;
}

export default class MobileNextUploadReporter implements Reporter {
  private hasFailed = false;
  private readonly options: MobileNextUploadReporterOptions;

  constructor(options: MobileNextUploadReporterOptions) {
    this.options = options;
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    if (result.status === 'failed' || result.status === 'timedOut') {
      this.hasFailed = true;
    }
  }

  async onEnd(_result: FullResult): Promise<void> {
    const { uploadReport } = this.options.testResult;
    if (uploadReport === 'on-failure' && !this.hasFailed) {
      return;
    }

    const upload = this.options._uploadFn ?? uploadTestResult;

    try {
      const uploadResult = await upload({
        apiKey: this.options.apiKey,
        jsonResultsPath: this.options.jsonResultsPath,
        outputDir: this.options.outputDir,
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
