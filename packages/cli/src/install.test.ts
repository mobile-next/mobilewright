import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { install, parseSkillTarget, patchGitIgnore, skillDestination } from './install.js';

function tempProject(): { cwd: string; skill: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'mw-install-'));
  const skill = join(cwd, 'SKILL.md');
  writeFileSync(skill, '# skill');
  return { cwd, skill };
}

test('claude is the default target and agents maps to .agents', () => {
  expect(skillDestination({ skills: 'claude', global: false }, '/p')).toBe(join('/p', '.claude', 'skills', 'mobilewright-cli', 'SKILL.md'));
  expect(skillDestination({ skills: 'agents', global: false }, '/p')).toBe(join('/p', '.agents', 'skills', 'mobilewright-cli', 'SKILL.md'));
  expect(skillDestination({ skills: 'claude', global: true }, '/p', '/home/me')).toBe(join('/home/me', '.claude', 'skills', 'mobilewright-cli', 'SKILL.md'));
  expect(() => parseSkillTarget('cursor')).toThrow('unknown --skills value "cursor"');
});

test('a workspace install creates the output dir, copies the skill and reports each step', () => {
  const { cwd, skill } = tempProject();
  const lines = install({ skills: 'agents', global: false }, skill, cwd);
  expect(existsSync(join(cwd, '.mobilewright-cli'))).toBe(true);
  expect(readFileSync(join(cwd, '.agents', 'skills', 'mobilewright-cli', 'SKILL.md'), 'utf8')).toBe('# skill');
  expect(lines[0]).toBe(`✅ Workspace initialized at \`${cwd}\`.`);
  expect(lines[1]).toBe(`✅ Installed skill at \`${join(cwd, '.agents', 'skills', 'mobilewright-cli')}\`.`);
});

test('.gitignore gets the output dir once, and only inside a git checkout', () => {
  const { cwd } = tempProject();
  expect(patchGitIgnore(cwd)).toBe(false);
  mkdirSync(join(cwd, '.git'));
  writeFileSync(join(cwd, '.gitignore'), 'node_modules');
  expect(patchGitIgnore(cwd)).toBe(true);
  expect(readFileSync(join(cwd, '.gitignore'), 'utf8')).toBe('node_modules\n# Mobilewright CLI output (snapshots, videos)\n.mobilewright-cli/\n');
  expect(patchGitIgnore(cwd)).toBe(false);
});
