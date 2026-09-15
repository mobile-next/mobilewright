import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { WORKSPACE_DIR } from './report.js';

export const SKILL_TARGETS = ['claude', 'agents'] as const;
export type SkillTarget = typeof SKILL_TARGETS[number];

export interface InstallOptions {
  skills: SkillTarget;
  global: boolean;
}

const SKILL_DIRS: Record<SkillTarget, string> = { claude: '.claude', agents: '.agents' };

export function parseSkillTarget(value: string): SkillTarget {
  if (!SKILL_TARGETS.includes(value as SkillTarget)) {
    throw new Error(`unknown --skills value "${value}", expected one of: ${SKILL_TARGETS.join(', ')}`);
  }
  return value as SkillTarget;
}

/** Where the skill lands: <root>/.claude/skills/mobilewright-cli or <root>/.agents/skills/mobilewright-cli. */
export function skillDestination(opts: InstallOptions, cwd: string, home = homedir()): string {
  return join(opts.global ? home : cwd, SKILL_DIRS[opts.skills], 'skills', 'mobilewright-cli', 'SKILL.md');
}

/** Add the workspace dir to .gitignore when cwd is a git checkout. Returns true when a line was added. */
export function patchGitIgnore(cwd: string): boolean {
  if (!existsSync(join(cwd, '.git'))) {
    return false;
  }
  const path = join(cwd, '.gitignore');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (existing.split('\n').some((line) => line.trim() === `${WORKSPACE_DIR}/`)) {
    return false;
  }
  const separator = existing && !existing.endsWith('\n') ? '\n' : '';
  appendFileSync(path, `${separator}# Mobilewright CLI output (snapshots, videos)\n${WORKSPACE_DIR}/\n`);
  return true;
}

/** Initialize the workspace and copy the skill; returns the ✅ lines to print. */
export function install(opts: InstallOptions, skillSource: string, cwd = process.cwd()): string[] {
  const lines: string[] = [];
  if (!opts.global) {
    mkdirSync(join(cwd, WORKSPACE_DIR), { recursive: true });
    lines.push(`✅ Workspace initialized at \`${cwd}\`.`);
    if (patchGitIgnore(cwd)) {
      lines.push(`✅ Added \`${WORKSPACE_DIR}/\` to \`.gitignore\`.`);
    }
  }
  const dest = skillDestination(opts, cwd);
  mkdirSync(join(dest, '..'), { recursive: true });
  copyFileSync(skillSource, dest);
  lines.push(`✅ Installed skill at \`${dirname(dest)}\`.`);
  return lines;
}
