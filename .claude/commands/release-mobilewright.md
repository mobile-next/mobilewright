Prepare a mobilewright release by updating CHANGELOG.md with the next patch version.

## Steps

### 1. Verify version consistency

- Run `git tag --sort=-version:refname | head -1` to get the latest git tag (e.g. `v0.0.35`)
- Read the first line of `CHANGELOG.md` to extract the version there (e.g. `## [0.0.35]`)
- If they do not match, stop and report the mismatch. Do not proceed.

### 2. Compute next version

- Strip the `v` prefix from the latest tag, split on `.`, increment the patch segment by 1
- Example: `v0.0.35` → `0.0.36`

### 3. Collect changes since last tag

- Run `git log v<LAST_VERSION>..HEAD --oneline` to list commits
- For each commit, try to find an associated PR number:
  - Look for `(#NNN)` in the commit message, or
  - Run `gh pr list --state merged --search "<commit sha>" --json number,title,author` via the GitHub API
- For each PR found, fetch the author: `gh pr view <NNN> --repo mobile-next/mobilewright --json author --jq '.author.login'`

### 4. Determine contributor credit

- Read `.github/CODEOWNERS` to get the list of maintainer GitHub logins
- For each change, if the PR author is **not** in the CODEOWNERS maintainers list, append:
  `thanks to [@<login>](https://github.com/<login>)`

### 5. Format the CHANGELOG entry

Use the existing CHANGELOG.md format:

```
## [0.0.36] (YYYY-MM-DD)
* Feat: description ([#NNN](https://github.com/mobile-next/mobilewright/pull/NNN))
* Fix: description ([#NNN](https://github.com/mobile-next/mobilewright/pull/NNN)), thanks to [@login](https://github.com/login)
```

- Use today's date for the release date
- Capitalise the type prefix (`Feat`, `Fix`, `Chore`, etc.) from the conventional commit prefix
- Omit chore/ci/docs commits that are not user-facing unless they are significant
- Prepend the new entry at the top of CHANGELOG.md, above the previous `## [...]` line

### 6. Stop — do not commit

Display the new CHANGELOG.md entry and remind the human to review and commit manually when ready.
The suggested commit and tag commands to show the user:

```
git add CHANGELOG.md
git commit -m "chore: update changelog for v0.0.36"
git tag v0.0.36
git push && git push --tags
```
