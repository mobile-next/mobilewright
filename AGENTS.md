# AGENTS.md

Guidance for agents working in Mobilewright, from local investigation through pull requests. Read this file before making changes and any scoped `AGENTS.md` in the affected directories. [CONTRIBUTING.md](CONTRIBUTING.md) owns setup, issue reporting, approval requirements, and PR conventions.

## Repository map

Mobilewright is a TypeScript ESM monorepo using npm workspaces and Node.js 22.12+.

| Path | Responsibility |
| --- | --- |
| `packages/mobilewright-core` | Device, screen, page, locator, and assertion APIs |
| `packages/protocol` | Shared driver interfaces and types |
| `packages/driver-mobilecli` | Adapter to the local mobilecli device backend |
| `packages/driver-mobilenext` | Adapter to the MobileNext service |
| `packages/mobilewright` | Public package, configuration, launchers, and `mobilewright` CLI |
| `packages/test` | Playwright test fixtures and test integration |
| `packages/cli` | `mobilewright-cli`, the CLI for coding agents |
| `packages/inspector` | Browser-based inspector and its server |
| `docs` | User-facing documentation |
| `tests/mobilewright.config.ts` | Configuration for colocated package tests |

Keep device-backend details in the appropriate driver and shared contracts in `packages/protocol`. Follow existing package boundaries instead of importing another package's private implementation.

## Working agreement

- Inspect `git status` before editing. Preserve unrelated changes and untracked files; do not reset, stash, or switch branches underneath other work.
- Read the affected implementation, callers, and tests before changing behavior. Fix the cause in the owning layer.
- Keep the smallest coherent change that solves the problem. Do not reformat unrelated code or rename unrelated symbols or files.
- Follow the [approval rules](CONTRIBUTING.md#scope-and-approval). A direct maintainer request supplies approval for its stated scope; do not ask for the same approval again. Required tracking issues still apply.
- Preserve existing macOS, Linux, and Windows host support. Do not remove or break Windows code paths because you cannot build or test them locally; say in the PR what you could not verify. Device capabilities remain platform-dependent; local iOS simulators require macOS.

## Code rules

- TypeScript, strict. Follow the style of the file you are editing. Always use braces for `if` bodies, even one-liners.
- When using an `await` result, assign it to a variable before passing it to another call or using it in a condition. Standalone `await` calls with unused results are fine.
- Follow Playwright API names and semantics where an equivalent exists. For new read APIs, prefer nouns for parameterless reads (`boundingBox()`) and retain `get` for reads taking an argument (`getAttribute(name)`).
- Keep public selectors platform-neutral; do not add XPath, iOS predicates, or other platform-specific selector strategies.
- Do not add install lifecycle scripts such as `postinstall`. Users must be able to install with scripts disabled.
- Regenerate generated code from its source; do not edit generated output by hand. For the vendored Playwright injected script, run `npm run sync:playwright` and commit the generated changes. CI checks freshness.
- Dependency changes in `package.json` require a matching regenerated `package-lock.json`; registry versions must exist on npm.
- New dependencies, telemetry, or runtime network behavior require an issue and maintainer approval. This rule concerns product changes, not research or normal development tooling.
- Update user-facing documentation with behavior changes. Do not edit `CHANGELOG.md`; maintainers write it at release time.

## Tests and verification

- Every bug fix includes a regression test that fails for the reported behavior before the fix and passes afterward. Record the command and observed results. If verification is blocked, state the blocker and what remains unverified; never claim an unobserved failure or pass.
- Every behavior change includes tests of the user contract: return values, error messages, or emitted protocol, rather than implementation details.
- Unit tests live beside the code as `*.test.ts`.
- `npm test` runs colocated package tests through Playwright using `tests/mobilewright.config.ts`. A passing run does not by itself prove a real device flow works.
- For device-dependent fixes, reproduce the affected flow on the relevant device or simulator when available. Record the model, OS, and platform, and run devices one at a time. Report unavailable device verification explicitly.

Build before testing because workspace packages resolve built output:

```bash
npm run build
npm test -- packages/mobilewright-core/src/locator.test.ts
```

For code changes, run these before pushing:

```bash
npm run build
npm run lint
npm test
```

For documentation-only changes, check Markdown structure and links and run `git diff --check`; code checks are required if executable examples or configuration changed. Review newly created files too, since ordinary `git diff` omits untracked files.

If a check also fails on the base branch, record the command, base revision, and evidence rather than fixing unrelated code. A draft PR may document baseline failures or blocked checks; do not call it ready to merge until required checks pass or a maintainer explicitly accepts the documented exception.

## Issues and pull requests

Before opening an issue or pull request, read [CONTRIBUTING.md](CONTRIBUTING.md) in full. It owns duplicate search, bug report evidence, choosing between this repo and mobilecli, security reporting, scope and approval, and PR conventions.
