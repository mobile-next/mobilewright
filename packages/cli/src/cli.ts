#!/usr/bin/env node

import { Command } from 'commander';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { HardwareButton, SwipeDirection } from '@mobilewright/protocol';
import { Locator, expect, queryAll } from '@mobilewright/core';
import { resolveMobilecliBinary } from '@mobilewright/driver-mobilecli';
import { connect, listDevices, type Connected } from './connect.js';
import { buildStrategy, type FindOptions } from './find-options.js';
import { formatSnapshot, lineFor, renderSnapshot } from './snapshot.js';
import { loadSession, saveSession } from './session.js';
import { centerOfTarget, parseTarget, resolveRef, type Target } from './target.js';
import { locatorForStrategy, quote } from './codegen.js';
import { formatReport, videoPath, writeSnapshotFile, WORKSPACE_DIR, type Report } from './report.js';
import { install, parseSkillTarget, SKILL_TARGETS } from './install.js';

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };
const SKILL_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'mobilewright-cli', 'SKILL.md');

const BUTTONS: HardwareButton[] = ['HOME', 'BACK', 'POWER', 'VOLUME_UP', 'VOLUME_DOWN', 'ENTER', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'DPAD_CENTER', 'APP_SWITCH', 'LOCK'];
const SWIPE_DIRECTIONS: SwipeDirection[] = ['up', 'down', 'left', 'right'];
const MATCHERS = ['visible', 'hidden', 'enabled', 'disabled', 'checked', 'selected', 'focused', 'text', 'contain-text', 'value', 'count'] as const;
type Matcher = typeof MATCHERS[number];
const DEFAULT_LOG_LIMIT = '100';
const VIDEO_STOP_TIMEOUT_MS = 10_000;

interface GlobalOptions {
  session: string;
  device?: string;
  json?: boolean;
}

/** What a device command hands back: code it ran plus optional text/json result. */
interface ActionResult {
  code?: string;
  result?: string;
  json?: unknown;
  /** Skip the automatic snapshot (e.g. the command already wrote one). */
  snapshotPath?: string | null;
  /** Print the snapshot inline instead of linking a file. */
  snapshotText?: string;
}

const program = new Command();
program
  .name('mobilewright-cli')
  .version(_pkg.version)
  .option('-s, --session <name>', 'session name, keeps device choice and refs between commands', 'default')
  .option('-d, --device <id>', 'device ID (run "mobilewright-cli devices" to list)')
  .option('--json', 'machine-readable output')
  .addHelpText('before', `Agent skill: ${SKILL_PATH}\n`);

function globals(): GlobalOptions {
  return program.opts<GlobalOptions>();
}

function emit(report: Report, json: unknown): void {
  console.log(globals().json ? JSON.stringify(json, null, 2) : formatReport(report));
}

function fail(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (globals().json) {
    console.log(JSON.stringify({ error: message }));
  } else {
    console.error(`error: ${message}`);
  }
  process.exit(1);
}

/** Run an action on the session device, then report code, foreground app and a fresh snapshot. */
async function withDevice(fn: (c: Connected) => Promise<ActionResult | void>): Promise<void> {
  const g = globals();
  let connected: Connected | undefined;
  try {
    connected = await connect(g.session, g.device);
    const action = (await fn(connected)) ?? {};
    const app = await foregroundApp(connected);
    let snapshotPath = action.snapshotPath ?? undefined;
    if (action.snapshotPath === undefined) {
      const snapshot = renderSnapshot(await connected.device.screen.viewTree());
      saveSession(g.session, { ...loadSession(g.session), refs: snapshot.refs });
      snapshotPath = writeSnapshotFile(formatSnapshot(snapshot.lines));
    }
    emit(
      { code: action.code, result: action.result, deviceId: connected.session.deviceId, app, snapshotPath, snapshotText: action.snapshotText },
      { ok: true, code: action.code, result: action.json ?? action.result, device: connected.session.deviceId, app, snapshot: action.snapshotText ?? snapshotPath },
    );
  } catch (err) {
    // Close before exiting: process.exit() inside catch would skip finally and
    // leave the auto-started mobilecli server orphaned for the next command.
    await connected?.close().catch(() => {});
    fail(err);
  }
  await connected.close().catch(() => {});
}

