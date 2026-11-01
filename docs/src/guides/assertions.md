---
sidebar_position: 1
title: Assertions
---

# Assertions

Mobilewright uses the `expect` function for assertions. Locator assertions auto-wait and retry until the condition is met or the timeout expires (5 seconds by default).

## Locator assertions

These assertions accept a locator and retry automatically. They must be `await`ed.

### State

```typescript
await expect(screen.getByText('Welcome')).toBeVisible();
await expect(screen.getByText('Loading')).toBeHidden();
await expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
await expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
await expect(screen.getByRole('checkbox')).toBeChecked();
await expect(screen.getByTestId('name-field')).toBeFocused();
await expect(screen.getByRole('tab', { name: 'Home' })).toBeSelected();
```

| Assertion | Passes when |
|-----------|-------------|
| `toBeVisible()` | Element exists and is visible |
| `toBeHidden()` | Element does not exist or is not visible |
| `toBeEnabled()` | Element exists and is enabled |
| `toBeDisabled()` | Element exists and is not enabled |
| `toBeChecked()` | Element exists and is checked |
| `toBeFocused()` | Element exists and has focus |
| `toBeSelected()` | Element exists and is selected |

Like Playwright, only the visibility assertions tolerate a missing element: `toBeHidden()` and `not.toBeVisible()` pass when nothing matches. Every other state assertion needs an element to read the state from, so `toBeDisabled()` or `not.toBeChecked()` on a locator that matches nothing fails with "no matching element was found" instead of passing vacuously.

### Prefer assertions over `is*` reads

`locator.isVisible()`, `isEnabled()`, `isChecked()`, `isFocused()`, `isSelected()` and `exists()` return the state **right now**, without waiting for it to change. On a device, an action's effect often lands a moment after the action returns. For example, a tapped text field takes focus slightly later, so reading `isFocused()` right after the tap can return `false`.

To check a state, use the matching assertion, which retries until it passes:

```typescript
await screen.getByLabel('Email').tap();

// ✗ flaky: reads focus once, maybe before the field has it
expect(await screen.getByLabel('Email').isFocused()).toBe(true);

// ✓ retries until the field has focus
await expect(screen.getByLabel('Email')).toBeFocused();
```

Use the `is*` methods to branch on the current state, not to assert it.

### Text content

```typescript
await expect(screen.getByTestId('greeting')).toHaveText('Hello, World');
await expect(screen.getByTestId('greeting')).toHaveText(/Hello/);
await expect(screen.getByTestId('greeting')).toContainText('Hello');
```

| Assertion | Passes when |
|-----------|-------------|
| `toHaveText(expected)` | Text matches exactly (string) or by pattern (RegExp) |
| `toContainText(expected)` | Text contains the substring (string) or matches the pattern (RegExp) |

Both matchers follow Playwright's text semantics: whitespace is trimmed and runs of whitespace collapse to a single space on both sides before comparing, so `toHaveText('Total: $12.00')` matches a label rendered as `"Total:\n $12.00"`. Pass `{ ignoreCase: true }` to compare case-insensitively:

```typescript
await expect(screen.getByTestId('greeting')).toHaveText('hello, world', { ignoreCase: true });
await expect(screen.getByTestId('price')).toContainText(/\$\d+\.\d{2}/);
```

### Value

```typescript
await expect(screen.getByLabel('Email')).toHaveValue('user@example.com');
await expect(screen.getByLabel('Email')).toHaveValue(/example\.com/);
```

| Assertion | Passes when |
|-----------|-------------|
| `toHaveValue(expected)` | Value matches exactly (string) or by pattern (RegExp) |

## Negation

Add `.not` before any assertion to negate it:

```typescript
await expect(screen.getByText('Error')).not.toBeVisible();
await expect(screen.getByRole('button')).not.toBeDisabled();
await expect(screen.getByTestId('title')).not.toHaveText('Loading');
```

## Timeouts

Override the default timeout for a single assertion:

```typescript
await expect(screen.getByText('Done')).toBeVisible({ timeout: 10_000 });
```

## Value assertions

When `expect` receives a plain value instead of a locator, it provides standard assertions. These do **not** auto-wait or retry.

### Equality

```typescript
expect(count).toBe(5);
expect(result).toEqual({ name: 'Alice', age: 30 });
```

| Assertion | Passes when |
|-----------|-------------|
| `toBe(expected)` | Values are identical (`Object.is`) |
| `toEqual(expected)` | Values are deeply equal |

### Boolean

```typescript
expect(value).toBeTruthy();
expect(value).toBeFalsy();
```

### Numeric

```typescript
expect(count).toBeGreaterThan(0);
expect(count).toBeLessThan(100);
expect(ratio).toBeCloseTo(0.3, 2);
```

| Assertion | Passes when |
|-----------|-------------|
| `toBeGreaterThan(n)` | Value > n |
| `toBeLessThan(n)` | Value < n |
| `toBeCloseTo(n, precision?)` | Value is within tolerance (default precision: 2) |

### Collections and strings

```typescript
expect([1, 2, 3]).toContain(2);
expect('hello world').toContain('world');
```

### Null and undefined

```typescript
expect(value).toBeNull();
expect(value).toBeUndefined();
```

### Promises

`.rejects` and `.resolves` wait for a promise, then run any value matcher on the rejection reason or the resolved value. `rejects.toThrow()` matches the error's message, like Playwright.

```typescript
await expect(screen.getByText('Vogon Poetry').tap({ timeout: 1000 })).rejects.toThrow('timed out');
await expect(device.getOrientation()).resolves.toBe('portrait');
```

## Polling

`expect.poll` turns any value matcher into a retrying one: it calls the function until the matcher passes or the timeout runs out. If the function throws, that attempt counts as a failure and polling continues.

```typescript
await expect.poll(async () => (await device.getForegroundApp()).bundleId).not.toBe(bundleId);

await expect.poll(() => device.getOrientation(), {
  message: 'device should rotate',  // step title, and prefix of the failure
  timeout: 10_000,                  // default 5000; 0 polls with no limit
  intervals: [100, 250, 500, 1000], // default; the last interval repeats
}).toBe('landscape');

// soft: record the failure and keep running
await expect.soft.poll(() => device.getOrientation()).toBe('landscape');
```
