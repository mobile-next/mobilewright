import { test, expect } from '@playwright/test';
import { resolveMobilecliBinary } from './resolve-binary.js';

function simulatePlatform(platform: string, arch: string, fn: () => void): void {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const archDescriptor = Object.getOwnPropertyDescriptor(process, 'arch')!;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  Object.defineProperty(process, 'arch', { value: arch, configurable: true });
  try {
    fn();
  } finally {
    Object.defineProperty(process, 'platform', platformDescriptor);
    Object.defineProperty(process, 'arch', archDescriptor);
  }
}

test('resolveMobilecliBinary returns a path to the darwin-arm64 binary', () => {
  simulatePlatform('darwin', 'arm64', () => {
    expect(resolveMobilecliBinary()).toContain('mobilecli-darwin-arm64');
  });
});

test('resolveMobilecliBinary returns a path to the darwin-amd64 binary for x64', () => {
  simulatePlatform('darwin', 'x64', () => {
    expect(resolveMobilecliBinary()).toContain('mobilecli-darwin-amd64');
  });
});

test('resolveMobilecliBinary returns a path to the linux-arm64 binary', () => {
  simulatePlatform('linux', 'arm64', () => {
    expect(resolveMobilecliBinary()).toContain('mobilecli-linux-arm64');
  });
});

test('resolveMobilecliBinary returns a path to the linux-amd64 binary for x64', () => {
  simulatePlatform('linux', 'x64', () => {
    expect(resolveMobilecliBinary()).toContain('mobilecli-linux-amd64');
  });
});

test('resolveMobilecliBinary returns a path to the windows-amd64 binary for win32-x64', () => {
  simulatePlatform('win32', 'x64', () => {
    expect(resolveMobilecliBinary()).toContain('mobilecli-windows-amd64.exe');
  });
});

test('resolveMobilecliBinary throws an error for an unsupported platform', () => {
  simulatePlatform('freebsd', 'x64', () => {
    expect(() => resolveMobilecliBinary()).toThrow('Unsupported platform: freebsd-x64');
  });
});
