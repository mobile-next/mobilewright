---
sidebar_position: 1
title: Introduction
---

# Mobilewright CLI for agents

`@mobilewright/cli` is a command line interface for driving iOS and Android devices,
built for coding agents such as Claude Code, Codex and Cursor. It follows the same model as
Playwright's agent CLI: the agent runs short shell commands instead of calling structured
MCP tools, and every screen comes back as a compact text tree with element references
it can act on next.

## Why a CLI

- **Token-efficient.** A screen is printed as a few dozen lines of text, not a JSON
  view hierarchy or a screenshot. Only elements that carry text or can be acted on appear.
- **Ref-based.** Every element in a snapshot gets a stable reference such as `e12`.
  Follow-up commands (`tap e12`, `fill e12 "hello"`) target the element by ref, so the
  agent never guesses coordinates.
- **Locator semantics.** `find` and `expect` use the same locator engine as Mobilewright
  tests (`--role`, `--text`, `--test-id`, `--label`, `--placeholder`), so what an agent
  discovers interactively maps 1:1 onto test code.
- **Auto-waiting assertions.** `expect` polls until the condition holds or the timeout
  expires, exactly like `expect(locator)` in a test.
- **Cross-platform.** The same commands work on iOS simulators, real iPhones, Android
  emulators and real Android devices.

## Installation

```bash
npm install -g @mobilewright/cli
```

