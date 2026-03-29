#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { MobilecliDriver, DEFAULT_URL } from '@mobilewright/driver-mobilecli';
import { ensureMobilecliReachable } from './server.js';

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
      overrides.reporter = names.map((name: string) => [name.trim()]);
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
    if (report) args.push(report);
    args.push('--host', opts.host, '--port', opts.port);
    await pwProgram.parseAsync(args);
  });

// ── devices ────────────────────────────────────────────────────────────
program
  .command('devices')
  .description('list all connected devices, simulators, and emulators')
  .option('--url <url>', 'mobilecli server URL', DEFAULT_URL)
  .action(async (opts: { url: string }) => {
    const { serverProcess } = await ensureMobilecliReachable(opts.url, { autoStart: true });
    try {
      const driver = new MobilecliDriver({ url: opts.url });
      const devices = await driver.listDevices();

      if (devices.length === 0) {
        console.log('No devices found.');
        return;
      }

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
    } finally {
      if (serverProcess) await serverProcess.kill();
    }
  });

function padRight(str: string, len: number): string {
  return str.length >= len ? str + '  ' : str + ' '.repeat(len - str.length);
}

program.parse(process.argv);
