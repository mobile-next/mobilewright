---
sidebar_position: 2
title: Writing Tests
---

# Writing Tests

## First test

Mobilewright tests are written in TypeScript using the `test` and `expect` functions from `@mobilewright/test`.

```typescript
import { test, expect } from '@mobilewright/test';

test('app launches and shows home screen', async ({ screen }) => {
  await expect(screen.getByText('Welcome')).toBeVisible();
});
```

Each test receives a `screen` fixture that lets you find elements and interact with them. Assertions like `toBeVisible()` auto-wait until the condition is met.

## Actions

### Finding elements

Use locator methods on `screen` to find elements:

```typescript
// By visible text
screen.getByText('Sign In');

// By accessibility label
screen.getByLabel('Username');

// By test ID (accessibilityIdentifier on iOS, resourceId on Android)
screen.getByTestId('submit-button');

// By semantic role
screen.getByRole('button', { name: 'Submit' });

// By element type
screen.getByType('TextField');
```

### Tapping

```typescript
await screen.getByText('Sign In').tap();
await screen.getByRole('button', { name: 'Submit' }).doubleTap();
await screen.getByText('Options').longPress();
```

### Filling text fields

```typescript
await screen.getByLabel('Email').fill('user@example.com');
await screen.getByLabel('Password').fill('secret');
```

### Swiping

```typescript
await screen.swipe('up');
await screen.swipe('down', { distance: 300 });
```

### Pressing hardware buttons

```typescript
await screen.pressButton('HOME');
await screen.pressButton('BACK');
```

## Assertions

Use `expect` to verify the state of elements. Assertions auto-wait and retry until the condition is met or the timeout expires.

```typescript
await expect(screen.getByText('Welcome')).toBeVisible();
await expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
await expect(screen.getByTestId('greeting')).toHaveText('Hello, World');
```

See the [Assertions](../guides/assertions.md) guide for the full list.

## Chaining locators

Locators can be chained to narrow the search within a parent element:

```typescript
const row = screen.getByType('Cell').first();
await row.getByRole('button', { name: 'Delete' }).tap();
```

### Collection methods

```typescript
// Get specific elements from a set of matches
screen.getByRole('button').first();
screen.getByRole('button').last();
screen.getByRole('button').nth(2);

// Count matching elements
const count = await screen.getByRole('listitem').count();

// Iterate over all matches
const items = await screen.getByRole('listitem').all();
```

## Grouping tests

Use `test.describe` to group related tests:

```typescript
import { test, expect } from '@mobilewright/test';

test.describe('login flow', () => {
  test('shows login form', async ({ screen }) => {
    await expect(screen.getByLabel('Email')).toBeVisible();
    await expect(screen.getByLabel('Password')).toBeVisible();
  });

  test('rejects invalid credentials', async ({ screen }) => {
    await screen.getByLabel('Email').fill('bad@example.com');
    await screen.getByLabel('Password').fill('wrong');
    await screen.getByRole('button', { name: 'Sign In' }).tap();
    await expect(screen.getByText('Invalid credentials')).toBeVisible();
  });
});
```

## Using the device fixture

When you need device-level control beyond the screen, use the `device` fixture:

```typescript
import { test, expect } from '@mobilewright/test';

test('deep link opens profile', async ({ device, screen }) => {
  await device.openUrl('myapp://profile/123');
  await expect(screen.getByText('Profile')).toBeVisible();
});
```
