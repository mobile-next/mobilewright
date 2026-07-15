---
sidebar_position: 1
title: Actions
---

# Actions

Actions are how your test drives the app: tapping, typing, swiping, pressing hardware buttons. Mobilewright exposes them in two places:

- **On a locator** — `screen.getByText('Sign In').tap()`. The locator resolves the element, [auto-waits](./auto-waiting.md) until it's actionable, then acts on its center. This is what you want almost all the time.
- **On the screen** — `screen.tap(200, 400)`. These take raw coordinates and do **not** auto-wait. Reach for them only when there's no element to target (a canvas, a game surface) or when driving hardware buttons and gestures.

## Locator actions

Every locator action accepts a `timeout` (in ms) that overrides the configured [action timeout](../test/timeouts.md) for that one call.

### Tap

```ts
await screen.getByRole('button', { name: 'Submit' }).tap();
await screen.getByText('Options').tap({ timeout: 10_000 });
```

### Double tap and long press

```ts
await screen.getByText('Photo').doubleTap();
await screen.getByText('Message').longPress();
await screen.getByText('Message').longPress({ duration: 1_500 });
```

`longPress` accepts an optional `duration` in milliseconds. Omit it to use the driver default.

### Fill and clear

`fill` focuses the field, clears any existing text, then types the new value. Use `clear` on its own to empty a field without typing.

```ts
await screen.getByRole('textbox', { name: 'Email' }).fill('user@example.com');
await screen.getByRole('textbox', { name: 'Email' }).clear();
```

`fill` clears first, so you don't need to call `clear` before it. If the field can't be emptied, `fill` and `clear` throw rather than silently appending to leftover text.

### Swipe

Swipe in a direction starting from the element's center. `direction` is required.

```ts
await screen.getByText('Card').swipe({ direction: 'left' });
```

Direction is one of `'up'`, `'down'`, `'left'`, `'right'`.

### Scroll into view

Swipe repeatedly until the element enters the viewport, then stop. Useful before acting on something below the fold.

```ts
await screen.getByText('Delete account').scrollIntoViewIfNeeded();
await screen.getByText('Delete account').tap();
```

| Option | Default | Description |
| --- | --- | --- |
| `maxSwipes` | `10` | Give up after this many swipe attempts |
| `direction` | `'up'` | Swipe direction while searching — `'up'` scrolls content down, `'down'` scrolls content up |

## Screen actions

These act on raw coordinates or the device itself. They don't resolve or wait for any element.

### Coordinate taps

```ts
await screen.tap(200, 400);
await screen.doubleTap(200, 400);
await screen.longPress(200, 400, 1_500); // optional duration in ms
```

### Swipe

Swipe across the screen. Defaults to starting at the screen center and covering half the relevant dimension.

```ts
await screen.swipe('up');
await screen.swipe('down', { distance: 300 });
await screen.swipe('left', { startX: 300, startY: 500, duration: 400 });
```

| Option | Description |
| --- | --- |
| `distance` | Swipe distance in points (default: 50% of the screen dimension) |
| `duration` | Swipe duration in ms |
| `startX`, `startY` | Starting point (default: center of screen) |

### Hardware buttons

```ts
await screen.pressButton('HOME');
await screen.goBack(); // Android — shorthand for pressButton('BACK')
```

Available buttons: `HOME`, `BACK`, `POWER`, `VOLUME_UP`, `VOLUME_DOWN`, `ENTER`, `DPAD_UP`, `DPAD_DOWN`, `DPAD_LEFT`, `DPAD_RIGHT`, `DPAD_CENTER`, `APP_SWITCH`, `LOCK`.

### Custom gestures

For multi-touch or precisely-timed paths, `gesture` takes one or more pointer paths. Each pointer is an array of points; `time` is the offset in ms from the start of the gesture.

```ts
// Pinch to zoom out — two fingers moving toward each other
await screen.gesture({
  pointers: [
    [{ x: 100, y: 400, time: 0 }, { x: 200, y: 400, time: 300 }],
    [{ x: 500, y: 400, time: 0 }, { x: 400, y: 400, time: 300 }],
  ],
});
```

## Which to use

Prefer locator actions. They auto-wait, so tests stay stable when the UI is still loading or animating, and they read as intent (`getByText('Sign In').tap()`) rather than magic numbers. Drop to screen actions only when there's genuinely no element to target, or for device-level input like hardware buttons and gestures.
