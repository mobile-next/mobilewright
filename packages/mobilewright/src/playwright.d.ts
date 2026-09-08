declare module 'playwright/lib/common' {
  export namespace configLoader {
    export function loadConfigFromFile(
      configFile: string | undefined,
      overrides?: Record<string, unknown>,
      ignoreDeps?: boolean,
    ): Promise<unknown>;
    export function loadEmptyConfigForMergeReports(): Promise<unknown>;
  }
}

declare module 'playwright/lib/runner' {
  export namespace testRunner {
    export function runAllTestsWithConfig(
      config: unknown,
      options: {
        locations?: string[];
        grep?: string;
        grepInvert?: string;
        listMode?: boolean;
        projectFilter?: string[];
        passWithNoTests?: boolean;
        lastFailed?: boolean;
        lastFailedFile?: string;
      },
    ): Promise<'passed' | 'failed' | 'interrupted'>;
  }
}

declare module 'playwright/lib/program' {
  import type { Command } from 'commander';
  export const program: Command;
}
