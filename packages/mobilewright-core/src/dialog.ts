import type { MobilewrightDriver, ViewNode } from '@mobilewright/protocol';

export type DialogType = 'alert' | 'confirm' | 'prompt' | 'permission';

export type DialogHandler = (dialog: Dialog) => unknown | Promise<unknown>;

// Android AlertDialog buttons: button1 = positive, button2 = negative, button3 = neutral.
const ALERT_BUTTON_ID = /^android:id\/button[123]$/;
const ALERT_TITLE_ID = /:id\/alertTitle$/;
const ALERT_MESSAGE_ID = 'android:id/message';
// AlertDialog.setItems(): an action sheet, which the test opened itself and picks an option from with a locator
const ACTION_SHEET_LIST_ID = /:id\/select_dialog_listview$/;
// Runtime permission prompt shown by com.android.permissioncontroller (or a vendor fork of it).
const PERMISSION_MESSAGE_ID = /:id\/permission_message$/;
const PERMISSION_BUTTON_ID = /:id\/permission_\w+_button$/;

function flatten(roots: ViewNode[]): ViewNode[] {
  return roots.flatMap((node) => [node, ...flatten(node.children)]);
}

function center(node: ViewNode): { x: number; y: number } {
  return {
    x: Math.round(node.bounds.x + node.bounds.width / 2),
    y: Math.round(node.bounds.y + node.bounds.height / 2),
  };
}

function textOf(node: ViewNode | undefined): string {
  return node?.text ?? node?.label ?? '';
}

function matchesId(node: ViewNode, pattern: RegExp | string): boolean {
  if (!node.identifier) {
    return false;
  }
  return typeof pattern === 'string' ? node.identifier === pattern : pattern.test(node.identifier);
}

export class Dialog {
  constructor(
    private readonly driver: MobilewrightDriver,
    private readonly _type: DialogType,
    private readonly _title: string,
    private readonly _message: string,
    private readonly buttonNodes: ViewNode[],
    private readonly acceptButton: ViewNode | undefined,
    private readonly dismissButton: ViewNode | undefined,
    private readonly input: ViewNode | undefined,
  ) {}

  type(): DialogType {
    return this._type;
  }

  /** True when the dialog is shown by the OS rather than by the app under test. */
  isSystem(): boolean {
    return this._type === 'permission';
  }

  title(): string {
    return this._title;
  }

  message(): string {
    return this._message;
  }

  /** Button captions, in on-screen order. */
  buttons(): string[] {
    return this.buttonNodes.map(textOf);
  }

  /**
   * Press the positive button ("OK", "Allow", "While using the app").
   * For a prompt dialog, `promptText` is typed into its text field first.
   */
  async accept(promptText?: string): Promise<void> {
    const button = this.requireButton(this.acceptButton, 'accept');
    if (promptText === undefined || !this.input) {
      await this.tapNode(button);
      return;
    }
    await this.tapNode(this.input);
    await this.driver.typeText(promptText);
    // the keyboard that opened for typing pushes the dialog up, so find the button again
    const moved = flatten(await this.driver.getViewHierarchy()).find((node) => node.identifier === button.identifier);
    await this.tapNode(moved ?? button);
  }

  /** Press the negative button ("Cancel", "Don't allow"), or the only button of a single-button alert. */
  async dismiss(): Promise<void> {
    await this.tapNode(this.requireButton(this.dismissButton, 'dismiss'));
  }

  /** Press the button whose caption matches `name` (case-insensitive, buttons may render upper-cased). */
  async tap(name: string): Promise<void> {
    const wanted = name.toLowerCase();
    const button = this.buttonNodes.find((node) => textOf(node).toLowerCase() === wanted);
    if (!button) {
      throw new Error(`Dialog has no button "${name}". Buttons: ${JSON.stringify(this.buttons())}`);
    }
    await this.tapNode(button);
  }

  /** Identity used to fire the 'dialog' event once per dialog, not once per poll. */
  get key(): string {
    return JSON.stringify([this._type, this._title, this._message, this.buttons()]);
  }

  private requireButton(button: ViewNode | undefined, action: string): ViewNode {
    if (!button) {
      throw new Error(`Cannot ${action} dialog: no matching button. Buttons: ${JSON.stringify(this.buttons())}`);
    }
    return button;
  }

  private async tapNode(node: ViewNode): Promise<void> {
    const { x, y } = center(node);
    await this.driver.tap(x, y);
  }
}

function findPermissionDialog(nodes: ViewNode[], driver: MobilewrightDriver): Dialog | undefined {
  const message = nodes.find((node) => matchesId(node, PERMISSION_MESSAGE_ID));
  if (!message) {
    return undefined;
  }
  const buttons = nodes.filter((node) => matchesId(node, PERMISSION_BUTTON_ID));
  // ponytail: id-based like Appium; "allow" ids are listed most-permissive first
  // (allow_foreground_only before allow_one_time), so the first match is the one to accept.
  const accept = buttons.find((node) => /_allow_/.test(node.identifier!));
  const dismiss = buttons.find((node) => /_deny_/.test(node.identifier!));
  return new Dialog(driver, 'permission', '', textOf(message), buttons, accept, dismiss, undefined);
}

function findAlertDialog(nodes: ViewNode[], driver: MobilewrightDriver): Dialog | undefined {
  const buttons = nodes.filter((node) => matchesId(node, ALERT_BUTTON_ID));
  if (buttons.length === 0 || nodes.some((node) => matchesId(node, ACTION_SHEET_LIST_ID))) {
    return undefined;
  }
  const byId = (id: string) => buttons.find((node) => node.identifier === `android:id/${id}`);
  const positive = byId('button1');
  const negative = byId('button2');
  const input = nodes.find((node) => node.type.endsWith('EditText'));
  const type: DialogType = input ? 'prompt' : negative ? 'confirm' : 'alert';
  const title = textOf(nodes.find((node) => matchesId(node, ALERT_TITLE_ID)));
  const message = textOf(nodes.find((node) => matchesId(node, ALERT_MESSAGE_ID)));
  return new Dialog(driver, type, title, message, buttons, positive, negative ?? positive, input);
}

/** Detect an Android alert or permission dialog in a view tree. iOS is not supported yet. */
export function findDialog(roots: ViewNode[], driver: MobilewrightDriver): Dialog | undefined {
  const nodes = flatten(roots);
  return findPermissionDialog(nodes, driver) ?? findAlertDialog(nodes, driver);
}
