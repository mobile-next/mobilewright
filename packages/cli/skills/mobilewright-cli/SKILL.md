---
name: mobilewright-cli
description: Automate iOS and Android apps on simulators, emulators and real devices, explore screens and write Mobilewright tests.
allowed-tools: Bash(mobilewright-cli:*) Bash(npx:*) Bash(npm:*)
---

# Mobile automation with mobilewright-cli

## Quick start

```bash
# see which devices are online (one online device is picked automatically)
mobilewright-cli devices
# launch the app under test
mobilewright-cli launch com.example.app
# snapshot prints the screen tree with refs; actions link a fresh one under .mobilewright-cli/
mobilewright-cli snapshot
mobilewright-cli fill e7 "alice@example.com"
mobilewright-cli tap e9
mobilewright-cli expect visible --text "Welcome back"
```

After every action the CLI prints:

```
### Ran Mobilewright code
```js
await screen.getByRole('button', { name: 'Sign in' }).tap();
```
### Device
- Device ID: 6A557392-1480-4355-9EBC-B1D12A0F665D
- App: com.example.app
### Snapshot
- [Snapshot](.mobilewright-cli/screen-2026-09-14T20-13-21-867Z.yml)
```

Read the snapshot file to learn the refs. A snapshot line looks like
`- button "Sign in" [ref=e9] [testid="login"]`. Roles are `button`, `textfield`, `text`,
`image`, `switch`, `checkbox`, `radio`, `slider`, `list`, `listitem`, `tab`, `link`, `header`.
Attributes: `testid`, `placeholder`, `value`, `hidden`, `disabled`, `checked`, `selected`, `focused`.

Collect the `Ran Mobilewright code` lines to write a test: they are the exact calls
a Mobilewright test makes.

## Commands

### Devices and apps

```bash
mobilewright-cli devices
mobilewright-cli --device Pixel_9_Pro launch com.example.app   # remembered for later commands
mobilewright-cli apps
mobilewright-cli app-install ./app.apk
mobilewright-cli app-install ./app.ipa
mobilewright-cli launch com.example.app
mobilewright-cli terminate com.example.app
mobilewright-cli url myapp://checkout/42
```

### Reading the screen

```bash
mobilewright-cli snapshot
# find prints only matching elements, with refs
mobilewright-cli find --text "Sign in"
mobilewright-cli find --text "/sign (in|up)/i"
mobilewright-cli find --role button --name "Sign in"
mobilewright-cli find --test-id login
mobilewright-cli find --label "Password"
mobilewright-cli find --placeholder Email
mobilewright-cli find --role listitem --has-text Milk --first
mobilewright-cli find --role listitem --nth 2
mobilewright-cli screenshot
mobilewright-cli screenshot e5 -o element.png
```

### Actions

Targets are a ref (`e12`) or coordinates (`100,200`).

```bash
mobilewright-cli tap e12
mobilewright-cli doubletap e12
mobilewright-cli longpress e12
mobilewright-cli fill e7 "alice@example.com"   # tap, clear, type
mobilewright-cli type "more text"              # into the focused element, no tap/clear
mobilewright-cli press Enter
mobilewright-cli press cmd+a backspace
mobilewright-cli button HOME
mobilewright-cli button BACK
mobilewright-cli swipe up
```

### Assertions

`expect` polls until the condition holds or `--timeout` (default 5000 ms) expires. It takes
the same locator options as `find`.

```bash
mobilewright-cli expect visible --text "Welcome"
mobilewright-cli expect hidden --test-id spinner --timeout 10000
mobilewright-cli expect text "3 items" --test-id cart-count
mobilewright-cli expect contain-text "items" --test-id cart-count
mobilewright-cli expect value "alice@example.com" --placeholder Email
mobilewright-cli expect count 3 --role listitem
mobilewright-cli expect enabled --role button --name "Pay"
mobilewright-cli expect checked --role switch --name "Remember me"
```

### Logs and video

```bash
mobilewright-cli logs
mobilewright-cli logs --limit 500
mobilewright-cli logs --filter level=Error --filter process!=SpringBoard
mobilewright-cli video-start
mobilewright-cli video-start demo.mp4
mobilewright-cli video-stop
```

### Sessions

Use `-s <name>` to drive two devices side by side; each session keeps its own device and refs.

```bash
mobilewright-cli -s phone --device <ios-id> launch com.example.app
mobilewright-cli -s tablet --device <android-id> launch com.example.app
mobilewright-cli -s phone tap e3
```

### JSON output

`--json` prints one object per command: `{ ok, code, result, device, app, snapshot }` on
success and `{ error }` on failure.

## Writing a test from a session

```bash
mobilewright-cli find --placeholder Email          # screen.getByPlaceholder('Email')
mobilewright-cli fill e7 "alice@example.com"       # await screen.getByPlaceholder('Email').fill('alice@example.com');
mobilewright-cli find --role button --name "Sign in"
mobilewright-cli tap e9                            # await screen.getByRole('button', { name: 'Sign in' }).tap();
mobilewright-cli expect visible --text "Welcome"   # await expect(screen.getByText('Welcome')).toBeVisible();
```

```ts
import { test, expect } from '@mobilewright/test';

test('signs in', async ({ device, screen }) => {
  await device.launchApp('com.example.app');
  await screen.getByPlaceholder('Email').fill('alice@example.com');
  await screen.getByRole('button', { name: 'Sign in' }).tap();
  await expect(screen.getByText('Welcome')).toBeVisible();
});
```