/** Foreground app is metadata only; some Android devices cannot report it. */
async function foregroundApp(c: Connected): Promise<string | undefined> {
  try {
    const app = await c.device.getForegroundApp();
    return app.bundleId || undefined;
  } catch {
    return undefined;
  }
}

/** Parse a CLI number: finite and non-negative, optionally an integer. */
function parseNonNegative(value: string, flag: string, integer = false): number {
  const n = Number(value);
  const valid = Number.isFinite(n) && n >= 0 && (!integer || Number.isInteger(n));
  if (!valid) {
    throw new Error(`${flag} must be a non-negative ${integer ? 'integer' : 'number'}, got: ${value}`);
  }
  return n;
}

function addFindOptions(cmd: Command): Command {
  return cmd
    .option('--text <text>', 'match by visible text (use /regex/ for a pattern)')
    .option('--role <role>', 'match by semantic role, e.g. button, textfield')
    .option('--name <name>', 'with --role: accessible name (use /regex/ for a pattern)')
    .option('--test-id <id>', 'match by test ID (accessibility id / resource-id)')
    .option('--label <label>', 'match by accessibility label')
    .option('--placeholder <text>', 'match by placeholder text')
    .option('--type <type>', 'match by raw native type, e.g. XCUIElementTypeCell')
    .option('--exact', 'require an exact text/label/placeholder match')
    .option('--has-text <text>', 'keep only elements whose subtree contains this text')
    .option('--has-not-text <text>', 'drop elements whose subtree contains this text')
    .option('--nth <index>', 'pick the n-th match (0-based, negative from the end)')
    .option('--first', 'pick the first match')
    .option('--last', 'pick the last match');
}

/** Code for an action on a target: locator chain for refs, screen coordinates otherwise. */
function targetCode(target: Target, c: Connected, method: string, pointMethod: string, args = ''): string {
  const info = resolveRef(target, c.session.refs);
  if (info) {
    return `await ${info.locator}.${method}(${args});`;
  }
  const { x, y } = centerOfTarget(target, c.session.refs);
  return `await screen.${pointMethod}(${x}, ${y});`;
}

// ── setup ──────────────────────────────────────────────────────────────
program
  .command('install')
  .description('initialize the workspace and install the mobilewright-cli agent skill')
  .option('--skills <target>', `where to install the skill: ${SKILL_TARGETS.join(' (default), ')}`, 'claude')
  .option('-g, --global', 'install the skill into the home directory instead of the workspace')
  .action((opts: { skills: string; global?: boolean }) => {
    try {
      const lines = install({ skills: parseSkillTarget(opts.skills), global: !!opts.global }, SKILL_PATH);
      console.log(globals().json ? JSON.stringify({ ok: true, lines }, null, 2) : lines.join('\n'));
    } catch (err) {
      fail(err);
    }
  });

program
  .command('devices')
  .description('list connected devices, simulators and emulators')
  .action(async () => {
    try {
      const devices = await listDevices();
      const result = devices.length === 0
        ? 'no devices found, run "mobilewright doctor"'
        : devices.map((d) => `${d.id}  ${d.platform}  ${d.type}  ${d.state}  ${d.name}`).join('\n');
      emit({ result }, devices);
    } catch (err) {
      fail(err);
    }
  });

// ── apps ───────────────────────────────────────────────────────────────
program
  .command('apps')
  .description('list installed apps')
  .action(() => withDevice(async ({ device }) => {
    const apps = await device.listApps();
    return {
      code: 'await device.listApps();',
      result: apps.map((a) => [a.bundleId, a.name, a.version].filter(Boolean).join('  ')).join('\n'),
      json: apps,
      snapshotPath: null,
    };
  }));

program
  .command('app-install <path>')
  .description('install an app from a .apk (Android) or .ipa/.zip/.app (iOS)')
  .action((path: string) => withDevice(async ({ device }) => {
    const full = resolve(process.cwd(), path);
    await device.installApp(full);
    return { code: `await device.installApp(${quote(path)});`, snapshotPath: null };
  }));

