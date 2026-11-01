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

Measure flakiness by running each test many times, without retries:

```bash
npx mobilewright test tests/login.test.ts --repeat-each=20 --retries=0
```

Stop at the first failure:

```bash
npx mobilewright test -x
```

Flags override the matching option in `mobilewright.config.ts`.

### Options

| Flag | Description |
|------|-------------|
| `-c, --config <file>` | Path to config file |
| `--reporter <reporter>` | Reporter type: `list`, `html`, `json` |
| `-g, --grep <regex>` | Only run tests matching this pattern |
| `-G, --grep-invert <regex>` | Skip tests matching this pattern |
| `--project <name...>` | Run tests from specific projects |
| `--retries <count>` | Retry failed tests up to this many times |
| `--repeat-each <N>` | Run each test `N` times. Default: `1` |
| `--fail-on-flaky-tests` | Fail the run if any test is flagged as flaky |
| `--forbid-only` | Fail the run if `test.only` is called. Useful on CI |
| `--max-failures <N>` | Stop after the first `N` test failures |
| `-x` | Stop after the first failure. Same as `--max-failures=1` |
| `--timeout <ms>` | Test timeout in milliseconds |
| `-j, --workers <count>` | Number of concurrent workers |
| `--shard <x/n>` | Run only shard `x` of `n`, e.g. `1/3` — see [Sharding](./sharding.md) |
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

```bash
npm init mobilewright@latest
```

Prompts for TypeScript or JavaScript, the test directory (default `tests`), and the bundle
ID of the app under test — pre-filling the bundle ID if it finds an Xcode or Gradle project
nearby. It then writes `package.json`, `mobilewright.config.ts` and
`tests/example.spec.ts`, and runs `npm install`.

See [Installation](../getting-started/intro.md) for the generated files.
