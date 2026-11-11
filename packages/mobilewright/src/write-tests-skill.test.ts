import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Plugin marketplaces install this skill from the repo, and other tools read it from the
// installed npm package, so it must stay packed, exported and reachable from every marketplace.
const SKILL_SPECIFIER = 'mobilewright/skills/mobilewright-write-tests/SKILL.md';
const SKILL_PATH = fileURLToPath(new URL('../skills/mobilewright-write-tests/SKILL.md', import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const MARKETPLACE_FILES = [
  '.claude-plugin/marketplace.json',
  '.cursor-plugin/marketplace.json',
  '.agents/plugins/marketplace.json',
];

const PLUGIN_MANIFESTS = [
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  '.cursor-plugin/plugin.json',
];

const REQUIRED_SECTIONS = [
  '## 1. When to use this skill',
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
};

type MarketplacePlugin = {
  name: string;
  source: string | { path: string };
};

type Marketplace = {
  plugins: MarketplacePlugin[];
};

type PluginManifest = {
  name: string;
  skills: string;
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function resolveSkillThroughPackageExports(): string {
  return createRequire(import.meta.url).resolve(SKILL_SPECIFIER);
}

function pluginDirectoryOf(marketplaceFile: string): string {
  const plugin = readJson<Marketplace>(REPO_ROOT + marketplaceFile).plugins[0];
  const source = typeof plugin.source === 'string' ? plugin.source : plugin.source.path;
  return fileURLToPath(new URL(source + '/', new URL('file://' + REPO_ROOT)));
}

function skillFrontmatter(): Record<string, string> {
  const block = readFileSync(SKILL_PATH, 'utf8').split('---\n')[1];
  const fields = block.split('\n').filter(Boolean).map((line) => {
    const separator = line.indexOf(': ');
    return [line.slice(0, separator), line.slice(separator + 2)];
  });
  return Object.fromEntries(fields);
}

function sectionHeadingsInSkill(): string[] {
  return readFileSync(SKILL_PATH, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('## '));
}

test.describe('mobilewright-write-tests skill', () => {
  test('is published with the npm package', () => {
    expect(readJson<PackageJson>(PACKAGE_DIR + 'package.json').files).toContain('skills');
  });

  test('resolves through the package exports', () => {
    expect(resolveSkillThroughPackageExports()).toBe(SKILL_PATH);
  });

  for (const marketplaceFile of MARKETPLACE_FILES) {
    test(`${marketplaceFile} points at the npm package directory`, () => {
      expect(pluginDirectoryOf(marketplaceFile)).toBe(PACKAGE_DIR);
    });
  }

  for (const manifestFile of PLUGIN_MANIFESTS) {
    test(`${manifestFile} loads skills from the skills directory`, () => {
      const manifest = readJson<PluginManifest>(PACKAGE_DIR + manifestFile);
      expect(manifest.name).toBe('mobilewright');
      expect(manifest.skills).toBe('./skills/');
    });
  }

  test('has a name matching its directory and a description', () => {
    const frontmatter = skillFrontmatter();
    expect(frontmatter.name).toBe('mobilewright-write-tests');
    expect(frontmatter.description).toBeTruthy();
  });

  test('has every required section, in order', () => {
    expect(sectionHeadingsInSkill()).toEqual(REQUIRED_SECTIONS);
  });
});
