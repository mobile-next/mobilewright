#!/usr/bin/env node

import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { HardwareButton, SwipeDirection } from '@mobilewright/protocol';
import { Locator, expect, queryAll } from '@mobilewright/core';
import { connect, listDevices } from './connect.js';
import { buildStrategy, type FindOptions } from './find-options.js';
import { formatSnapshot, lineFor, renderSnapshot } from './snapshot.js';
import { saveSession } from './session.js';
import { centerOfTarget, parseTarget } from './target.js';

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };

const BUTTONS: HardwareButton[] = ['HOME', 'BACK', 'POWER', 'VOLUME_UP', 'VOLUME_DOWN', 'ENTER', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'DPAD_CENTER', 'APP_SWITCH', 'LOCK'];
const SWIPE_DIRECTIONS: SwipeDirection[] = ['up', 'down', 'left', 'right'];
const MATCHERS = ['visible', 'hidden', 'enabled', 'disabled', 'checked', 'selected', 'focused', 'text', 'contain-text', 'value', 'count'] as const;
type Matcher = typeof MATCHERS[number];

interface GlobalOptions {
  session: string;
  device?: string;
  json?: boolean;
}

const program = new Command();
program
  .name('mobilewright-cli')
  .version(_pkg.version)
  .option('-s, --session <name>', 'session name, keeps device choice and refs between commands', 'default')
  .option('-d, --device <id>', 'device ID (run "mobilewright-cli devices" to list)')
  .option('--json', 'machine-readable output');

function globals(): GlobalOptions {
  return program.opts<GlobalOptions>();
}

