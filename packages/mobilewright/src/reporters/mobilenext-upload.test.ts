import { test, expect } from '@playwright/test';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TestResult, FullResult, FullConfig, Suite } from '@playwright/test/reporter';
import MobileNextUploadReporter from './mobilenext-upload.js';
import type { UploadTestResultParams } from '@mobilewright/driver-mobilenext';

function suiteWithTests(count: number): Suite {
  return { allTests: () => new Array(count).fill({}) } as unknown as Suite;
}

function makeTempResultsFile(content: string = '{}'): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'mw-reporter-test-'));
  const filePath = join(dir, 'results.json');
  writeFileSync(filePath, content);
  return { path: filePath, cleanup: () => rmSync(dir, { recursive: true }) };
}

test('does not upload when uploadReport is on-failure and no tests failed', async () => {
  let uploadCalled = false;
  const spyUpload = async (_params: UploadTestResultParams) => {
    uploadCalled = true;
    return { url: 'file:///tmp/fake' };
  };

  const reporter = new MobileNextUploadReporter({
    apiKey: 'key',
    jsonResultsPath: '/tmp/results.json',
    testResult: { uploadReport: 'on-failure' },
    _uploadFn: spyUpload,
  });

  reporter.onBegin({} as FullConfig, suiteWithTests(1));
  const endResult = await reporter.onEnd({ status: 'passed' } as FullResult);
  expect(uploadCalled).toBe(false);
  expect(endResult).toBeUndefined();
});

test('uploads when uploadReport is on-failure and a test failed', async () => {
  const { path, cleanup } = makeTempResultsFile();
  let uploadCalled = false;
  const spyUpload = async (_params: UploadTestResultParams) => {
    uploadCalled = true;
    return { url: 'file:///tmp/fake' };
  };

  const reporter = new MobileNextUploadReporter({
    apiKey: 'key',
    jsonResultsPath: path,
    testResult: { uploadReport: 'on-failure' },
    _uploadFn: spyUpload,
  });

  reporter.onBegin({} as FullConfig, suiteWithTests(1));
  reporter.onTestEnd({} as never, { status: 'failed' } as TestResult);
  await reporter.onEnd({ status: 'failed' } as FullResult);
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

  const reporter = new MobileNextUploadReporter({
    apiKey: 'key',
    jsonResultsPath: path,
    testResult: { uploadReport: 'on-failure' },
    _uploadFn: spyUpload,
  });

  reporter.onBegin({} as FullConfig, suiteWithTests(1));
  reporter.onTestEnd({} as never, { status: 'timedOut' } as TestResult);
  await reporter.onEnd({ status: 'failed' } as FullResult);
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

  const reporter = new MobileNextUploadReporter({
    apiKey: 'key',
    jsonResultsPath: path,
    testResult: {},
    _uploadFn: spyUpload,
  });

  reporter.onBegin({} as FullConfig, suiteWithTests(1));
  await reporter.onEnd({ status: 'passed' } as FullResult);
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

  const reporter = new MobileNextUploadReporter({
    apiKey: 'key',
    jsonResultsPath: path,
    testResult: { uploadReport: 'on' },
    _uploadFn: spyUpload,
  });

  reporter.onBegin({} as FullConfig, suiteWithTests(1));
  await reporter.onEnd({ status: 'passed' } as FullResult);
  expect(uploadCalled).toBe(true);
  cleanup();
});

test('does not upload when uploadReport is off', async () => {
  let uploadCalled = false;
  const spyUpload = async (_params: UploadTestResultParams) => {
    uploadCalled = true;
    return { url: 'file:///tmp/fake' };
  };

  const reporter = new MobileNextUploadReporter({
    apiKey: 'key',
    jsonResultsPath: '/tmp/results.json',
    testResult: { uploadReport: 'off' },
    _uploadFn: spyUpload,
  });

  reporter.onBegin({} as FullConfig, suiteWithTests(1));
  await reporter.onEnd({ status: 'passed' } as FullResult);
  expect(uploadCalled).toBe(false);
});

test('does not upload when no tests were collected', async () => {
  let uploadCalled = false;
  const spyUpload = async (_params: UploadTestResultParams) => {
    uploadCalled = true;
    return { url: 'file:///tmp/fake' };
  };

  const reporter = new MobileNextUploadReporter({
    apiKey: 'key',
    jsonResultsPath: '/tmp/results.json',
    testResult: { uploadReport: 'on' },
    _uploadFn: spyUpload,
  });

  reporter.onBegin({} as FullConfig, suiteWithTests(0));
  await reporter.onEnd({ status: 'failed' } as FullResult);
  expect(uploadCalled).toBe(false);
});

test('does not upload when onBegin was never called', async () => {
  let uploadCalled = false;
  const spyUpload = async (_params: UploadTestResultParams) => {
    uploadCalled = true;
    return { url: 'file:///tmp/fake' };
  };

  const reporter = new MobileNextUploadReporter({
    apiKey: 'key',
    jsonResultsPath: '/tmp/results.json',
    testResult: { uploadReport: 'on' },
    _uploadFn: spyUpload,
  });

  await reporter.onEnd({ status: 'failed' } as FullResult);
  expect(uploadCalled).toBe(false);
});

test('passes apiKey, name, tags, environment, report, and userAgent to upload function', async () => {
  const { path, cleanup } = makeTempResultsFile('{"suites":[]}');
  let capturedParams: UploadTestResultParams | undefined;
  const spyUpload = async (params: UploadTestResultParams) => {
    capturedParams = params;
    return { url: 'file:///tmp/fake' };
  };

  const reporter = new MobileNextUploadReporter({
    apiKey: 'my-secret-key',
    jsonResultsPath: path,
    testResult: {
      uploadReport: 'on',
      name: 'Nightly Suite',
      tags: ['ci', 'nightly'],
      environment: 'staging',
    },
    _uploadFn: spyUpload,
  });

  reporter.onBegin({} as FullConfig, suiteWithTests(1));
  await reporter.onEnd({ status: 'passed' } as FullResult);

  expect(capturedParams?.apiKey).toBe('my-secret-key');
  expect(capturedParams?.name).toBe('Nightly Suite');
  expect(capturedParams?.tags).toEqual(['ci', 'nightly']);
  expect(capturedParams?.environment).toBe('staging');
  expect(capturedParams?.userAgent).toMatch(/^mobilewright\//);
  expect(capturedParams?.report).toEqual({ suites: [] });
  expect(typeof capturedParams?.gitInfo).toBe('object');
  cleanup();
});

test('does not throw when upload function rejects', async () => {
  const { path, cleanup } = makeTempResultsFile();
  const failingUpload = async (_params: UploadTestResultParams): Promise<{ url: string }> => {
    throw new Error('network error');
  };

  const reporter = new MobileNextUploadReporter({
    apiKey: 'key',
    jsonResultsPath: path,
    testResult: { uploadReport: 'on' },
    _uploadFn: failingUpload,
  });

  reporter.onBegin({} as FullConfig, suiteWithTests(1));
  await expect(reporter.onEnd({ status: 'passed' } as FullResult)).resolves.not.toThrow();
  cleanup();
});
