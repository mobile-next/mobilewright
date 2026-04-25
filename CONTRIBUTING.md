# Contributing to Mobilewright

Thanks for your interest in contributing! This document covers the basics for getting set up and submitting changes.

## Code of Conduct

This project adheres to the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating, you agree to keep the community welcoming and respectful. Please report unacceptable behavior to the maintainers.

## Reporting bugs and requesting features

- Search [existing issues](https://github.com/mobile-next/mobilewright/issues) before opening a new one.
- Open one issue per bug or feature request.
- For bugs, include: Mobilewright version, OS, target platform (iOS/Android), device or simulator, a minimal reproduction, and the actual vs. expected behavior.
- For larger feature proposals, please open an issue to discuss the design before sending a PR.

## Reporting security issues

Please **do not** file public GitHub issues for security vulnerabilities. Instead, use GitHub's [private vulnerability reporting](https://github.com/mobile-next/mobilewright/security/advisories/new) so we can investigate and ship a fix before disclosure.

## Development setup

Requirements: Node.js 18+ and a clone of this repo.

```bash
git clone https://github.com/mobile-next/mobilewright.git
cd mobilewright
npm install
npm run build

# run the tests
npm test
# or for coverage reports
npm test:coverage
```

The repo is an npm workspace; packages live under `packages/*`.

## Submitting changes

- Branch off `main` and open a pull request when ready.
- Keep PRs focused — one concern per PR.
- Smallest change as possible.
- Add or update tests for any behavior change.
- Run `npm run build` and `npm test` locally before pushing.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
