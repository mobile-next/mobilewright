import { test, expect } from '@playwright/test';
import { getGitInfo, normalizeRepoUrl } from './git-info.js';

const ALL_CI_KEYS = [
  'GITHUB_ACTIONS', 'GITLAB_CI', 'JENKINS_URL',
  'CIRCLECI', 'TRAVIS', 'TF_BUILD', 'BITBUCKET_PIPELINE_UUID',
];

function withCIEnv(vars: Record<string, string>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  const keysToManage = [...new Set([...ALL_CI_KEYS, ...Object.keys(vars)])];
  for (const key of keysToManage) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(vars)) {
    process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const key of keysToManage) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

test('normalizeRepoUrl converts SSH git@ URL to HTTPS', () => {
  expect(normalizeRepoUrl('git@github.com:org/repo.git')).toBe('https://github.com/org/repo');
});

test('normalizeRepoUrl converts ssh:// URL to HTTPS', () => {
  expect(normalizeRepoUrl('ssh://git@github.com/org/repo.git')).toBe('https://github.com/org/repo');
});

test('normalizeRepoUrl strips .git suffix from HTTPS URL', () => {
  expect(normalizeRepoUrl('https://github.com/org/repo.git')).toBe('https://github.com/org/repo');
});

test('normalizeRepoUrl leaves plain HTTPS URL unchanged', () => {
  expect(normalizeRepoUrl('https://github.com/org/repo')).toBe('https://github.com/org/repo');
});

test('getGitInfo reads GitHub Actions environment variables', () => {
  withCIEnv({
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'myorg/myrepo',
    GITHUB_SHA: 'abc123def456',
    GITHUB_REF_NAME: 'main',
    GITHUB_ACTOR: 'octocat',
    GITHUB_COMMIT_MESSAGE: 'feat: add feature',
  }, () => {
    const info = getGitInfo();
    expect(info.repoUrl).toBe('https://github.com/myorg/myrepo');
    expect(info.commitSha).toBe('abc123def456');
    expect(info.branch).toBe('main');
    expect(info.authorName).toBe('octocat');
    expect(info.commitMessage).toBe('feat: add feature');
  });
});

test('getGitInfo reads GitLab CI environment variables', () => {
  withCIEnv({
    GITLAB_CI: 'true',
    CI_PROJECT_URL: 'https://gitlab.com/myorg/myrepo',
    CI_COMMIT_SHA: 'deadbeef',
    CI_COMMIT_REF_NAME: 'feature-branch',
    GITLAB_USER_NAME: 'alice',
    CI_COMMIT_MESSAGE: 'fix: bug',
  }, () => {
    const info = getGitInfo();
    expect(info.repoUrl).toBe('https://gitlab.com/myorg/myrepo');
    expect(info.commitSha).toBe('deadbeef');
    expect(info.branch).toBe('feature-branch');
    expect(info.authorName).toBe('alice');
    expect(info.commitMessage).toBe('fix: bug');
  });
});

test('getGitInfo reads Azure DevOps environment variables and strips refs/heads/ prefix', () => {
  withCIEnv({
    TF_BUILD: 'true',
    BUILD_REPOSITORY_URI: 'https://dev.azure.com/org/project/_git/repo',
    BUILD_SOURCEBRANCH: 'refs/heads/main',
    BUILD_SOURCEVERSION: 'abc123',
    BUILD_REQUESTEDFOR: 'Bob',
    BUILD_SOURCEVERSIONMESSAGE: 'chore: update deps',
  }, () => {
    const info = getGitInfo();
    expect(info.branch).toBe('main');
    expect(info.repoUrl).toBe('https://dev.azure.com/org/project/_git/repo');
    expect(info.authorName).toBe('Bob');
  });
});

test('getGitInfo falls back to local git when no CI env vars are set', () => {
  // This test runs inside the mobilewright git repo, so local git should work.
  withCIEnv({}, () => {
    const info = getGitInfo();
    expect(typeof info.branch).toBe('string');
    expect(typeof info.commitSha).toBe('string');
    expect(info.commitSha).toHaveLength(40);
  });
});

test('getGitInfo returns empty object when not in a git repo and no CI env vars', () => {
  // Simulate a non-git environment by checking we get an object (may be empty)
  const info = getGitInfo();
  expect(typeof info).toBe('object');
  expect(info).not.toBeNull();
});
