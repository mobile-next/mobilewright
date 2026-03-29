declare module 'playwright/lib/common/configLoader' {
  export function loadConfigFromFile(
    configFile: string | undefined,
    overrides?: Record<string, unknown>,
    ignoreDeps?: boolean,
  ): Promise<unknown>;
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
