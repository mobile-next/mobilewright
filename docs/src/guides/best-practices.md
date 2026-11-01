---
title: Best Practices
---

# Best Practices

Tips for running Mobilewright in CI quickly and reliably.

## Build the app in its own job

Compile your `.ipa` and `.apk` on a machine that is ready for it, with Xcode, the Android SDK, signing certificates and build caches already in place. Keep this as a simple pipeline job that produces the app artifacts and hands them to the next job, which runs the tests on local or remote devices.

This keeps each job focused:

- A failed build fails fast, before any device is allocated.
- The test job doesn't need a toolchain, only Node.js and the app file.
- You can rerun flaky tests without rebuilding the app.

```yaml
jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/build-app.sh  # produces build/app.ipa and build/app.apk
      - uses: actions/upload-artifact@v4
        with:
          name: app
          path: build/

  test:
    needs: build
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: app
          path: build/
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npx mobilewright test
```

## Run cloud device tests on Ubuntu

With [cloud devices](../cloud-providers/index.md), the devices run elsewhere, so the test job doesn't need a Mac. Compile the `.ipa` on a Mac, then run Mobilewright on a plain Ubuntu machine, which is cheaper and usually starts faster.

In the example above, change the test job to:

```yaml
  test:
    needs: build
    runs-on: ubuntu-latest
    env:
      MOBILENEXT_API_KEY: ${{ secrets.MOBILENEXT_API_KEY }}
```

Point `installApps` at the downloaded file, for example `./build/app.ipa`, and the driver uploads it to the cloud.

## Self-hosted simulators and emulators: shard

Simulators and emulators use a lot of CPU and memory, so a single machine can only run a few of them before everything slows down. Adding more workers on the same machine stops helping quickly.

Use [sharding](../test/sharding.md) to split the suite across several machines, each running its own simulators or emulators:

```yaml
  test:
    needs: build
    runs-on: macos-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3]
    steps:
      # ...checkout, download app, npm ci
      - run: npx mobilewright test --shard=${{ matrix.shard }}/3
```

Three machines cut the wall-clock time to about a third.

## Cloud devices: increase workers

With cloud devices, the machine running the tests does little work, so sharding helps less. Use [`--workers`](../test/parallelism.md) to run tests on several cloud devices at the same time:

```bash
npx mobilewright test --workers=4
```

Start with 1 worker and increase it once your suite is stable. With more than one worker, tests run at the same time, so make sure they don't modify the same backend state. For example, two tests editing the same user account will interfere with each other. Give each test its own data, such as a fresh account per test, before raising the worker count.