program
  .command('launch <bundleId>')
  .description('launch an app and wait for it to reach the foreground')
  .action((bundleId: string) => withDevice(async ({ device }) => {
    await device.launchApp(bundleId);
    return { code: `await device.launchApp(${quote(bundleId)});` };
  }));

program
  .command('terminate <bundleId>')
  .description('terminate a running app')
  .action((bundleId: string) => withDevice(async ({ device }) => {
    await device.terminateApp(bundleId);
    return { code: `await device.terminateApp(${quote(bundleId)});` };
  }));

program
  .command('url <url>')
  .description('open a URL or deep link on the device')
  .action((url: string) => withDevice(async ({ device }) => {
    await device.openUrl(url);
    return { code: `await device.openUrl(${quote(url)});` };
  }));

// ── snapshot / find ────────────────────────────────────────────────────
program
  .command('snapshot')
  .description('print the screen as a compact tree with element refs (e1, e2, ...)')
  .action(() => withDevice(async ({ device }) => {
    const snapshot = renderSnapshot(await device.screen.viewTree());
    saveSession(globals().session, { ...loadSession(globals().session), refs: snapshot.refs });
    return { snapshotPath: null, snapshotText: formatSnapshot(snapshot.lines) };
  }));

addFindOptions(program.command('find'))
  .description('find elements by locator and print their refs')
  .action((opts: FindOptions) => withDevice(async ({ device }) => {
    const strategy = buildStrategy(opts);
    const tree = await device.screen.viewTree();
    const snapshot = renderSnapshot(tree);
    saveSession(globals().session, { ...loadSession(globals().session), refs: snapshot.refs });
    const lines = queryAll(tree, strategy).map((node) => lineFor(node, snapshot.nodes.get(node)!));
    return {
      code: `${locatorForStrategy(strategy)};`,
      result: lines.length === 0 ? 'no matches' : formatSnapshot(lines),
      json: lines,
      snapshotPath: writeSnapshotFile(formatSnapshot(snapshot.lines)),
    };
  }));

// ── pointer actions ────────────────────────────────────────────────────
function pointerCommand(name: string, description: string, method: string, pointMethod: string, act: (c: Connected, x: number, y: number) => Promise<void>): void {
  program
    .command(`${name} <target>`)
    .description(`${description} — target is a ref (e12) or coordinates (x,y)`)
    .action((arg: string) => withDevice(async (c) => {
      const target = parseTarget(arg);
      const { x, y } = centerOfTarget(target, c.session.refs);
      await act(c, x, y);
      return { code: targetCode(target, c, method, pointMethod) };
    }));
}

pointerCommand('tap', 'tap an element', 'tap', 'tap', ({ device }, x, y) => device.screen.tap(x, y));
pointerCommand('doubletap', 'double-tap an element', 'doubleTap', 'doubleTap', ({ device }, x, y) => device.screen.doubleTap(x, y));
pointerCommand('longpress', 'long-press an element', 'longPress', 'longPress', ({ device }, x, y) => device.screen.longPress(x, y));

program
  .command('fill <target> <text>')
  .description('tap a text field, clear it and type text — target is a ref (e12) or coordinates (x,y)')
  .action((arg: string, text: string) => withDevice(async (c) => {
    const target = parseTarget(arg);
    const { x, y } = centerOfTarget(target, c.session.refs);
    await c.device.screen.tap(x, y);
    await c.driver.clearText();
    await c.driver.typeText(text);
    return { code: targetCode(target, c, 'fill', 'tap', quote(text)) };
  }));

// ── keyboard / hardware ────────────────────────────────────────────────
program
  .command('type <text>')
  .description('type text into the focused element, without tapping or clearing first')
  .action((text: string) => withDevice(async ({ driver }) => {
    await driver.typeText(text);
    return { code: `// typed ${quote(text)} into the focused element; in a test use locator.fill()` };
  }));

