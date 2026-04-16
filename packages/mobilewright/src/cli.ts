#!/usr/bin/env node

import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequire } from 'node:module';
import type { DeviceInfo } from '@mobilewright/protocol';
import { MobilecliDriver, DEFAULT_URL, resolveMobilecliBinary } from '@mobilewright/driver-mobilecli';
import { ensureMobilecliReachable } from './server.js';
import { loadConfig } from './config.js';
import { gatherChecks, renderTerminal, renderJSON } from './commands/doctor.js';
import { brandReport } from './reporter.js';

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };

const HTML_REPORT_DIR = 'mobilewright-report';
const TEMPLATES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

const program = new Command();
program.name('mobilewright');
program.version('0.0.1');

// ── test ───────────────────────────────────────────────────────────────
program
  .command('test [test-filter...]')
  .description('run tests')
  .option('-c, --config <file>', 'configuration file')
  .option('--reporter <reporter>', 'reporter to use (e.g. list, html, json)')
  .option('--grep <grep>', 'only run tests matching this regex')
  .option('--grep-invert <grep>', 'only run tests NOT matching this regex')
  .option('--project <name...>', 'only run tests from specified projects')
  .option('--retries <retries>', 'maximum retry count for flaky tests')
  .option('--timeout <timeout>', 'test timeout in milliseconds')
  .option('--workers <workers>', 'number of concurrent workers')
  .option('--pass-with-no-tests', 'exit with code 0 when no tests found')
  .option('--list', 'list all tests without running them')
  .action(async (args: string[], opts: Record<string, unknown>) => {
    const { loadConfigFromFile } = await import('playwright/lib/common/configLoader');
    const { runAllTestsWithConfig } = await import('playwright/lib/runner/testRunner');

    const overrides: Record<string, unknown> = {};
    if (opts.timeout) overrides.timeout = Number(opts.timeout);
    if (opts.retries) overrides.retries = Number(opts.retries);
    if (opts.workers) overrides.workers = opts.workers;
    if (opts.reporter) {
      const names = (opts.reporter as string).split(',');
      overrides.reporter = names.map((name: string) => {
        const n = name.trim();
        if (n === 'html') return [n, { outputFolder: HTML_REPORT_DIR }];
        return [n];
      });
    }

    // Default to mobilewright.config.{ts,js} if no --config is given.
    let configFile = opts.config as string | undefined;
    if (!configFile) {
      for (const ext of ['.ts', '.js', '.mts', '.mjs', '.cts', '.cjs']) {
        const candidate = resolve(process.cwd(), 'mobilewright.config' + ext);
        if (existsSync(candidate)) {
          configFile = candidate;
          break;
        }
      }
    }

    const config = await loadConfigFromFile(configFile, overrides);
    const c = config as Record<string, unknown>;
    c.cliArgs = args;
    if (opts.grep) c.cliGrep = opts.grep;
    if (opts.grepInvert) c.cliGrepInvert = opts.grepInvert;
    if (opts.project) c.cliProjectFilter = opts.project;
    if (opts.list) c.cliListOnly = true;
    if (opts.passWithNoTests) c.cliPassWithNoTests = true;

    const status = await runAllTestsWithConfig(config);

    // Post-process HTML report with Mobilewright branding
    if (opts.reporter && (opts.reporter as string).split(',').some(r => r.trim() === 'html')) {
      try {
        brandReport(resolve(process.cwd(), HTML_REPORT_DIR));
      } catch {
        // Report branding is best-effort; don't fail the test run
      }
    }

    const exitCode = status === 'interrupted' ? 130 : status === 'passed' ? 0 : 1;
    process.exit(exitCode);
  });

// ── show-report ────────────────────────────────────────────────────────
// Delegate to Playwright's built-in show-report, which handles
// content types, trace files, screenshots, and attachments correctly.
program
  .command('show-report [report]')
  .description('show HTML report')
  .option('--host <host>', 'host to serve report on', 'localhost')
  .option('--port <port>', 'port to serve report on', '9323')
  .action(async (report: string | undefined, opts: { host: string; port: string }) => {
    const { program: pwProgram } = await import('playwright/lib/program');
    const args = ['node', 'playwright', 'show-report'];
    args.push(report || HTML_REPORT_DIR);
    args.push('--host', opts.host, '--port', opts.port);
    await pwProgram.parseAsync(args);
  });

function printDevicesTable(devices: DeviceInfo[]): void {
  console.log(
    padRight('ID', 40) +
      padRight('Name', 25) +
      padRight('Platform', 10) +
      padRight('Type', 12) +
      padRight('State', 10),
  );
  console.log('-'.repeat(97));

  for (const d of devices) {
    console.log(
      padRight(d.id, 40) +
        padRight(d.name, 25) +
        padRight(d.platform, 10) +
        padRight(d.type, 12) +
        padRight(d.state, 10),
    );
  }
}

