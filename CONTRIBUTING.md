# Contributing to Mobilewright

Thanks for your interest in contributing! This document covers the basics for getting set up and submitting changes.

## Code of Conduct

This project adheres to the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating, you agree to keep the community welcoming and respectful. Please report unacceptable behavior to the maintainers.

## Reporting bugs and requesting features

- Search open and closed [issues](https://github.com/mobile-next/mobilewright/issues) and [pull requests](https://github.com/mobile-next/mobilewright/pulls) for the symptom, API name, and error text before opening a new one. Add evidence to a matching report instead of opening a duplicate.
- Open one issue per bug or feature request. Use the GitHub issue templates.
- Security vulnerabilities use [private reporting](#reporting-security-issues), not public issues. Remove credentials and private app data from logs, UI dumps, screenshots, and other attachments before posting.

### Bug reports

Retest against the latest relevant `mobilewright` and `mobilecli` releases in an isolated reproduction when feasible. Do not upgrade your working checkout just to report a bug. Record tested versions and any reason you could not retest.

Include enough evidence for a maintainer to reproduce the problem:

- **Versions:** Mobilewright, mobilecli when relevant, Node.js, and host OS.
- **Target:** iOS or Android, OS version, device model, and simulator/emulator or real device. Say whether only one platform is affected. Use "not applicable" for device-independent problems.
- **App:** a public app, our playground app, or a minimal sample. If the app is private, say so and try to reproduce on a public sample; mark this field not applicable when no app is involved.
- **Minimal reproduction:** the smallest failing `*.test.ts`, or exact CLI/configuration steps for problems that do not need a test or device.
- **Actual vs. expected:** include exact error text as text, not a terminal screenshot.
- **Debug output:** rerun with `DEBUG=mw:*` and include the relevant sanitized output, or explain why it is unavailable.
- **Locator, missing-element, or inspector failures:** attach a sanitized `mobilecli dump ui --format raw` taken while the affected screen is visible, when using mobilecli. For another backend, include its equivalent diagnostics or explain the gap.
- **What you tried:** explain what each attempt ruled out.

Use a title describing the symptom and trigger, such as `locator.fill() leaves residual text on Android when the field has a hint`.

Choose the repository based on the failing boundary. Missing elements in raw mobilecli output, device agent/WDA failures, and device install/launch or screenshot failures usually belong in [mobilecli](https://github.com/mobile-next/mobilecli). Mobilewright locators, assertions, fixtures, config, CLIs, inspector, and reporting belong here. A provider's own driver limitation belongs with that provider unless our shared code causes it.

### Feature requests and questions

- Lead with the problem and a real test you cannot write today. Show the API you wish worked and the equivalent Playwright API, if one exists.
- Keep public APIs platform-neutral so the same test can run on iOS and Android. We do not plan to add XPath, iOS predicates, or other platform-specific selector strategies.
- Follow the [scope and approval rules](#scope-and-approval) before implementation. Large features, such as new drivers, platforms, or languages, need a design discussion in the issue before a PR.
- For locator questions, read [the documentation](https://mobilewright.dev) and try `npx mobilewright inspect`. If you still open an issue, put the question in the title and show what you tried.

## Reporting security issues

Please **do not** file public GitHub issues for security vulnerabilities. Instead, use GitHub's [private vulnerability reporting](https://github.com/mobile-next/mobilewright/security/advisories/new) so we can investigate and ship a fix before disclosure.

## Development setup

Requirements: Node.js 22.12+ and a clone of this repo.

```bash
git clone https://github.com/mobile-next/mobilewright.git
cd mobilewright
npm install
npm run build

# run the tests
npm test
# or for coverage reports
npm run test:coverage
```

The repo is an npm workspace; packages live under `packages/*`.

### Trying your changes in another project

To run another project's tests against this checkout instead of the published release:

```bash
npm run use-local -- ~/path/to/your-project
```

This builds and packs every package, then points the project's `package.json` at the local tarballs and runs `npm install`. The project's `package.json` and `package-lock.json` must be committed with no local changes. To go back to the published release:

```bash
cd ~/path/to/your-project
git checkout package.json package-lock.json
npm install
```

To pick up further changes, go back to the release first, then run `use-local` again.

## Submitting changes

Read [AGENTS.md](AGENTS.md) for package responsibilities, code rules, and verification requirements.

### Scope and approval

- Bug fixes that restore documented behavior, and small documentation or maintenance fixes, may open a PR directly. Link an existing issue when there is one.
- Features, new public APIs, intentional public behavior changes, new dependencies, and new telemetry or runtime network behavior require a tracking issue and maintainer approval before implementation. Research and normal development tooling are outside the runtime network rule.
- A direct maintainer request counts as approval for its stated scope. For changes requiring an issue, open or reuse one to record that scope and approval; do not ask for the same approval again.
- Refactor-only, formatting-only, and cleanup PRs require a maintainer request.
- Keep one concern per PR. Do not include unrelated refactors, formatting, renames, or dependency bumps.
- Fix mobilecli causes upstream. A workaround here needs a linked upstream issue and an explanation of why an upstream fix cannot currently be used.

### Verification

- Branch off `main` and open a pull request when ready.
- Add tests for behavior changes. For bug fixes, record the regression test command, its observed failure before the fix, and its passing result afterward.
- Follow [the verification requirements](AGENTS.md#tests-and-verification): build, lint, and package tests for code changes, plus relevant device verification. Documentation-only changes need Markdown and link checks and `git diff --check`; executable example or configuration changes also need code checks.
- Report unavailable checks and device verification explicitly. If a check also fails on the base branch, record the base revision and evidence rather than fixing unrelated code. A draft PR can document these gaps; readiness to merge requires passing checks or a maintainer's explicit acceptance of a documented exception.
- User-facing behavior changes include documentation in the same PR. Maintainers own `CHANGELOG.md`.

### Pull request conventions

- Branch prefixes: `fix/`, `feat/`, `docs/`, `chore/`, `refactor/`, `test/`, or `ci/`.
- PR titles and commits use Conventional Commits, for example `fix(core): fill() clears secure text fields on iOS`. Describe the user-visible outcome rather than an implementation detail such as "add null check."
- Keep **Allow edits by maintainers** enabled where available.
- Use the [PR template](.github/pull_request_template.md). Include `Fixes #123` only when the PR resolves that issue; use a related-issue link otherwise, or omit it when no issue is required.
- Under **Problem**, explain what fails and when. Under **Solution**, explain the resulting behavior, relevant tradeoffs, and any new API, option, or environment variable. Under **Evidence**, give observed verification results, device details where applicable, and any remaining gaps. Include inspected, sanitized before/after screenshots for inspector or report UI changes.
- When review asks for context, update the PR description as well as replying. Address each review comment with what changed and the commit hash, or explain why no change was made.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
