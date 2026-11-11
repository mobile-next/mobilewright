import type { MobilewrightDriver } from '@mobilewright/protocol';

type StepRunner = <T>(title: string, fn: () => Promise<T>) => Promise<T>;

export class Keyboard {
  constructor(
    private readonly driver: MobilewrightDriver,
    private readonly step: StepRunner,
  ) {}

  /** Whether the software keyboard is showing. With a hardware keyboard this is false. */
  async isVisible(): Promise<boolean> {
    return this.step('keyboard.isVisible()', () => this.driver.isKeyboardVisible());
  }

  /** Close the software keyboard. Does nothing if none is showing, and throws if it stays up. On real iOS devices it only works in debuggable apps. */
  async hide(): Promise<void> {
    return this.step('keyboard.hide()', () => this.driver.hideKeyboard());
  }
}