// ── devices ────────────────────────────────────────────────────────────
program
  .command('devices')
  .description('list all connected devices, simulators, and emulators')
  .action(() => {
    const driver = new MobilecliDriver();
    const devices = driver.listDevices();

    if (devices.length === 0) {
      console.log('No devices found, try using \'mobilewright doctor\' command');
      return;
    }

    printDevicesTable(devices);
  });

// ── screenshot ────────────────────────────────────────────────────────

async function resolveDeviceId(
  explicit: string | undefined,
  driver: MobilecliDriver,
): Promise<string> {
  if (explicit) {
    return explicit;
  }

  const config = await loadConfig();
  if (config.deviceId) {
    return config.deviceId;
  }

  const devices = driver.listDevices();
  const online = devices.filter(d => d.state === 'online');
  if (online.length === 0) {
    console.error('No online devices found. Specify one with --device <id>.');
    process.exit(1);
  }
  if (online.length > 1) {
    console.error('Multiple devices found. Specify one with --device <id>:\n');
    printDevicesTable(online);
    process.exit(1);
  }
  return online[0].id;
}

program
  .command('screenshot')
  .description('take a screenshot of a connected device')
  .option('-d, --device <id>', 'device ID (run "mobilewright devices" to list)')
  .option('-o, --output <file>', 'output file path', 'screenshot.png')
  .option('--url <url>', 'mobilecli server URL', DEFAULT_URL)
  .action(async (opts: { device?: string; output: string; url: string }) => {
    const { serverProcess } = await ensureMobilecliReachable(opts.url, { autoStart: true });
    try {
      const driver = new MobilecliDriver({ url: opts.url });
      const deviceId = await resolveDeviceId(opts.device, driver);

      await driver.connect({ deviceId, url: opts.url });
      const buffer = await driver.screenshot();
      await driver.disconnect();

      const outputPath = resolve(process.cwd(), opts.output);
      await writeFile(outputPath, buffer);
      console.log(`Screenshot saved to ${outputPath}`);
    } finally {
      if (serverProcess) await serverProcess.kill();
    }
  });

// ── install ───────────────────────────────────────────────────────
program
  .command('install')
  .description('install the agent on a connected device')
  .option('-d, --device <id>', 'device ID (run "mobilewright devices" to list)')
  .option('--force', 'force reinstall the agent')
  .option('--provisioning-profile <profile>', 'provisioning profile to use (iOS)')
  .action(async (opts: { device?: string; force?: boolean; provisioningProfile?: string }) => {
    const driver = new MobilecliDriver();
    const deviceId = await resolveDeviceId(opts.device, driver);

    const binary = resolveMobilecliBinary();
    const args = ['agent', 'install', '--device', deviceId];
    if (opts.force) {
      args.push('--force');
    }
    if (opts.provisioningProfile) {
      args.push('--provisioning-profile', opts.provisioningProfile);
    }

    try {
      execFileSync(binary, args, { stdio: ['inherit', 'inherit', 'inherit'] });
    } catch (err: unknown) {
      process.exit(1);
    }
  });

// ── doctor ─────────────────────────────────────────────────────────────
program
  .command('doctor')
  .description('check your environment for mobile development readiness')
  .option('--json', 'output as JSON — machine-readable, ideal for AI agent consumption')
  .option('--category <name>', 'run checks for one category only: system | ios | android')
  .action((opts: { json?: boolean; category?: string }) => {
    const validCategories = ['system', 'ios', 'android'] as const;
    type Category = typeof validCategories[number];

    if (opts.category && !validCategories.includes(opts.category as Category)) {
      console.error(`Unknown category "${opts.category}". Valid options: ${validCategories.join(', ')}`);
      process.exit(1);
    }

    const checks = gatherChecks(opts.category as Category | undefined);

    if (opts.json) {
      console.log(JSON.stringify(renderJSON(checks, _pkg.version), null, 2));
    } else {
      process.stdout.write(renderTerminal(checks, _pkg.version));
    }

    if (checks.some(c => c.status === 'error')) process.exitCode = 1;
  });

// ── init ───────────────────────────────────────────────────────────────
program
  .command('init')
  .description('scaffold a mobilewright.config.ts and example test in the current directory')
  .action(async () => {
    const files = [
      { src: 'mobilewright.config.ts', dest: resolve(process.cwd(), 'mobilewright.config.ts') },
      { src: 'example.test.ts', dest: resolve(process.cwd(), 'example.test.ts') },
    ];

    for (const { src, dest } of files) {
      if (existsSync(dest)) {
        console.log(`skipped  ${src} (already exists)`);
        continue;
      }
      const content = await readFile(resolve(TEMPLATES_DIR, src), 'utf8');
      await writeFile(dest, content, 'utf8');
      console.log(`created  ${src}`);
    }
  });

function padRight(str: string, len: number): string {
  return str.length >= len ? str + '  ' : str + ' '.repeat(len - str.length);
}

program.parse(process.argv);
