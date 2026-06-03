# Mobilewright — Claude Code rules

## Commits & branches

- Branch names must follow conventional format: `feat/…`, `fix/…`, `chore/…`, `ci/…`, `docs/…`, `refactor/…`, `test/…`
- Commit messages must follow Conventional Commits: `feat:`, `fix:`, `chore:`, etc. — single line, no body
- Always run `npm run lint` and confirm it passes before committing
- Stage only the files required for the change — never `git add -A` or `git add .`
