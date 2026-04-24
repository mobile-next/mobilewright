---
sidebar_position: 1
title: Command Line
---

# Command Line

## Running tests

```bash
npx mobilewright test
```

Run a single test file:

```bash
npx mobilewright test tests/login.test.ts
```

Run tests matching a title:

```bash
npx mobilewright test --grep "sign in"
```

Run tests from a specific project:

```bash
npx mobilewright test --project=ios
```

### Options

| Flag | Description |
|------|-------------|
| `-c, --config <file>` | Path to config file |
| `--reporter <reporter>` | Reporter type: `list`, `html`, `json` |
| `--grep <regex>` | Only run tests matching this pattern |
| `--grep-invert <regex>` | Skip tests matching this pattern |
| `--project <name...>` | Run tests from specific projects |
| `--retries <count>` | Retry failed tests up to this many times |
| `--timeout <ms>` | Test timeout in milliseconds |
| `--workers <count>` | Number of concurrent workers |
| `--pass-with-no-tests` | Exit with code 0 when no tests are found |
| `--list` | List all tests without running them |

## Show report

Open the HTML test report from a previous run:

```bash
npx mobilewright show-report
```

Open a report from a specific directory:

```bash
npx mobilewright show-report ./my-report
```

By default, the report is served at `localhost:9323`. You can change the host and port:

```bash
npx mobilewright show-report --host 0.0.0.0 --port 8080
```

## List devices

List all connected devices, simulators, and emulators:

```bash
npx mobilewright devices
```

## Take a screenshot

Capture a screenshot of the current device screen:

```bash
npx mobilewright screenshot
```

Save to a specific file:

```bash
npx mobilewright screenshot -o home-screen.png
```

Target a specific device:

```bash
npx mobilewright screenshot -d <device-id>
```

## Check environment

Verify your environment is set up correctly for mobile development:

```bash
npx mobilewright doctor
```

Output as JSON for scripting:

```bash
npx mobilewright doctor --json
```

Check a specific category:

```bash
npx mobilewright doctor --category ios
npx mobilewright doctor --category android
npx mobilewright doctor --category system
```

## Scaffold a project

Create a `mobilewright.config.ts` and `example.test.ts` in the current directory:

```bash
npm init mobilewright
```

Existing files are not overwritten.
