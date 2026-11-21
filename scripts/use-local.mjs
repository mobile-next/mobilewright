#!/usr/bin/env node
// Installs this checkout's mobilewright packages into another project, so an
// unpublished change can be tried there before it's released. Builds and packs
// every public workspace, then points the target's package.json at the tarballs.
//
// The target's package.json and package-lock.json must be committed and clean:
// this tool rewrites both, and `git checkout` is how you go back to the release.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARBALLS_ROOT = join(tmpdir(), 'mobilewright-local');
const TRACKED_FILES = ['package.json', 'package-lock.json'];
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'];

const USAGE = `Usage: npm run use-local -- <project-dir>
       node scripts/use-local.mjs <project-dir>

Builds this mobilewright checkout and installs it into <project-dir>, replacing
the published mobilewright packages it depends on.

Requirements for <project-dir>:
  - a git repository
  - package.json depends on mobilewright or an @mobilewright/* package
  - package.json and package-lock.json are committed with no local changes

To go back to the published version afterwards:
  cd <project-dir> && git checkout package.json package-lock.json && npm install

Example:
  npm run use-local -- ~/git/milliways`;

class UsageError extends Error {}

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

// `npm run` exposes npm's JS entry point; running it with node sidesteps Windows'
// npm.cmd shim, which execFileSync refuses to launch without a shell.
function npm(args, options) {
  const npmCli = process.env.npm_execpath;
  return npmCli
    ? execFileSync(process.execPath, [npmCli, ...args], options)
    : execFileSync('npm', args, options);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function isMobilewrightPackage(name) {
  return name === 'mobilewright' || name.startsWith('@mobilewright/');
}

function readTargetPackageJson(targetDir) {
  const path = join(targetDir, 'package.json');
  if (!existsSync(path)) {
    throw new UsageError(`${targetDir} has no package.json`);
  }
  try {
    return readJson(path);
  } catch (error) {
    throw new UsageError(`${path} is not valid JSON: ${error.message}`);
  }
}

function mobilewrightDependenciesOf(packageJson) {
  return DEPENDENCY_SECTIONS.flatMap((section) =>
    Object.keys(packageJson[section] ?? {}).filter(isMobilewrightPackage));
}

function assertFilesCommittedAndClean(targetDir) {
  if (!gitSucceeds(['rev-parse', '--git-dir'], targetDir)) {
    throw new UsageError(`${targetDir} is not a git repository`);
  }
  for (const file of TRACKED_FILES) {
    if (!gitSucceeds(['ls-files', '--error-unmatch', file], targetDir)) {
      throw new UsageError(`${file} in ${targetDir} is not committed to git`);
    }
  }
  const changes = run('git', ['status', '--porcelain', '--', ...TRACKED_FILES], targetDir).trim();
  if (changes) {
    throw new UsageError(
      `${TRACKED_FILES.join(' and ')} in ${targetDir} have uncommitted changes:\n${changes}\n` +
      `Commit or revert them first (git checkout ${TRACKED_FILES.join(' ')}).`);
  }
}

function gitSucceeds(args, cwd) {
  try {
    execFileSync('git', args, { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function publicWorkspaceDirs() {
  const packagesDir = join(REPO_ROOT, 'packages');
  return readdirSync(packagesDir)
    .map((name) => join(packagesDir, name))
    .filter((dir) => existsSync(join(dir, 'package.json')))
    .filter((dir) => !readJson(join(dir, 'package.json')).private);
}

// Each run packs into a fresh directory so the target's lockfile sees new
// file: specs and reinstalls them, instead of trusting the old integrity hashes.
// Earlier runs are kept: other projects' lockfiles may still point at them.
// ponytail: never pruned, left to the OS temp cleaner; prune here if the directory grows.
function freshTarballsDir() {
  const dir = join(TARBALLS_ROOT, String(Date.now()));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function buildAndPack(tarballsDir) {
  console.log('Building mobilewright...');
  npm(['run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });

  console.log('Packing...');
  const tarballs = {};
  for (const dir of publicWorkspaceDirs()) {
    const [packed] = JSON.parse(npm(['pack', '--json', '--pack-destination', tarballsDir], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
    tarballs[packed.name] = `file:${join(tarballsDir, packed.filename)}`;
    console.log(`  ${packed.name} -> ${packed.filename}`);
  }
  return tarballs;
}

// Direct dependencies are repointed in the section they already live in;
// overrides make nested ones (e.g. mobilewright -> @mobilewright/core) local too.
function withLocalTarballs(packageJson, tarballs) {
  const repointed = Object.fromEntries(DEPENDENCY_SECTIONS
    .filter((section) => packageJson[section])
    .map((section) => [section, Object.fromEntries(Object.entries(packageJson[section])
      .map(([name, spec]) => [name, tarballs[name] ?? spec]))]));
  return { ...packageJson, ...repointed, overrides: mergeOverrides(packageJson.overrides ?? {}, tarballs) };
}

// An object-form override ({ ".": spec, child: spec }) keeps its child entries;
// only its "." spec is replaced.
function mergeOverrides(overrides, tarballs) {
  const local = Object.fromEntries(Object.entries(tarballs).map(([name, spec]) => {
    const existing = overrides[name];
    const isObjectForm = typeof existing === 'object' && existing !== null;
    return [name, isObjectForm ? { ...existing, '.': spec } : spec];
  }));
  return { ...overrides, ...local };
}

function main(args) {
  if (args.length !== 1 || args[0] === '--help' || args[0] === '-h') {
    console.log(USAGE);
    process.exit(args.length === 1 ? 0 : 1);
  }

  const targetDir = resolve(args[0]);
  const packageJson = readTargetPackageJson(targetDir);
  const usedPackages = mobilewrightDependenciesOf(packageJson);
  if (usedPackages.length === 0) {
    throw new UsageError(`${join(targetDir, 'package.json')} does not depend on mobilewright or any @mobilewright/* package`);
  }
  assertFilesCommittedAndClean(targetDir);

  const tarballs = buildAndPack(freshTarballsDir());
  const missing = usedPackages.filter((name) => !tarballs[name]);
  if (missing.length > 0) {
    throw new UsageError(`${basename(targetDir)} depends on ${missing.join(', ')}, which this checkout does not build`);
  }

  const packageJsonPath = join(targetDir, 'package.json');
  writeFileSync(packageJsonPath, JSON.stringify(withLocalTarballs(packageJson, tarballs), null, 2) + '\n');
  console.log(`Installing into ${targetDir}...`);
  npm(['install'], { cwd: targetDir, stdio: 'inherit' });

  console.log(`\nDone. ${targetDir} now uses this checkout (${usedPackages.join(', ')}).`);
  console.log(`To go back: cd ${targetDir} && git checkout ${TRACKED_FILES.join(' ')} && npm install`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof UsageError)) {
    throw error;
  }
  console.error(`use-local: ${error.message}`);
  process.exit(1);
}
