---
name: mobilewright-write-tests
description: Turns a mobile app flow into repeatable Mobilewright tests and runs them in GitHub Actions on Mobile Next Cloud devices. Use when asked to write smoke, acceptance or regression tests for an iOS or Android app, to turn a flow explored with Mobile MCP into tests, or to add Mobilewright tests to CI.
---

# Write Mobilewright tests

Follow the steps in order. Every command and API name below matches the `mobilewright` version that ships this skill.

## 1. When to use this skill

Use it when the user wants a flow turned into repeatable Mobilewright tests, optionally running in CI. The flow is one you explored on a device with Mobile MCP, or one the user describes.

The outcome:

- tests that match the project's existing conventions,
- tests that pass three runs in a row on a local device,
- a GitHub Actions workflow, only if the repository uses GitHub Actions,
- a final message to the user (section 10).

## 2. Detect the project state

Check the repository with your own file tools before writing anything.

1. **Existing Mobilewright suite.** Look for `mobilewright.config.ts`, `.js`, `.mjs` or `.cjs`, and for test files that import from `@mobilewright/test` or `mobilewright`. If you find either, go to section 4.
2. **Other UI test frameworks.** Look for:
   - XCUITest: `*UITests` targets or directories,
   - Espresso: `androidTest/` directories,
   - Maestro: a `.maestro/` directory or Maestro `*.yaml` flows,
   - Detox: `.detoxrc*`,
   - Appium: `wdio.conf.*` or `appium` in dependencies.

   Leave them untouched. Add Mobilewright next to them. Don't convert, move or delete any existing test.
3. **Nothing found.** This is a greenfield project. Go to section 3.

Choose where the tests live:

- If `package.json` exists at the repository root, use the root.
- If not (a native-only Xcode or Gradle repository), create `mobile-tests/` with its own `package.json`, and run every command below from `mobile-tests/`.
- In a monorepo, use the package that owns the app. If more than one package could own it, ask the user.

## 3. Greenfield setup

Use the package manager the lockfile names: `package-lock.json` is npm, `pnpm-lock.yaml` is pnpm, `yarn.lock` is yarn, `bun.lock` or `bun.lockb` is bun. With npm:

```bash
npm i -D mobilewright @mobilewright/test
npx mobilewright init
```

Install both packages. Tests import from `@mobilewright/test`, and installing `mobilewright` alone doesn't bring it in.

`npx mobilewright init` writes `mobilewright.config.ts` and `example.test.ts`. It skips any file that already exists. Don't use `npm init mobilewright` or `create-mobilewright`: they are interactive and overwrite the config.

Set `platform` and `bundleId` in `mobilewright.config.ts`:

- iOS: `PRODUCT_BUNDLE_IDENTIFIER` in the Xcode project, or `CFBundleIdentifier` in `Info.plist`.
- Android: `applicationId` in `build.gradle` or `build.gradle.kts`.
- Or call `mobile_get_foreground_app` while the app is open on the device.

```ts title="mobilewright.config.ts"
import { defineConfig } from 'mobilewright';

export default defineConfig({
  platform: 'ios',
  bundleId: 'com.example.app',
  deviceName: /iPhone/,
  timeout: 30_000,
});
```

Delete `example.test.ts` when the real tests exist.

## 4. Adapt to the existing suite

Before writing a test, read the config and two or three existing tests. Match what they do:

- directory and file naming (`.test.ts` or `.spec.ts`),
- fixtures, helpers and page objects; reuse them instead of writing new ones,
- `test.describe` structure,
- assertion style,
- config `projects` (platforms, devices).

Never restructure, rename or "clean up" existing tests.

## 5. Explore, then write

Walk the flow on the device with Mobile MCP first. Read each screen with `mobile_list_elements_on_screen`, not with screenshots.

Map each element to a locator, in this order:

| Element has | Locator |
| --- | --- |
| an identifier (`id=` in text output, `identifier` in JSON) | `screen.getByTestId('<identifier>')` |
| visible text or a label | `screen.getByText('<text>')` or `screen.getByLabel('<label>')` |
| text that isn't unique on the screen | `screen.getByRole('button', { name: '<text>' })` |

`getByTestId` matches the iOS accessibility identifier and the Android resource-id. For Android, pass the part after `:id/`. `getByText` and `getByLabel` match exactly; pass `{ exact: false }` for a substring match. Roles include `button`, `textfield`, `text`, `switch`, `checkbox`, `tab`, `link`, `header`, `list` and `listitem`.

Never use coordinates. Never use Mobile MCP `ref` values; they last only for the current session.

If an element the test needs has no identifier and no stable text, don't write a brittle locator. Tell the user which element needs an accessibility identifier.

How to structure the tests is your call. Use the user's words ("smoke", "acceptance", "regression") and the project's conventions. There is no required tagging scheme or directory layout.

Assert on what the user sees, not on implementation details:

