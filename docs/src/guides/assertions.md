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
| `toBeEnabled()` | Element is enabled |
| `toBeDisabled()` | Element is not enabled |
| `toBeChecked()` | Element is checked |
| `toBeFocused()` | Element has focus |
| `toBeSelected()` | Element is selected |

### Text content

```typescript
await expect(screen.getByTestId('greeting')).toHaveText('Hello, World');
await expect(screen.getByTestId('greeting')).toHaveText(/Hello/);
await expect(screen.getByTestId('greeting')).toContainText('Hello');
```

| Assertion | Passes when |
|-----------|-------------|
| `toHaveText(expected)` | Text matches exactly (string) or by pattern (RegExp) |
| `toContainText(expected)` | Text contains the substring |

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
