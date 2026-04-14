---
sidebar_position: 2
title: Auto-waiting
---

# Auto-waiting

Mobilewright performs a series of actionability checks on elements before executing actions. It waits and retries until all checks pass or the timeout is reached, so you never need to add manual waits or sleeps in your tests.

For example, when you call `locator.tap()`, Mobilewright will wait until the element:

1. **Exists** in the view hierarchy
2. **Is visible** on screen
3. **Is enabled** for interaction
4. **Has stable bounds** (not animating or moving)

If any check fails, Mobilewright retries every 100ms. The stability check uses a shorter 50ms interval to quickly detect when an element stops moving. If all checks still fail after the timeout (5 seconds by default), the action throws a `LocatorError`.

## Actions that auto-wait

All action methods wait for the element to be visible, enabled, and stable before proceeding:

| Action | Description |
|--------|-------------|
| `locator.tap()` | Tap at the center of the element |
| `locator.doubleTap()` | Double-tap the element |
| `locator.longPress()` | Long-press the element |
| `locator.fill(text)` | Tap to focus, then type text |

Methods that read from the element wait for visibility only:

| Method | Description |
|--------|-------------|
| `locator.getText()` | Returns the element's text content |
| `locator.getValue()` | Returns the element's value |
| `locator.screenshot()` | Captures a screenshot of the element |

## Actionability checks

### Visible

An element is visible when its `isVisible` property is `true` in the view hierarchy. Elements that are off-screen, hidden, or have zero size are not considered visible.

### Enabled

An element is enabled when its `isEnabled` property is `true`. Disabled elements (such as greyed-out buttons) will not pass this check.

### Stable

An element is stable when its bounds (position and size) remain unchanged between two consecutive checks. This prevents actions on elements that are still animating or transitioning into place.

## Timeouts

The default timeout is 5 seconds. You can override it per-action:

```typescript
await screen.getByText('Submit').tap({ timeout: 10_000 });
```

Or set a global timeout in `mobilewright.config.ts`:

```typescript
import { defineConfig } from 'mobilewright';

export default defineConfig({
  timeout: 10_000,
});
```

## Waiting for a specific state

Use `waitFor()` to wait for an element to reach a specific state without performing an action:

```typescript
// Wait for an element to appear
await screen.getByText('Loading complete').waitFor({ state: 'visible' });

// Wait for an element to disappear
await screen.getByText('Spinner').waitFor({ state: 'hidden' });

// Wait for a button to become interactive
await screen.getByRole('button', { name: 'Submit' }).waitFor({ state: 'enabled' });
```

The supported states are `'visible'`, `'hidden'`, `'enabled'`, and `'disabled'`.

## Assertions auto-wait too

The `expect()` assertions also auto-wait. They retry until the condition is met or the timeout expires:

```typescript
// This will keep checking until the text is visible (up to 5s)
await expect(screen.getByText('Success')).toBeVisible();

// Wait for text content to match
await expect(screen.getByRole('text')).toHaveText('Done');
```

This means you rarely need `waitFor()` directly — in most cases, an assertion or action handles the waiting for you.
