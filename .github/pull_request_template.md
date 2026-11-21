<!--
Title: Conventional Commits, describing the user-visible symptom.
  fix(core): fill() clears secure text fields on iOS
  not: fix: add null check
Keep "Allow edits by maintainers" enabled.
Follow CONTRIBUTING.md#scope-and-approval. Features, new public APIs, intentional public behavior changes, new dependencies, and new telemetry/runtime network behavior need a linked issue and maintainer approval. Bug fixes restoring documented behavior may open directly.
-->

<!-- Fixes #123 if this resolves an issue; otherwise link a related issue or omit when none is required. -->

## Problem

<!-- What goes wrong for a user, and when. One or two sentences. Name the workflow, not the code. -->

## Solution

<!-- How this change fixes it. Mention new public APIs, options or env vars, and any tradeoff or rejected alternative. Leave file-by-file details to the diff. -->

## Evidence

<!--
- Regression test (bug fixes): path, command, observed failure before the fix, and passing result afterward
- Build/lint/test commands and observed results, or documentation checks for docs-only changes
- Devices verified on, if any: e.g. iPhone 17 Pro simulator iOS 26 / Pixel 8 Android 15
- Inspected, sanitized before/after screenshots for inspector or report UI changes
- Checks or device flows not verified, blockers, and baseline failures with the tested base revision
-->

## Checklist

- [ ] Required checks pass; any blocked checks or baseline failures are documented (see CONTRIBUTING.md#verification)
- [ ] Bug fix includes a regression test and observed before/after results, or a verification blocker is documented
- [ ] User-facing behavior change includes docs
- [ ] One concern only: no unrelated refactors, formatting or dependency bumps
- [ ] `package-lock.json` regenerated if dependencies changed
