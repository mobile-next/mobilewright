# Mobilewright — Claude Code rules

## Commits & branches

- Branch names must follow conventional format: `feat/…`, `fix/…`, `chore/…`, `ci/…`, `docs/…`, `refactor/…`, `test/…`
- Commit messages must follow Conventional Commits: `feat:`, `fix:`, `chore:`, etc. — single line, no body
- Always run `npm run lint` and confirm it passes before committing
- Stage only the files required for the change — never `git add -A` or `git add .`

## Bug fixes

- Every bug fix goes on its own `fix/…` branch with a test that reproduces the bug: run it and watch it fail before the fix, then pass after
- Run device-driving checks (emulator, simulator, real devices) one at a time — never in parallel across devices, the shared mobilecli server and app state make results race
