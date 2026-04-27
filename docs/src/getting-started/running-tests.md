---
title: Running Tests
description: How to run Mobilewright tests with npx mobilewright test.
sidebar:
  order: 2
---

## Basic usage

```bash
npx mobilewright test
```

Mobilewright looks for a `mobilewright.config.ts` (or `.js`) in the current directory and runs all matching test files.

## Filtering tests

Run a specific file or directory:

```bash
npx mobilewright test tests/login.test.ts
npx mobilewright test tests/checkout/
```

Run tests whose name matches a pattern (`--grep` accepts a regular expression):

```bash
npx mobilewright test --grep "should take a screenshot"
npx mobilewright test --grep-invert "flaky"
```

Run only tests belonging to a specific project (defined in `mobilewright.config.ts`):

```bash
npx mobilewright test --project ios
```

## Common options

| Flag | Description |
|---|---|
| `--workers <n>` | Number of concurrent workers (= concurrent devices). Default: `1`. |
| `--retries <n>` | Retry failing tests up to `n` times. |
| `--timeout <ms>` | Per-test timeout in milliseconds. |
| `--reporter <name>` | Reporter: `list` (default), `html`, `json`, `junit`. |
| `--grep <pattern>` | Only run tests matching the regex. |
| `--grep-invert <pattern>` | Skip tests matching the regex. |
| `--project <name>` | Run only the named project(s). |
| `--list` | List all tests without running them. |
| `--pass-with-no-tests` | Exit 0 when no tests are found (useful in CI). |
| `-c, --config <file>` | Use a specific config file. |

## Reporters

```bash
# Terminal list output (default)
npx mobilewright test --reporter list

# Interactive HTML report
npx mobilewright test --reporter html
npx mobilewright show-report
```

## Environment variables

Pass environment variables the normal way — they are visible to both the test runner and the test code:

```bash
TEST_USER=value npx mobilewright test
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | All tests passed (or no tests found with `--pass-with-no-tests`). |
| `1` | One or more tests failed. |
| `130` | Run was interrupted (Ctrl-C). |

## Configuration file

Most options can be set permanently in `mobilewright.config.ts` so you do not need to pass them every time:

```ts
import { defineConfig } from 'mobilewright';

export default defineConfig({
  testDir: './src',
  timeout: 60_000,
  retries: 1,
  workers: 2,
  fullyParallel: true,
  reporter: 'html',
});
```

Command-line flags always override the config file.