function emit(human: string, json: unknown): void {
  console.log(globals().json ? JSON.stringify(json, null, 2) : human);
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

/** Run an action against the session device, then report the foreground app. */
async function withDevice(fn: (c: Awaited<ReturnType<typeof connect>>) => Promise<unknown>): Promise<void> {
  const g = globals();
  let connected: Awaited<ReturnType<typeof connect>> | undefined;
  try {
    connected = await connect(g.session, g.device);
    const result = await fn(connected);
    const app = await foregroundApp(connected);
    if (g.json) {
      console.log(JSON.stringify({ ok: true, device: connected.session.deviceId, app, result }, null, 2));
    } else {
      if (typeof result === 'string' && result) { console.log(result); }
      console.log(`# device: ${connected.session.deviceId}  app: ${app ?? 'unknown'}`);
    }
  } catch (err) {
    // Close before exiting: process.exit() inside catch would skip finally and
    // leave the auto-started mobilecli server orphaned for the next command.
    await connected?.close().catch(() => {});
    fail(err);
  }
  await connected.close().catch(() => {});
}

/** Foreground app is metadata only; some Android devices cannot report it. */
async function foregroundApp(c: Awaited<ReturnType<typeof connect>>): Promise<string | undefined> {
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

// ── devices ────────────────────────────────────────────────────────────
program
  .command('devices')
  .description('list connected devices, simulators and emulators')
  .action(async () => {
    try {
      const devices = await listDevices();
      const human = devices.length === 0
        ? 'no devices found, run "mobilewright doctor"'
        : devices.map((d) => `${d.id}  ${d.platform}  ${d.type}  ${d.state}  ${d.name}`).join('\n');
      emit(human, devices);
    } catch (err) {
      fail(err);
    }
  });

// ── app lifecycle ──────────────────────────────────────────────────────
program
  .command('launch <bundleId>')
  .description('launch an app and wait for it to reach the foreground')
  .action((bundleId: string) => withDevice(async ({ device }) => {
    await device.launchApp(bundleId);
  }));

program
  .command('terminate <bundleId>')
  .description('terminate a running app')
  .action((bundleId: string) => withDevice(async ({ device }) => {
    await device.terminateApp(bundleId);
  }));

program
  .command('url <url>')
  .description('open a URL or deep link on the device')
  .action((url: string) => withDevice(async ({ device }) => {
    await device.openUrl(url);
  }));

// ── snapshot / find ────────────────────────────────────────────────────
program
  .command('snapshot')
  .description('print the screen as a compact tree with element refs (e1, e2, ...)')
  .action(() => withDevice(async ({ device, session }) => {
    const tree = await device.screen.viewTree();
    const snapshot = renderSnapshot(tree);
    saveSession(globals().session, { ...session, refs: snapshot.refs });
    if (globals().json) { return snapshot.lines; }
    return formatSnapshot(snapshot.lines);
  }));

addFindOptions(program.command('find'))
  .description('find elements by locator and print their refs')
  .action((opts: FindOptions) => withDevice(async ({ device, session }) => {
    const strategy = buildStrategy(opts);
    const tree = await device.screen.viewTree();
    const snapshot = renderSnapshot(tree);
    saveSession(globals().session, { ...session, refs: snapshot.refs });
    const lines = queryAll(tree, strategy).map((node) => lineFor(node, snapshot.nodes.get(node)!));
    if (globals().json) { return lines; }
    return lines.length === 0 ? 'no matches' : formatSnapshot(lines);
  }));

// ── pointer actions ────────────────────────────────────────────────────
function pointerCommand(name: string, description: string, act: (c: Awaited<ReturnType<typeof connect>>, x: number, y: number) => Promise<void>): void {
  program
    .command(`${name} <target>`)
    .description(`${description} — target is a ref (e12) or coordinates (x,y)`)
    .action((target: string) => withDevice(async (c) => {
      const { x, y } = centerOfTarget(parseTarget(target), c.session.refs);
      await act(c, x, y);
    }));
}

pointerCommand('tap', 'tap an element', ({ device }, x, y) => device.screen.tap(x, y));
pointerCommand('doubletap', 'double-tap an element', ({ device }, x, y) => device.screen.doubleTap(x, y));
pointerCommand('longpress', 'long-press an element', ({ device }, x, y) => device.screen.longPress(x, y));
program
  .command('fill <target> <text>')
  .description('tap a text field, clear it and type text — target is a ref (e12) or coordinates (x,y)')
  .action((target: string, text: string) => withDevice(async ({ device, driver, session }) => {
    const { x, y } = centerOfTarget(parseTarget(target), session.refs);
    await device.screen.tap(x, y);
    await driver.clearText();
    await driver.typeText(text);
  }));

// ── keyboard / hardware ────────────────────────────────────────────────
program
  .command('type <text>')
  .description('type text into the focused element')
  .action((text: string) => withDevice(async ({ driver }) => {
    await driver.typeText(text);
  }));

program
  .command('press <keys...>')
  .description('press keyboard keys, e.g. Enter, backspace, cmd+a')
  .action((keys: string[]) => withDevice(async ({ driver }) => {
    await driver.pressKeys(keys);
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
  }));

program
  .command('swipe <direction>')
  .description('swipe from the screen center: up, down, left, right')
  .action((direction: string) => withDevice(async ({ device }) => {
    if (!SWIPE_DIRECTIONS.includes(direction as SwipeDirection)) {
      throw new Error(`unknown direction "${direction}", expected one of: ${SWIPE_DIRECTIONS.join(', ')}`);
    }
    await device.screen.swipe(direction as SwipeDirection);
  }));

// ── screenshot ─────────────────────────────────────────────────────────
program
  .command('screenshot')
  .description('save a screenshot of the device screen')
  .option('-o, --output <file>', 'output file path', 'screenshot.png')
  .action((opts: { output: string }) => withDevice(async ({ device }) => {
    const buffer = await device.screen.screenshot();
    const path = resolve(process.cwd(), opts.output);
    writeFileSync(path, buffer);
    return `saved ${path}`;
  }));

// ── expect ─────────────────────────────────────────────────────────────
addFindOptions(program.command('expect <matcher> [value]'))
  .description(`assert on a located element with auto-wait; matcher is one of ${MATCHERS.join(', ')}`)
  .option('--timeout <ms>', 'how long to wait for the assertion to hold', '5000')
  .action((matcher: string, value: string | undefined, opts: FindOptions & { timeout: string }) => withDevice(async ({ driver }) => {
    if (!MATCHERS.includes(matcher as Matcher)) {
      throw new Error(`unknown matcher "${matcher}", expected one of: ${MATCHERS.join(', ')}`);
    }
    const locator = new Locator(driver, buildStrategy(opts));
    const timeout = parseNonNegative(opts.timeout, '--timeout');
    await runMatcher(locator, matcher as Matcher, value, timeout);
    return `ok: ${matcher}${value === undefined ? '' : ` ${JSON.stringify(value)}`}`;
  }));

function requireValue(matcher: Matcher, value: string | undefined): string {
  if (value === undefined) {
    throw new Error(`matcher "${matcher}" needs a value`);
  }
  return value;
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
