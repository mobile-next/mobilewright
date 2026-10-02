import type { MobilewrightDriver, ViewNode } from '@mobilewright/protocol';
import { bareTypeName } from './query-engine.js';

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
// iOS permission alerts quote the app name: “Playground” would like to access the Camera.
const IOS_QUOTED_APP_NAME = /“.+”/;

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
    const moved = findDialog(await this.driver.getViewHierarchy(), this.driver)?.acceptButton;
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

function findAndroidPermissionDialog(nodes: ViewNode[], driver: MobilewrightDriver): Dialog | undefined {
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

function findAndroidAlertDialog(nodes: ViewNode[], driver: MobilewrightDriver): Dialog | undefined {
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

function isSideBySide(buttons: ViewNode[]): boolean {
  return buttons.every((node) => node.bounds.y === buttons[0].bounds.y);
}

// iOS puts the cancel button on the left of a side-by-side pair and at the bottom of a stack.
function iosAlertButtons(buttons: ViewNode[], isPermission: boolean): { accept?: ViewNode; dismiss?: ViewNode } {
  if (isSideBySide(buttons)) {
    const leftToRight = [...buttons].sort((a, b) => a.bounds.x - b.bounds.x);
    return { accept: leftToRight.at(-1), dismiss: leftToRight[0] };
  }
  const topToBottom = [...buttons].sort((a, b) => a.bounds.y - b.bounds.y);
  // ponytail: a stacked permission alert reads Allow Once / Allow While Using App / Don't Allow,
  // so accept the one above Don't Allow; an app alert's preferred action is on top
  return { accept: isPermission ? topToBottom.at(-2) : topToBottom[0], dismiss: topToBottom.at(-1) };
}

function findIosAlert(nodes: ViewNode[], driver: MobilewrightDriver): Dialog | undefined {
  const alert = nodes.find((node) => bareTypeName(node.type) === 'alert');
  if (!alert) {
    return undefined;
  }
  const children = flatten(alert.children);
  const buttons = children.filter((node) => bareTypeName(node.type) === 'button');
  const input = children.find((node) => ['textfield', 'securetextfield'].includes(bareTypeName(node.type)));
  const title = alert.label ?? '';
  const message = children
    .filter((node) => bareTypeName(node.type) === 'statictext' && textOf(node) !== title)
    .map(textOf)
    .join('\n');
  // ponytail: nothing in the iOS tree marks a system alert, so this keys off the quoted app name;
  // a locale that quotes differently („Playground“) reads as an app alert
  const isPermission = IOS_QUOTED_APP_NAME.test(title);
  const type: DialogType = isPermission ? 'permission' : input ? 'prompt' : buttons.length > 1 ? 'confirm' : 'alert';
  const { accept, dismiss } = iosAlertButtons(buttons, isPermission);
  return new Dialog(driver, type, title, message, buttons, accept, dismiss, input);
}

/** Detect an alert or permission dialog in a view tree. */
export function findDialog(roots: ViewNode[], driver: MobilewrightDriver): Dialog | undefined {
  const nodes = flatten(roots);
  return findIosAlert(nodes, driver) ?? findAndroidPermissionDialog(nodes, driver) ?? findAndroidAlertDialog(nodes, driver);
}
