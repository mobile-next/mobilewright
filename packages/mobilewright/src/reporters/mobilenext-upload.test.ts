import { test, expect } from '@playwright/test';
import type { TestResult, FullResult } from '@playwright/test/reporter';
import MobileNextUploadReporter from './mobilenext-upload.js';
import type { UploadTestResultParams } from '@mobilewright/driver-mobilenext';

test('does not upload when uploadReport is on-failure and no tests failed', async () => {
  let uploadCalled = false;
  const spyUpload = async (_params: UploadTestResultParams) => {
    uploadCalled = true;
    return { url: 'file:///tmp/fake' };
  };

  const reporter = new MobileNextUploadReporter({
    apiKey: 'key',
    jsonResultsPath: '/tmp/results.json',
    outputDir: '/tmp/test-results',
    testResult: { uploadReport: 'on-failure' },
    _uploadFn: spyUpload,
  });

  const endResult = await reporter.onEnd({ status: 'passed' } as FullResult);
  expect(uploadCalled).toBe(false);
  expect(endResult).toBeUndefined();
});

test('uploads when uploadReport is on-failure and a test failed', async () => {
  let uploadCalled = false;
  const spyUpload = async (_params: UploadTestResultParams) => {
    uploadCalled = true;
    return { url: 'file:///tmp/fake' };
  };

  const reporter = new MobileNextUploadReporter({
    apiKey: 'key',
    jsonResultsPath: '/tmp/results.json',
    outputDir: '/tmp/test-results',
    testResult: { uploadReport: 'on-failure' },
    _uploadFn: spyUpload,
  });

  reporter.onTestEnd({} as never, { status: 'failed' } as TestResult);
  await reporter.onEnd({ status: 'failed' } as FullResult);
  expect(uploadCalled).toBe(true);
});

test('uploads when uploadReport is on-failure and a test timed out', async () => {
  let uploadCalled = false;
  const spyUpload = async (_params: UploadTestResultParams) => {
    uploadCalled = true;
    return { url: 'file:///tmp/fake' };
  };

  const reporter = new MobileNextUploadReporter({
    apiKey: 'key',
    jsonResultsPath: '/tmp/results.json',
    outputDir: '/tmp/test-results',
    testResult: { uploadReport: 'on-failure' },
    _uploadFn: spyUpload,
  });

  reporter.onTestEnd({} as never, { status: 'timedOut' } as TestResult);
  await reporter.onEnd({ status: 'failed' } as FullResult);
  expect(uploadCalled).toBe(true);
});

test('always uploads when uploadReport is on regardless of test outcomes', async () => {
  let uploadCalled = false;
  const spyUpload = async (_params: UploadTestResultParams) => {
    uploadCalled = true;
    return { url: 'file:///tmp/fake' };
  };

  const reporter = new MobileNextUploadReporter({
    apiKey: 'key',
    jsonResultsPath: '/tmp/results.json',
    outputDir: '/tmp/test-results',
    testResult: { uploadReport: 'on' },
    _uploadFn: spyUpload,
  });

  await reporter.onEnd({ status: 'passed' } as FullResult);
  expect(uploadCalled).toBe(true);
});

test('passes apiKey, name, tags, environment and paths to upload function', async () => {
  let capturedParams: UploadTestResultParams | undefined;
  const spyUpload = async (params: UploadTestResultParams) => {
    capturedParams = params;
    return { url: 'file:///tmp/fake' };
  };

  const reporter = new MobileNextUploadReporter({
    apiKey: 'my-secret-key',
    jsonResultsPath: '/tmp/r.json',
    outputDir: '/tmp/artifacts',
    testResult: {
      uploadReport: 'on',
      name: 'Nightly Suite',
      tags: ['ci', 'nightly'],
      environment: 'staging',
    },
    _uploadFn: spyUpload,
  });

  await reporter.onEnd({ status: 'passed' } as FullResult);

  expect(capturedParams?.apiKey).toBe('my-secret-key');
  expect(capturedParams?.jsonResultsPath).toBe('/tmp/r.json');
  expect(capturedParams?.outputDir).toBe('/tmp/artifacts');
  expect(capturedParams?.name).toBe('Nightly Suite');
  expect(capturedParams?.tags).toEqual(['ci', 'nightly']);
  expect(capturedParams?.environment).toBe('staging');
});

test('does not throw when upload function rejects', async () => {
  const failingUpload = async (_params: UploadTestResultParams): Promise<{ url: string }> => {
    throw new Error('network error');
  };

  const reporter = new MobileNextUploadReporter({
    apiKey: 'key',
    jsonResultsPath: '/tmp/results.json',
    outputDir: '/tmp/test-results',
    testResult: { uploadReport: 'on' },
    _uploadFn: failingUpload,
  });

  await expect(reporter.onEnd({ status: 'passed' } as FullResult)).resolves.not.toThrow();
});
