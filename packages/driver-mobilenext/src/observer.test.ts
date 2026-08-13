import { test, expect } from '@playwright/test';
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TestInfo, TestResultInfo, TestStepInfo, RunResultInfo } from '@mobilewright/protocol';
import { MobileNextTestObserver } from './observer.js';
import type { UploadTestResultParams } from './upload-client.js';

function makeTempResultsFile(content: string = '{}'): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'mw-observer-test-'));
  const filePath = join(dir, 'results.json');
  writeFileSync(filePath, content);
  return { path: filePath, cleanup: () => rmSync(dir, { recursive: true }) };
}

/** Builds a `RunResultInfo` whose `jsonReport()` reads the given file (sync, wrapped as a Promise). */
function runResultReadingFile(path: string, status: RunResultInfo['status'] = 'passed'): RunResultInfo {
  return {
    status,
    startTime: new Date(),
    duration: 1000,
    jsonReport: () => Promise.resolve(JSON.parse(readFileSync(path, 'utf8')) as unknown),
  };
}

function runResultWithoutReport(status: RunResultInfo['status'] = 'passed'): RunResultInfo {
  return { status, startTime: new Date(), duration: 1000 };
}

const passingTestResult: TestResultInfo = { status: 'passed', retry: 0, duration: 5, errors: [], steps: [] };
const failedTestResult: TestResultInfo = { status: 'failed', retry: 0, duration: 5, errors: ['boom'], steps: [] };
const timedOutTestResult: TestResultInfo = { status: 'timedOut', retry: 0, duration: 5, errors: [], steps: [] };
const testInfo: TestInfo = { id: 'spec-1', title: 'a test', titlePath: ['example.spec.ts', 'a test'] };

test('does not upload when uploadReport is on-failure and no tests failed', async () => {
  let uploadCalled = false;
  const spyUpload = async (_params: UploadTestResultParams) => {
    uploadCalled = true;
    return { url: 'file:///tmp/fake' };
  };

  const observer = new MobileNextTestObserver({
    apiKey: 'key',
    testResult: { uploadReport: 'on-failure' },
    _uploadFn: spyUpload,
  });

  observer.onRunStart({ totalTests: 1 });
  await observer.onRunEnd(runResultWithoutReport('passed'));
  expect(uploadCalled).toBe(false);
});

test('uploads when uploadReport is on-failure and a test failed', async () => {
  const { path, cleanup } = makeTempResultsFile();
  let uploadCalled = false;
  const spyUpload = async (_params: UploadTestResultParams) => {
    uploadCalled = true;
    return { url: 'file:///tmp/fake' };
  };

  const observer = new MobileNextTestObserver({
    apiKey: 'key',
    testResult: { uploadReport: 'on-failure' },
    _uploadFn: spyUpload,
  });

  observer.onRunStart({ totalTests: 1 });
  observer.onTestEnd(testInfo, failedTestResult);
  await observer.onRunEnd(runResultReadingFile(path, 'failed'));
  expect(uploadCalled).toBe(true);
  cleanup();
});

test('uploads when uploadReport is on-failure and a test timed out', async () => {
  const { path, cleanup } = makeTempResultsFile();
  let uploadCalled = false;
  const spyUpload = async (_params: UploadTestResultParams) => {
    uploadCalled = true;
    return { url: 'file:///tmp/fake' };
  };

  const observer = new MobileNextTestObserver({
    apiKey: 'key',
    testResult: { uploadReport: 'on-failure' },
    _uploadFn: spyUpload,
  });

  observer.onRunStart({ totalTests: 1 });
  observer.onTestEnd(testInfo, timedOutTestResult);
  await observer.onRunEnd(runResultReadingFile(path, 'failed'));
  expect(uploadCalled).toBe(true);
  cleanup();
});