```ts title="login.test.ts"
import { test, expect } from '@mobilewright/test';

test('signs in with email', async ({ screen }) => {
  await screen.getByTestId('email').fill(process.env.TEST_USER_EMAIL!);
  await screen.getByTestId('password').fill(process.env.TEST_USER_PASSWORD!);
  await screen.getByRole('button', { name: 'Sign in' }).tap();
  await expect(screen.getByText('Welcome back')).toBeVisible();
});
```

Locator actions: `tap()`, `doubleTap()`, `longPress()`, `fill(text)`, `clear()`, `check()`, `uncheck()`, `swipe({ direction })`, `scrollIntoViewIfNeeded()`. Assertions: `toBeVisible()`, `toBeHidden()`, `toBeEnabled()`, `toHaveText()`, `toContainText()`, `toHaveValue()`.

## 6. App state

Tests assume the app starts with no data on the device. Don't call `device.clearAppData()`, and don't uninstall or reinstall the app.

Known limitation: Mobilewright reuses a device for several tests in a run and installs the app only once. Only the first test on each device starts with no app data. A first-launch flow (onboarding, permission prompts, a first-run tutorial) is reliable only as the first test a device runs. Decide how to structure the tests around this. If the tests cover a first-launch flow, tell the user about the limitation in your final message.

## 7. Secrets and logins

- Read credentials from `process.env` in tests or in the config. Never hardcode them, and never write them into any file.
- Log in through the UI, as the user would. There is no stored-session mechanism.
- Keep a list of every environment variable the tests read. The final message needs it.

## 8. Verify locally

Run each new test file three times in a row, on the local device you explored with:

```bash
npx mobilewright test login.test.ts
npx mobilewright test login.test.ts
npx mobilewright test login.test.ts
```

All three runs must pass. A test that passes only sometimes isn't done.

If a test fails because the app behaves wrongly, don't change the assertion to match the app. Report it to the user as a probable bug, with the step, the expected result and the actual result.

Never commit or push. Leave the changes in the working tree for the user.

## 9. CI

**Only if `.github/` exists.** Otherwise give the user the run command, `npx mobilewright test`, and stop. Don't write GitLab, Bitrise or CircleCI config.

If a workflow already runs `mobilewright`, extend it. Otherwise create `.github/workflows/mobilewright.yml`.

CI devices come from Mobile Next Cloud. Install the driver:

```bash
npm i -D @mobilewright/driver-mobilenext
```

Switch to it in the config only when `MOBILENEXT_API_KEY` is set, so local runs don't change:

```ts title="mobilewright.config.ts"
import { defineConfig, type MobilewrightConfig } from 'mobilewright';
import { MobileNextDriver } from '@mobilewright/driver-mobilenext';

const config: MobilewrightConfig = {
  platform: 'ios',
  bundleId: 'com.example.app',
  deviceName: /iPhone/,
  viewTree: 'on-failure',
};

if (process.env.MOBILENEXT_API_KEY) {
  config.driver = new MobileNextDriver();
  config.deviceType = 'real';
  config.installApps = ['./build/app.ipa'];
}

export default defineConfig(config);
```

The app comes from the repository's existing build: a workflow job, a Fastlane lane, a script or a Gradle task. Real iOS devices need an `.ipa`. Android needs an `.apk`. Point `installApps` at the file that build produces. If you can't find a build, ask the user for the artifact path. Never invent signing, certificate or provisioning steps.

Use two jobs: build the app, then test on `ubuntu-latest`. Pin action major versions:

```yaml title=".github/workflows/mobilewright.yml"
name: Mobilewright Tests
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/build-app.sh  # the repository's existing build; produces build/app.ipa
      - uses: actions/upload-artifact@v4
        with:
          name: app
          path: build/

  test:
    needs: build
    # Fork pull requests get no secrets, so there is no device to test on.
    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 30
    env:
      MOBILENEXT_API_KEY: ${{ secrets.MOBILENEXT_API_KEY }}
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
      - run: npx mobilewright test --reporter list,html
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: mobilewright-report
          path: |
            mobilewright-report/
            test-results/
          retention-days: 30
```

Adjust it to the project:

- Replace the build step with the repository's real build. If a workflow already builds the app, reuse its artifact instead of building again.
- Tests in `mobile-tests/`: set `defaults.run.working-directory: mobile-tests` on the test job and adjust the paths.
- Add every login variable from section 7 to the test job's `env`, from `secrets`.
- Don't turn on video recording. Failure screenshots are always captured.

There is no emulator fallback. The workflow requires `MOBILENEXT_API_KEY`. GitHub doesn't pass secrets to pull requests from forks, so keep the `if:` on the test job: it skips the tests on those pull requests instead of failing them. Tell the user to create an API key at mobilenext.ai and add it as a repository secret named `MOBILENEXT_API_KEY`.

## 10. Final message to the user

End with this checklist:

- files created and modified,
- how to run the tests locally (`npx mobilewright test`),
- secrets to add to the repository: `MOBILENEXT_API_KEY` and every login variable,
- the first-launch limitation from section 6, if the tests cover a first-launch flow,
- probable app bugs you found, each with the step, the expected result and the actual result,
- elements that need an accessibility identifier.
