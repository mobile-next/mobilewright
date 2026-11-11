import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Mobile MCP reads this guide from the installed package, so it must stay packed and exported.
const GUIDE_SPECIFIER = 'mobilewright/guides/writing-tests.md';
const GUIDE_PATH = fileURLToPath(new URL('../guides/writing-tests.md', import.meta.url));
const PACKAGE_JSON_PATH = fileURLToPath(new URL('../package.json', import.meta.url));

const REQUIRED_SECTIONS = [
  '## 1. When to use this guide',
  '## 2. Detect the project state',
  '## 3. Greenfield setup',
  '## 4. Adapt to the existing suite',
  '## 5. Explore, then write',
  '## 6. App state',
  '## 7. Secrets and logins',
  '## 8. Verify locally',
  '## 9. CI',
  '## 10. Final message to the user',
];

type PackageJson = {
  files: string[];
  exports: Record<string, unknown>;
};

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as PackageJson;
}

function resolveGuideThroughPackageExports(): string {
  return createRequire(import.meta.url).resolve(GUIDE_SPECIFIER);
}

function sectionHeadingsInGuide(): string[] {
  return readFileSync(GUIDE_PATH, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('## '));
}

test.describe('writing-tests guide', () => {
  test('is published with the package', () => {
    expect(readPackageJson().files).toContain('guides');
  });

  test('resolves through the package exports', () => {
    expect(resolveGuideThroughPackageExports()).toBe(GUIDE_PATH);
  });

  test('has every required section, in order', () => {
    expect(sectionHeadingsInGuide()).toEqual(REQUIRED_SECTIONS);
  });
});
