---
sidebar_position: 3
title: Screenshots
---

# Screenshots

Mobilewright can capture screenshots of the device screen during test execution. This is useful for debugging, visual verification, and generating test artifacts.

## Capture a screenshot

Use `screen.screenshot()` to capture the current screen. It returns a `Buffer` containing the image data.

```typescript
const buffer = await screen.screenshot();
```

## Save to file

Pass a `path` option to save the screenshot to a file. The directory will be created automatically if it doesn't exist. The buffer is still returned.

```typescript
const buffer = await screen.screenshot({ path: 'screenshot.png' });
```

## Screenshot options

| Option    | Type               | Description                              |
|-----------|--------------------|------------------------------------------|
| `path`    | `string`           | File path to save the screenshot to.     |
| `format`  | `'png' \| 'jpeg'`  | Image format. Defaults to `'png'`.       |
| `quality` | `number`           | JPEG quality (0-100). Only applies when format is `'jpeg'`. |

## Examples

### Save a JPEG screenshot

```typescript
await screen.screenshot({
  path: 'screenshots/home.jpg',
  format: 'jpeg',
  quality: 80,
});
```

### Use the buffer directly

```typescript
const buffer = await screen.screenshot();
console.log(`Screenshot size: ${buffer.length} bytes`);
```