test('uploads by default when uploadReport is not set', async () => {
  const { path, cleanup } = makeTempResultsFile();
  let uploadCalled = false;
  const spyUpload = async (_params: UploadTestResultParams) => {
    uploadCalled = true;
    return { url: 'file:///tmp/fake' };
  };

  const observer = new MobileNextTestObserver({
    apiKey: 'key',
    testResult: {},
    _uploadFn: spyUpload,
  });

  observer.onRunStart({ totalTests: 1 });
  await observer.onRunEnd(runResultReadingFile(path));
  expect(uploadCalled).toBe(true);
  cleanup();
});

test('always uploads when uploadReport is on regardless of test outcomes', async () => {
  const { path, cleanup } = makeTempResultsFile();
  let uploadCalled = false;
  const spyUpload = async (_params: UploadTestResultParams) => {
    uploadCalled = true;
    return { url: 'file:///tmp/fake' };
  };

  const observer = new MobileNextTestObserver({
    apiKey: 'key',
    testResult: { uploadReport: 'on' },
    _uploadFn: spyUpload,
  });

  observer.onRunStart({ totalTests: 1 });
  observer.onTestEnd(testInfo, passingTestResult);
  await observer.onRunEnd(runResultReadingFile(path));
  expect(uploadCalled).toBe(true);
  cleanup();
});

test('does not upload when uploadReport is off', async () => {
  let uploadCalled = false;
  const spyUpload = async (_params: UploadTestResultParams) => {
    uploadCalled = true;
    return { url: 'file:///tmp/fake' };
  };

  const observer = new MobileNextTestObserver({
    apiKey: 'key',
    testResult: { uploadReport: 'off' },
    _uploadFn: spyUpload,
  });

  observer.onRunStart({ totalTests: 1 });
  await observer.onRunEnd(runResultWithoutReport('passed'));
  expect(uploadCalled).toBe(false);
});

test('does not upload when no tests were collected', async () => {
  let uploadCalled = false;
  const spyUpload = async (_params: UploadTestResultParams) => {
    uploadCalled = true;
    return { url: 'file:///tmp/fake' };
  };

  const observer = new MobileNextTestObserver({
    apiKey: 'key',
    testResult: { uploadReport: 'on' },
    _uploadFn: spyUpload,
  });

  observer.onRunStart({ totalTests: 0 });
  await observer.onRunEnd(runResultWithoutReport('failed'));
  expect(uploadCalled).toBe(false);
});

test('does not upload when onRunStart was never called', async () => {
  let uploadCalled = false;
  const spyUpload = async (_params: UploadTestResultParams) => {
    uploadCalled = true;
    return { url: 'file:///tmp/fake' };
  };

  const observer = new MobileNextTestObserver({
    apiKey: 'key',
    testResult: { uploadReport: 'on' },
    _uploadFn: spyUpload,
  });

  await observer.onRunEnd(runResultWithoutReport('failed'));
  expect(uploadCalled).toBe(false);
});

test('warns and skips the upload when no JSON report is available', async () => {
  let uploadCalled = false;
  const spyUpload = async (_params: UploadTestResultParams) => {
    uploadCalled = true;
    return { url: 'file:///tmp/fake' };
  };

  const observer = new MobileNextTestObserver({
    apiKey: 'key',
    testResult: { uploadReport: 'on' },
    _uploadFn: spyUpload,
  });

  observer.onRunStart({ totalTests: 1 });
  await observer.onRunEnd(runResultWithoutReport('passed'));
  expect(uploadCalled).toBe(false);
});

