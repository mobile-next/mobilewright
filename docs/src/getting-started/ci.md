---
sidebar_position: 3
title: Setting up CI
---

# Setting up CI

Mobilewright tests can run in continuous integration. This guide uses GitHub Actions as an example.

## GitHub Actions

Create `.github/workflows/mobilewright.yml`:

```yaml
name: Mobilewright Tests
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npx mobilewright test --reporter html
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: mobilewright-report
          path: mobilewright-report/
          retention-days: 30
```

Key points:

- **`macos-latest`** is required for iOS simulators. Use `ubuntu-latest` if you only need Android emulators.
- **`if: ${{ !cancelled() }}`** ensures the report is uploaded even when tests fail.

## Viewing the report

After the workflow runs, download the report artifact from the GitHub Actions summary page. Then open it locally:

```bash
npx mobilewright show-report ./path/to/downloaded/mobilewright-report
```

## Running on pull requests

The workflow above already triggers on pull requests to `main`. Test results appear in the Actions tab of the pull request, so failing tests are visible before merging.

## Sharding

For large test suites, you can split tests across multiple jobs using Playwright's built-in sharding:

```yaml
jobs:
  test:
    runs-on: macos-latest
    strategy:
      matrix:
        shard: [1/3, 2/3, 3/3]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npx mobilewright test --shard ${{ matrix.shard }}
```
