---
sidebar_position: 9
title: Dialogs
---

# Dialogs

Use `screen.on('dialog')` to respond to alerts and permission prompts, the same way Playwright's `page.on('dialog')` works. Your test keeps tapping and asserting as usual, and whenever a dialog shows up, your handler accepts or dismisses it.

```typescript
screen.on('dialog', async (dialog) => {
  console.log(dialog.type(), dialog.message());
  await dialog.accept();
});

await screen.getByText('Find nearby stores').tap();  // the location prompt is accepted on the way
```

## How it works

Mobilewright reads the screen many times a second while an action or `expect()` is waiting. With a listener registered, each of those reads also checks for a dialog. A dialog that covers the element you're tapping is handled within one poll, well inside the action timeout.

- Each dialog fires the event once, not on every poll.
- Without a listener, dialogs are left alone, so you can still tap their buttons with locators.
- Action sheets and bottom sheets are not dialogs: your test opened them to pick an option, so pick it with a locator, like `screen.getByText('Red').tap()`.
- Dialogs are only noticed while an action or assertion is running.

## Responding

| Method | Does |
|---|---|
| `dialog.accept(promptText?)` | Presses the positive button: OK, Allow, While using the app. For a prompt, types `promptText` into its text field first. |
| `dialog.dismiss()` | Presses the negative button: Cancel, Don't Allow. On a single-button alert, presses that button. |
| `dialog.tap(name)` | Presses the button with this caption, ignoring case. |

## Reading

| Method | Returns |
|---|---|
| `dialog.type()` | `'alert'`, `'confirm'`, `'prompt'` or `'permission'` |
| `dialog.isSystem()` | `true` for prompts shown by the OS, like runtime permission requests. On iOS this is recognized by the app name in curly quotes in the title (“MyApp” Would Like to…). |
| `dialog.title()` | The title, empty when there is none |
| `dialog.message()` | The message text |
| `dialog.buttons()` | The button captions, in on-screen order |

On iOS, which button is positive comes from where it sits, following Apple's layout: with two buttons side by side, accept presses the right one and dismiss the left one. With stacked buttons, dismiss presses the bottom one. Accept presses the top one, or on a permission prompt the one just above Don't Allow (Allow While Using App). Use `dialog.tap(name)` when you need a specific button.

Use `screen.once('dialog', handler)` to handle only the next dialog, and `screen.off('dialog', handler)` to stop listening.

## Waiting for a dialog

To assert that an action opens a dialog, start waiting before the action, like Playwright's `page.waitForEvent('dialog')`:

```typescript
const dialogPromise = screen.waitForEvent('dialog');
await screen.getByText('Scan a code').tap();
const dialog = await dialogPromise;
expect(dialog.type()).toBe('permission');
await dialog.dismiss();
```

The dialog is left for you to answer. Pass a predicate, or `{ predicate, timeout }`, to wait for a specific one. The default timeout is the action timeout. A device doesn't push dialog events the way a browser does, so `waitForEvent` polls the screen until a dialog shows up.

## Resetting permissions between runs

Once a permission is granted, or denied twice, Android stops asking. On Android, clear the app's data before the test to get the prompt back:

```typescript
test.beforeEach(async ({ device }) => {
  await device.clearAppData('com.example.app');  // also resets runtime permissions
  await device.launchApp('com.example.app');
});
```

On an iOS simulator, `clearAppData()` does not reset permissions. Run `xcrun simctl privacy <udid> reset all <bundle id>` to reset camera, location and the other privacy permissions; notifications only reset when you reinstall the app.