test('passes apiKey, name, tags, environment, report, and userAgent to upload function', async () => {
  const reportContent = JSON.stringify({
    suites: [],
    config: {
      metadata: {
        gitCommit: {
          hash: 'abc123def456',
          subject: 'test: add upload reporter',
          author: { name: 'Test Author', email: 'test@example.com', time: 1700000000 },
          branch: 'main',
        },
      },
    },
  });
  const { path, cleanup } = makeTempResultsFile(reportContent);
  let capturedParams: UploadTestResultParams | undefined;
  const spyUpload = async (params: UploadTestResultParams) => {
    capturedParams = params;
    return { url: 'file:///tmp/fake' };
  };

  const observer = new MobileNextTestObserver({
    apiKey: 'my-secret-key',
    testResult: {
      uploadReport: 'on',
      name: 'Nightly Suite',
      tags: ['ci', 'nightly'],
      environment: 'staging',
    },
    _uploadFn: spyUpload,
  });

  observer.onRunStart({ totalTests: 1 });
  await observer.onRunEnd(runResultReadingFile(path));

  expect(capturedParams?.apiKey).toBe('my-secret-key');
  expect(capturedParams?.name).toBe('Nightly Suite');
  expect(capturedParams?.tags).toEqual(['ci', 'nightly']);
  expect(capturedParams?.environment).toBe('staging');
  expect(capturedParams?.userAgent).toMatch(/^mobilewright\//);
  expect(capturedParams?.report).toEqual(JSON.parse(reportContent));
  expect(capturedParams?.gitInfo).toEqual({
    commitSha: 'abc123def456',
    commitMessage: 'test: add upload reporter',
    authorName: 'Test Author',
    branch: 'main',
  });
  cleanup();
});

test('does not throw when upload function rejects', async () => {
  const { path, cleanup } = makeTempResultsFile();
  const failingUpload = async (_params: UploadTestResultParams): Promise<{ url: string }> => {
    throw new Error('network error');
  };

  const observer = new MobileNextTestObserver({
    apiKey: 'key',
    testResult: { uploadReport: 'on' },
    _uploadFn: failingUpload,
  });

  observer.onRunStart({ totalTests: 1 });
  await expect(observer.onRunEnd(runResultReadingFile(path))).resolves.not.toThrow();
  cleanup();
});

test('injects extracted source snippets into the uploaded report at the matching step', async () => {
  const sourceDir = mkdtempSync(join(tmpdir(), 'mw-observer-src-'));
  const sourceFile = join(sourceDir, 'example.spec.ts');
  writeFileSync(sourceFile, ['line1', 'line2', 'await page.tap(\'#button\');', 'line4'].join('\n'));

  const reportContent = JSON.stringify({
    suites: [
      {
        specs: [
          {
            id: 'spec-1',
            tests: [
              {
                results: [
                  {
                    retry: 0,
                    steps: [{ title: 'tap', duration: 5, steps: [] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  const { path, cleanup } = makeTempResultsFile(reportContent);

  let capturedParams: UploadTestResultParams | undefined;
  const spyUpload = async (params: UploadTestResultParams) => {
    capturedParams = params;
    return { url: 'file:///tmp/fake' };
  };

  const observer = new MobileNextTestObserver({
    apiKey: 'key',
    testResult: { uploadReport: 'on' },
    _uploadFn: spyUpload,
  });

  const tapStep: TestStepInfo = {
    title: 'tap',
    category: 'test.step',
    duration: 5,
    location: { file: sourceFile, line: 3, column: 1 },
    steps: [],
  };
  const result: TestResultInfo = { status: 'passed', retry: 0, duration: 5, errors: [], steps: [tapStep] };

  observer.onRunStart({ totalTests: 1 });
  observer.onTestEnd({ id: 'spec-1', title: 'tap', titlePath: ['example.spec.ts', 'tap'] }, result);
  await observer.onRunEnd(runResultReadingFile(path));

  type UploadedStep = { title: string; snippet?: string };
  type UploadedReport = { suites: Array<{ specs: Array<{ tests: Array<{ results: Array<{ steps: UploadedStep[] }> }> }> }> };
  const uploadedReport = capturedParams?.report as unknown as UploadedReport;
  const injectedStep = uploadedReport.suites[0]!.specs[0]!.tests[0]!.results[0]!.steps[0]!;
  expect(injectedStep.snippet).toContain('await page.tap(\'#button\');');

  cleanup();
  rmSync(sourceDir, { recursive: true });
});