program
  .command('press <keys...>')
  .description('press keyboard keys, e.g. Enter, backspace, cmd+a')
  .action((keys: string[]) => withDevice(async ({ driver }) => {
    await driver.pressKeys(keys);
    return { code: `// pressed keys: ${keys.join(' ')}` };
  }));

program
  .command('button <name>')
  .description(`press a hardware button: ${BUTTONS.join(', ')}`)
  .action((name: string) => withDevice(async ({ device }) => {
    const button = name.toUpperCase() as HardwareButton;
    if (!BUTTONS.includes(button)) {
      throw new Error(`unknown button "${name}", expected one of: ${BUTTONS.join(', ')}`);
    }
    await device.screen.pressButton(button);
    return { code: `await screen.pressButton(${quote(button)});` };
  }));

program
  .command('swipe <direction>')
  .description('swipe from the screen center: up, down, left, right')
  .action((direction: string) => withDevice(async ({ device }) => {
    if (!SWIPE_DIRECTIONS.includes(direction as SwipeDirection)) {
      throw new Error(`unknown direction "${direction}", expected one of: ${SWIPE_DIRECTIONS.join(', ')}`);
    }
    await device.screen.swipe(direction as SwipeDirection);
    return { code: `await screen.swipe(${quote(direction)});` };
  }));

// ── screenshot / video / logs ──────────────────────────────────────────
program
  .command('screenshot [target]')
  .description('save a screenshot of the screen, or of one element when a ref is given')
  .option('-o, --output <file>', 'output file path', 'screenshot.png')
  .action((arg: string | undefined, opts: { output: string }) => withDevice(async (c) => {
    const path = resolve(process.cwd(), opts.output);
    const info = arg === undefined ? undefined : resolveRef(parseTarget(arg), c.session.refs);
    if (info) {
      await c.device.screen.screenshot({ path, clip: info.bounds });
      return { code: `await ${info.locator}.screenshot();`, result: `saved ${path}`, snapshotPath: null };
    }
    await c.device.screen.screenshot({ path });
    return { code: `await screen.screenshot({ path: ${quote(opts.output)} });`, result: `saved ${path}`, snapshotPath: null };
  }));

program
  .command('video-start [filename]')
  .description(`start recording the screen to an MP4 (default: ${WORKSPACE_DIR}/video-<timestamp>.mp4)`)
  .action((filename: string | undefined) => withDevice(async ({ session }) => {
    if (session.video) {
      throw new Error(`already recording to ${session.video.output}, run "video-stop" first`);
    }
    const output = resolve(process.cwd(), filename ?? videoPath());
    mkdirSync(dirname(output), { recursive: true });
    // ponytail: recording lives in a detached mobilecli process because this
    // command's own server is torn down on exit; a daemon would make this an RPC.
    const child = spawn(resolveMobilecliBinary(), ['screenrecord', '--device', session.deviceId!, '-o', output, '--silent'], {
      detached: true,
      stdio: ['ignore', openSync(join(dirname(output), '.screenrecord.log'), 'a'), openSync(join(dirname(output), '.screenrecord.log'), 'a')],
    });
    child.unref();
    saveSession(globals().session, { ...loadSession(globals().session), video: { pid: child.pid!, output } });
    return { code: `await device.startRecording({ output: ${quote(filename ?? output)} });`, result: `recording to ${output}`, snapshotPath: null };
  }));

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

program
  .command('video-stop')
  .description('stop the screen recording and print the MP4 path')
  .action(() => {
    const name = globals().session;
    const session = loadSession(name);
    if (!session.video) {
      fail('not recording, run "video-start" first');
    }
    const { pid, output } = session.video;
    if (isRunning(pid)) {
      process.kill(pid, 'SIGINT');
    }
    const deadline = Date.now() + VIDEO_STOP_TIMEOUT_MS;
    while (isRunning(pid) && Date.now() < deadline) {
      spawnSync('sleep', ['0.2']);
    }
    saveSession(name, { ...session, video: undefined });
    if (!existsSync(output)) {
      fail(`recorder exited but ${output} was not written, see ${join(dirname(output), '.screenrecord.log')}`);
    }
    emit({ code: 'await device.stopRecording();', result: `saved ${output}` }, { ok: true, video: output });
  });

