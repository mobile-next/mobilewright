import { HTML_REPORT_DIR } from './config.js';

/** Raw options of `mobilewright test`, as commander parses them. */
export interface TestCommandOptions {
  timeout?: string;
  retries?: string;
  repeatEach?: string;
  maxFailures?: string;
  x?: boolean;
  failOnFlakyTests?: boolean;
  forbidOnly?: boolean;
  shard?: string;
  workers?: string;
  reporter?: string;
}

/**
 * Turns `mobilewright test` flags into Playwright config overrides, which take
 * precedence over the values in mobilewright.config.ts. Throws when a flag value is invalid.
 */
export function buildConfigOverrides(opts: TestCommandOptions): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  if (opts.timeout) overrides.timeout = Number(opts.timeout);
  if (opts.retries) overrides.retries = Number(opts.retries);
  if (opts.repeatEach) overrides.repeatEach = parseInteger('--repeat-each', opts.repeatEach, 1);
  if (opts.x) {
    overrides.maxFailures = 1;
  } else if (opts.maxFailures) {
    overrides.maxFailures = parseInteger('--max-failures', opts.maxFailures, 0);
  }
  if (opts.failOnFlakyTests) overrides.failOnFlakyTests = true;
  if (opts.forbidOnly) overrides.forbidOnly = true;
  if (opts.shard) {
    const match = opts.shard.match(/^(\d+)\/(\d+)$/);
    if (!match) {
      throw new Error(`--shard must be in the format x/n (e.g. 1/3), got: ${opts.shard}`);
    }
    overrides.shard = { current: Number(match[1]), total: Number(match[2]) };
  }
  if (opts.workers) overrides.workers = parseInteger('--workers', opts.workers, 1);
  if (opts.reporter) {
    overrides.reporter = opts.reporter.split(',').map((name) => {
      const n = name.trim();
      if (n === 'html') return [n, { outputFolder: HTML_REPORT_DIR }];
      return [n];
    });
  }
  return overrides;
}

function parseInteger(flag: string, value: string, min: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) {
    const expected = min === 0 ? 'a non-negative integer' : 'a positive integer';
    throw new Error(`${flag} must be ${expected}, got: ${value}`);
  }
  return n;
}
