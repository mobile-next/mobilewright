---
title: Sharding
description: Split your test suite across multiple machines.
sidebar:
  order: 2
---

Sharding splits your test suite across several machines that run independently and in parallel. Each machine runs a subset of the tests — a **shard**.

Workers parallelize tests on **one** machine. Sharding parallelizes across **multiple** machines.

## Do you need sharding?

It depends on where your devices live.

**Remote devices** (e.g. a device cloud or a remote mobile fleet): CPU and memory on the machine running the tests are not your bottleneck — the devices are off-machine. A single test runner with enough workers is usually all you need:

```bash
npx mobilewright test --workers=20
```

The runner dispatches work to the pool; the pool leases remote devices as fast as they become available. Adding more machines would just duplicate the orchestration overhead without meaningful gain.

**Local simulators or physical devices attached to a Mac**: each Mac can only run as many simulators as its RAM allows (typically 2–4 before performance degrades). To run more simulators in parallel you need more Macs — and that is exactly what sharding enables. Each Mac runs a shard with its own set of local simulators.

## Use cases

### More simulators than one Mac can handle

You have 90 tests and want to run them across 12 iOS simulators, but a single Mac can only sustain 4 simulators at once. Split across three Macs:

| Machine | Shard | Workers (simulators) |
|---------|-------|---------------------|
| Mac 1 | `1/3` | 4 |
| Mac 2 | `2/3` | 4 |
| Mac 3 | `3/3` | 4 |

```bash
# On each Mac (replace N with the shard number)
npx mobilewright test --shard=N/3 --workers=4
```

Twelve simulators run in parallel across three machines. Total time ≈ wall-clock time of 90 ÷ 12 = ~8 tests per device.

## Basic usage

Use `--shard x/n` to run the `x`-th shard out of `n` total shards:

```bash
# Machine 1
npx mobilewright test --shard=1/3

# Machine 2
npx mobilewright test --shard=2/3

# Machine 3
npx mobilewright test --shard=3/3
```

Each machine runs roughly one third of your tests. All three machines run simultaneously in CI, so the total wall-clock time is roughly one third of a single-machine run.

## Combining sharding with workers

Each shard can still use multiple workers (multiple devices) on its machine:

```bash
npx mobilewright test --shard=1/3 --workers=2
```

A 3-shard × 2-worker setup means six devices run tests simultaneously across three machines.

## Balancing shards

With `fullyParallel: true`, Mobilewright distributes individual tests evenly across shards — each shard gets roughly the same number of tests regardless of how they are grouped into files.

Without `fullyParallel`, entire files are assigned to shards. If some files contain far more tests than others, shards become unbalanced and the slowest shard determines total run time. Prefer `fullyParallel: true` for better balance.

## Merging reports from multiple shards

Each shard produces its own report. To get a single combined report, use blob reporters.

**Step 1 — produce blob reports on each shard:**

```ts
// mobilewright.config.ts
export default defineConfig({
  reporter: process.env.CI ? 'blob' : 'html',
});
```

**Step 2 — collect blob reports from all shards and merge:**

```bash
npx mobilewright merge-reports --reporter html ./all-blob-reports
```

## GitHub Actions example

```yaml
jobs:
  test:
    strategy:
      matrix:
        shard: [1, 2, 3]
    steps:
      - uses: actions/checkout@v5
      - run: npx mobilewright test --shard=${{ matrix.shard }}/3
      - uses: actions/upload-artifact@v5
        with:
          name: blob-report-${{ matrix.shard }}
          path: blob-report/

  merge-reports:
    needs: test
    steps:
      - uses: actions/download-artifact@v5
        with:
          path: all-blob-reports
          pattern: blob-report-*
          merge-multiple: true
      - run: npx mobilewright merge-reports --reporter html ./all-blob-reports
      - uses: actions/upload-artifact@v5
        with:
          name: html-report
          path: playwright-report/
```