program
  .command('logs')
  .description('print recent device logs')
  .option('--filter <key=value...>', 'include (key=value) or exclude (key!=value); keys: pid, process, tag, level, subsystem, category, message')
  .option('--limit <n>', 'stop after this many entries', DEFAULT_LOG_LIMIT)
  .action(async (opts: { filter?: string[]; limit: string }) => {
    try {
      const { session } = await connect(globals().session, globals().device).then(async (c) => { await c.close(); return c; });
      const args = ['device', 'logs', '--device', session.deviceId!, '--limit', opts.limit];
      for (const f of opts.filter ?? []) {
        args.push('--filter', f);
      }
      const run = spawnSync(resolveMobilecliBinary(), args, { stdio: 'inherit' });
      process.exitCode = run.status ?? 1;
    } catch (err) {
      fail(err);
    }
  });

// ── expect ─────────────────────────────────────────────────────────────
addFindOptions(program.command('expect <matcher> [value]'))
  .description(`assert on a located element with auto-wait; matcher is one of ${MATCHERS.join(', ')}`)
  .option('--timeout <ms>', 'how long to wait for the assertion to hold', '5000')
  .action((matcher: string, value: string | undefined, opts: FindOptions & { timeout: string }) => withDevice(async ({ driver }) => {
    if (!MATCHERS.includes(matcher as Matcher)) {
      throw new Error(`unknown matcher "${matcher}", expected one of: ${MATCHERS.join(', ')}`);
    }
    const strategy = buildStrategy(opts);
    const locator = new Locator(driver, strategy);
    const timeout = parseNonNegative(opts.timeout, '--timeout');
    await runMatcher(locator, matcher as Matcher, value, timeout);
    return {
      code: `await expect(${locatorForStrategy(strategy)}).${matcherCode(matcher as Matcher, value)};`,
      result: `ok: ${matcher}${value === undefined ? '' : ` ${JSON.stringify(value)}`}`,
    };
  }));

function requireValue(matcher: Matcher, value: string | undefined): string {
  if (value === undefined) {
    throw new Error(`matcher "${matcher}" needs a value`);
  }
  return value;
}

const MATCHER_METHODS: Record<Matcher, string> = {
  'visible': 'toBeVisible', 'hidden': 'toBeHidden', 'enabled': 'toBeEnabled', 'disabled': 'toBeDisabled',
  'checked': 'toBeChecked', 'selected': 'toBeSelected', 'focused': 'toBeFocused',
  'text': 'toHaveText', 'contain-text': 'toContainText', 'value': 'toHaveValue', 'count': 'toHaveCount',
};

function matcherCode(matcher: Matcher, value: string | undefined): string {
  if (value === undefined) { return `${MATCHER_METHODS[matcher]}()`; }
  return `${MATCHER_METHODS[matcher]}(${matcher === 'count' ? Number(value) : quote(value)})`;
}

async function runMatcher(locator: Locator, matcher: Matcher, value: string | undefined, timeout: number): Promise<void> {
  const assertion = expect(locator);
  switch (matcher) {
    case 'visible': return assertion.toBeVisible({ timeout });
    case 'hidden': return assertion.toBeHidden({ timeout });
    case 'enabled': return assertion.toBeEnabled({ timeout });
    case 'disabled': return assertion.toBeDisabled({ timeout });
    case 'checked': return assertion.toBeChecked({ timeout });
    case 'selected': return assertion.toBeSelected({ timeout });
    case 'focused': return assertion.toBeFocused({ timeout });
    case 'text': return assertion.toHaveText(requireValue(matcher, value), { timeout });
    case 'contain-text': return assertion.toContainText(requireValue(matcher, value), { timeout });
    case 'value': return assertion.toHaveValue(requireValue(matcher, value), { timeout });
    case 'count': return assertion.toHaveCount(parseNonNegative(requireValue(matcher, value), 'count', true), { timeout });
  }
}

program.parseAsync(process.argv).catch(fail);