The CLI drives devices through [mobilecli](https://github.com/mobile-next/mobilecli), which is
pulled in as a dependency. Run `mobilewright doctor` if a device does not show up.

## Usage

```bash
mobilewright-cli devices
mobilewright-cli launch com.example.app
mobilewright-cli snapshot
mobilewright-cli fill e7 "alice@example.com"
mobilewright-cli tap e9
mobilewright-cli expect visible --text "Welcome back"
mobilewright-cli screenshot -o welcome.png
```

After every action the CLI prints the Mobilewright code it ran, the device state and
a link to a fresh snapshot of the screen:

````
### Ran Mobilewright code
```js
await screen.getByRole('button', { name: 'Sign in' }).tap();
```
### Device
- Device ID: 6A557392-1480-4355-9EBC-B1D12A0F665D
- App: com.example.app
### Snapshot
- [Snapshot](.mobilewright-cli/screen-2026-09-14T20-13-21-867Z.yml)
````

`mobilewright-cli snapshot` prints the same tree inline; the file an action links to looks like:

```
- textfield [ref=e7] [testid="email"] [placeholder="Email"]
- textfield [ref=e8] [testid="password"] [placeholder="Password"]
- button "Sign in" [ref=e9]
- text "Forgot password?" [ref=e10]
```

Each line is `- <role> "<name>" [ref=<ref>]` followed by attributes: `testid`,
`placeholder`, `value`, `hidden`, `disabled`, `checked`, `selected`, `focused`. Nesting
shows containment. Roles are the same semantic roles used by
[`getByRole()`](../guides/locators.md).

The `Ran Mobilewright code` line is the exact call a test would make for the element
you targeted: test ID first, then role and name, then label, text or placeholder.
Collect these lines and you have a test.

## Agent skill

The package ships a `SKILL.md` that teaches coding agents the command set. Initialize the
workspace and install it into the current project with:

```bash
mobilewright-cli install
```

```
✅ Workspace initialized at `/path/to/project`.
✅ Added `.mobilewright-cli/` to `.gitignore`.
✅ Installed skill at `/path/to/project/.claude/skills/mobilewright-cli`.
```

| Option | Description |
|--------|-------------|
| `--skills <target>` | `claude` (default) installs to `.claude/skills/`, `agents` to `.agents/skills/` |
| `-g, --global` | Install the skill under your home directory instead of the project |

The skill path is also printed at the top of `mobilewright-cli --help`.

## Choosing a device

When exactly one device is online it is picked automatically and remembered for the
session. Otherwise pass `--device <id>` once; later commands reuse it.

```bash
mobilewright-cli --device Pixel_9_Pro launch com.example.app
mobilewright-cli snapshot            # same device
```

The `MOBILEWRIGHT_DEVICE` environment variable works as a default for `--device`.

## Sessions

Refs and the chosen device live in a session file. The default session is `default`;
use `-s <name>` to drive two devices side by side:

```bash
mobilewright-cli -s phone --device <ios-id> launch com.example.app
mobilewright-cli -s tablet --device <android-id> launch com.example.app
mobilewright-cli -s phone snapshot
```

Session files are stored under the system temp directory, or under
`MOBILEWRIGHT_CLI_DIR` when set.

## Command reference

### Devices and apps

| Command | Description |
|---------|-------------|
| `devices` | List connected devices, simulators and emulators |
| `apps` | List installed apps |
| `app-install <path>` | Install a `.apk` (Android) or `.ipa`/`.zip`/`.app` (iOS) |
| `launch <bundleId>` | Launch an app and wait for it to reach the foreground |
| `terminate <bundleId>` | Terminate a running app |
| `url <url>` | Open a URL or deep link |

### Reading the screen

| Command | Description |
|---------|-------------|
| `snapshot` | Print the screen tree with refs to stdout (actions link a file under `.mobilewright-cli/` instead) |
| `find [locator options]` | Print only the elements matching a locator, with their refs |
| `screenshot [ref] [-o file]` | Save a PNG of the screen, or of one element (default `screenshot.png`) |

### Locator options

Used by `find` and `expect`. Combine several to narrow the match.

| Option | Description |
|--------|-------------|
| `--text <text>` | Visible text. Use `/regex/i` for a pattern |
| `--role <role>` | Semantic role: `button`, `textfield`, `text`, `image`, `switch`, `checkbox`, `radio`, `slider`, `progressbar`, `alert`, `combobox`, `list`, `listitem`, `tab`, `link`, `header` |
| `--name <name>` | With `--role`: accessible name, plain or `/regex/` |
| `--test-id <id>` | Accessibility identifier (iOS) or resource-id (Android) |
| `--label <label>` | Accessibility label |
| `--placeholder <text>` | Placeholder text of an input |
| `--type <type>` | Raw native type, e.g. `XCUIElementTypeCell` |
| `--exact` | Require an exact match for text, label and placeholder |
| `--has-text <text>` | Keep elements whose subtree contains this text |
| `--has-not-text <text>` | Drop elements whose subtree contains this text |
| `--nth <index>` | Pick the n-th match (0-based, negative counts from the end) |
| `--first` / `--last` | Pick the first or last match |

```bash
mobilewright-cli find --role button --name /sign in/i
mobilewright-cli find --role listitem --has-text "Milk" --first
```

### Actions

Targets are a ref from the last `snapshot` or `find` (`e12`) or raw coordinates (`x,y`).

| Command | Description |
|---------|-------------|
| `tap <target>` | Tap the center of an element |
| `doubletap <target>` | Double-tap |
| `longpress <target>` | Long-press |
| `fill <target> <text>` | Tap a text field, clear it and type |
| `type <text>` | Type into the focused element, without tapping or clearing first |
| `press <keys...>` | Press keyboard keys: `Enter`, `backspace`, `cmd+a` |
| `button <name>` | Hardware button: `HOME`, `BACK`, `POWER`, `VOLUME_UP`, `VOLUME_DOWN`, `ENTER`, `APP_SWITCH`, `LOCK`, `DPAD_*` |
| `swipe <direction>` | Swipe from the screen center: `up`, `down`, `left`, `right` |

### Logs and video

| Command | Description |
|---------|-------------|
| `logs [--filter k=v...] [--limit n]` | Print recent device logs as JSON lines (default 100). Filter keys: `pid`, `process`, `tag`, `level`, `subsystem`, `category`, `message`; use `k!=v` to exclude |
| `video-start [file]` | Start recording the screen to an MP4 (default `.mobilewright-cli/video-<timestamp>.mp4`) |
| `video-stop` | Stop recording and print the file path |

```bash
mobilewright-cli logs --filter level=Error --filter process!=SpringBoard
mobilewright-cli video-start demo.mp4
mobilewright-cli tap e9
mobilewright-cli video-stop
```

### Assertions

```bash
mobilewright-cli expect <matcher> [value] [locator options] [--timeout <ms>]
```

| Matcher | Description |
|---------|-------------|
| `visible` / `hidden` | Element is (not) visible |
| `enabled` / `disabled` | Element is (not) enabled |
| `checked` / `selected` / `focused` | Element state |
| `text <value>` | Element text equals value |
| `contain-text <value>` | Element text contains value |
| `value <value>` | Input value equals value |
| `count <n>` | Locator matches exactly n elements |

`expect` retries until the matcher holds or `--timeout` (default 5000 ms) expires, then
exits with code 1 and prints the reason.

```bash
mobilewright-cli expect visible --text "Welcome"
mobilewright-cli expect count 3 --role listitem --timeout 10000
```

### Global options

| Option | Description |
|--------|-------------|
| `-d, --device <id>` | Device to use; remembered for the session |
| `-s, --session <name>` | Session name (default `default`) |
| `--json` | Machine-readable output |
| `--version` | Print the version |

With `--json`, commands print one object: `{ ok, code, result, device, app, snapshot }` on
success, `{ error }` on failure. The exceptions: `devices` prints the device array, `install`
prints `{ ok, lines }`, `video-stop` prints `{ ok, video }`, and `logs` always prints JSON lines.

## From exploration to a test

Every action prints the test code it corresponds to, so an interactive session translates
directly into a Mobilewright test:

```bash
mobilewright-cli find --placeholder Email          # screen.getByPlaceholder('Email')
mobilewright-cli fill e7 "alice@example.com"       # await screen.getByPlaceholder('Email').fill('alice@example.com');
mobilewright-cli find --role button --name "Sign in"
mobilewright-cli tap e9                            # await screen.getByRole('button', { name: 'Sign in' }).tap();
mobilewright-cli expect visible --text "Welcome"   # await expect(screen.getByText('Welcome')).toBeVisible();
```

```ts
await screen.getByPlaceholder('Email').fill('alice@example.com');
await screen.getByRole('button', { name: 'Sign in' }).tap();
await expect(screen.getByText('Welcome')).toBeVisible();
```

## CLI vs MCP

| | CLI | [MCP](https://github.com/mobile-next/mobile-mcp) |
|---|---|---|
| Best for | Coding agents that already run shell commands | Agent loops that call structured tools |
| Discovery | `--help` and this page | Tool schemas sent with every request |
| Token cost | Lower: one text line per element | Higher: tool schemas plus JSON results |
| Setup | `npm install -g @mobilewright/cli` | MCP server config |
