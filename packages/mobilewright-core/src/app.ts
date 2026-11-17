import type { MobilewrightDriver } from '@mobilewright/protocol';

type StepRunner = <T>(title: string, fn: () => Promise<T>) => Promise<T>;

/** One app on a device, addressed by its bundle id. Get one from `device.app(bundleId)`. */
export class App {
  private readonly driver: MobilewrightDriver;
  readonly bundleId: string;
  private readonly step: StepRunner;

  constructor(driver: MobilewrightDriver, bundleId: string, step: StepRunner) {
    this.driver = driver;
    this.bundleId = bundleId;
    this.step = step;
  }

  /**
   * Clear the app's data and stop the app. Launch it again with `device.launchApp()`.
   * On Android and iOS simulators this also resets the app's permissions, so permission dialogs show again
   * (notifications on a simulator are the exception). Throws on real iOS devices, where it is not supported.
   */
  async clearData(): Promise<void> {
    return this.step('app.clearData()', () => this.driver.clearAppData(this.bundleId));
  }
}
