declare module 'playwright/lib/common/configLoader' {
  export function loadConfigFromFile(
    configFile: string | undefined,
    overrides?: Record<string, unknown>,
    ignoreDeps?: boolean,
  ): Promise<unknown>;
  export function loadEmptyConfigForMergeReports(): Promise<unknown>;
}

declare module 'playwright/lib/reporters/merge' {
  export function createMergedReport(
    config: unknown,
    dir: string,
    reporterDescriptions: ([string] | [string, Record<string, unknown>])[],
    rootDirOverride: string | undefined,
  ): Promise<void>;
}

declare module 'playwright/lib/runner/testRunner' {
  export function runAllTestsWithConfig(
    config: unknown,
  ): Promise<'passed' | 'failed' | 'interrupted'>;
}

declare module 'playwright/lib/program' {
  import type { Command } from 'commander';
  export const program: Command;
}
