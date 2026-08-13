import type { MobilewrightDriver } from '@mobilewright/protocol';

let activeDriver: MobilewrightDriver | undefined;

/**
 * Registers the driver instance for the current process. `config.ts` calls
 * this while Playwright evaluates the user's config file; `observer-reporter.ts`
 * reads it back when Playwright instantiates that reporter by path, in the
 * same process — no serialization boundary between the two.
 */
export function setActiveDriver(driver: MobilewrightDriver | undefined): void {
  activeDriver = driver;
}

export function getActiveDriver(): MobilewrightDriver | undefined {
  return activeDriver;
}
