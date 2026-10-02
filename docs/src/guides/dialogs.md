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

:::note
Dialogs are supported on Android. iOS support is coming.
:::

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
| `dialog.dismiss()` | Presses the negative button: Cancel, Don't allow. On a single-button alert, presses that button. |
| `dialog.tap(name)` | Presses the button with this caption, ignoring case. |

## Reading

| Method | Returns |
|---|---|
| `dialog.type()` | `'alert'`, `'confirm'`, `'prompt'` or `'permission'` |
| `dialog.isSystem()` | `true` for prompts shown by the OS, like runtime permission requests |
| `dialog.title()` | The title, empty when there is none |
| `dialog.message()` | The message text |
| `dialog.buttons()` | The button captions, in on-screen order |

Use `screen.once('dialog', handler)` to handle only the next dialog, and `screen.off('dialog', handler)` to stop listening.

## Resetting permissions between runs

Once a permission is granted, or denied twice, Android stops asking. Clear the app's data before the test to get the prompt back:

```typescript
test.beforeEach(async ({ device }) => {
  await device.clearAppData('com.example.app');  // also resets runtime permissions
  await device.launchApp('com.example.app');
});
```
