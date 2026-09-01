import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { getPlatformBinary, resolveMobilecliBinary } from './resolve-binary.js';

test('darwin-arm64 maps to the @mobilenext darwin-arm64 package', () => {
  expect(getPlatformBinary('darwin', 'arm64')).toEqual({
    packageName: '@mobilenext/mobilecli-darwin-arm64',
    binaryName: 'mobilecli-darwin-arm64',
  });
});

test('darwin-x64 maps to the @mobilenext darwin-amd64 package', () => {
  expect(getPlatformBinary('darwin', 'x64')).toEqual({
    packageName: '@mobilenext/mobilecli-darwin-amd64',
    binaryName: 'mobilecli-darwin-amd64',
  });
});

test('linux-arm64 maps to the @mobilenext linux-arm64 package', () => {
  expect(getPlatformBinary('linux', 'arm64')).toEqual({
    packageName: '@mobilenext/mobilecli-linux-arm64',
    binaryName: 'mobilecli-linux-arm64',
  });
});

test('linux-x64 maps to the @mobilenext linux-amd64 package', () => {
  expect(getPlatformBinary('linux', 'x64')).toEqual({
    packageName: '@mobilenext/mobilecli-linux-amd64',
    binaryName: 'mobilecli-linux-amd64',
  });
});

test('win32-x64 maps to the @mobilenext windows-amd64 package with an .exe binary', () => {
  expect(getPlatformBinary('win32', 'x64')).toEqual({
    packageName: '@mobilenext/mobilecli-windows-amd64',
    binaryName: 'mobilecli-windows-amd64.exe',
  });
});

test('win32-arm64 maps to the @mobilenext windows-arm64 package with an .exe binary', () => {
  expect(getPlatformBinary('win32', 'arm64')).toEqual({
    packageName: '@mobilenext/mobilecli-windows-arm64',
    binaryName: 'mobilecli-windows-arm64.exe',
  });
});

test('an unsupported platform throws an error', () => {
  expect(() => getPlatformBinary('freebsd', 'x64')).toThrow('Unsupported platform: freebsd-x64');
});

test('an explicit path is returned as-is', () => {
  expect(resolveMobilecliBinary('/opt/bin/mobilecli')).toBe('/opt/bin/mobilecli');
});

test('the resolved binary for this machine exists on disk', () => {
  const binaryPath = resolveMobilecliBinary();
  expect(existsSync(binaryPath)).toBe(true);
});
