import { execFileSync } from 'node:child_process';

export interface GitInfo {
  repoUrl?: string;
  branch?: string;
  commitSha?: string;
  authorName?: string;
  commitMessage?: string;
}

function runGit(args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export function normalizeRepoUrl(url: string): string {
  const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`;
  }
  const sshProtocolMatch = url.match(/^ssh:\/\/(?:[^@]+@)?([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshProtocolMatch) {
    return `https://${sshProtocolMatch[1]}/${sshProtocolMatch[2]}`;
  }
  return url.replace(/\.git$/, '');
}

function getGitHubInfo(): GitInfo | undefined {
  if (!process.env['GITHUB_ACTIONS']) {
    return undefined;
  }
  const repo = process.env['GITHUB_REPOSITORY'];
  return {
    repoUrl: repo ? `https://github.com/${repo}` : undefined,
    branch: process.env['GITHUB_REF_NAME'],
    commitSha: process.env['GITHUB_SHA'],
    authorName: process.env['GITHUB_ACTOR'],
    commitMessage: process.env['GITHUB_COMMIT_MESSAGE'] ?? runGit(['log', '-1', '--format=%s']),
  };
}

function getGitLabInfo(): GitInfo | undefined {
  if (!process.env['GITLAB_CI']) {
    return undefined;
  }
  return {
    repoUrl: process.env['CI_PROJECT_URL'],
    branch: process.env['CI_COMMIT_REF_NAME'],
    commitSha: process.env['CI_COMMIT_SHA'],
    authorName: process.env['GITLAB_USER_NAME'] ?? process.env['CI_COMMIT_AUTHOR'],
    commitMessage: process.env['CI_COMMIT_MESSAGE'],
  };
}

function getJenkinsInfo(): GitInfo | undefined {
  if (!process.env['JENKINS_URL']) {
    return undefined;
  }
  const rawUrl = process.env['GIT_URL'];
  const branch = process.env['GIT_BRANCH'] ?? process.env['BRANCH_NAME'] ?? process.env['GIT_LOCAL_BRANCH'];
  return {
    repoUrl: rawUrl ? normalizeRepoUrl(rawUrl) : undefined,
    branch,
    commitSha: process.env['GIT_COMMIT'],
    authorName: process.env['GIT_AUTHOR_NAME'],
    commitMessage: runGit(['log', '-1', '--format=%s']),
  };
}

function getCircleCIInfo(): GitInfo | undefined {
  if (!process.env['CIRCLECI']) {
    return undefined;
  }
  const username = process.env['CIRCLE_PROJECT_USERNAME'];
  const reponame = process.env['CIRCLE_PROJECT_REPONAME'];
  const vcsType = process.env['CIRCLE_VCS_TYPE'] ?? 'github';
  const host = vcsType === 'bitbucket' ? 'bitbucket.org' : 'github.com';
  return {
    repoUrl: username && reponame ? `https://${host}/${username}/${reponame}` : undefined,
    branch: process.env['CIRCLE_BRANCH'],
    commitSha: process.env['CIRCLE_SHA1'],
    authorName: process.env['CIRCLE_USERNAME'],
    commitMessage: runGit(['log', '-1', '--format=%s']),
  };
}

function getTravisInfo(): GitInfo | undefined {
  if (!process.env['TRAVIS']) {
    return undefined;
  }
  const slug = process.env['TRAVIS_REPO_SLUG'];
  return {
    repoUrl: slug ? `https://github.com/${slug}` : undefined,
    branch: process.env['TRAVIS_PULL_REQUEST_BRANCH'] ?? process.env['TRAVIS_BRANCH'],
    commitSha: process.env['TRAVIS_COMMIT'],
    commitMessage: process.env['TRAVIS_COMMIT_MESSAGE'],
  };
}

function getAzureDevOpsInfo(): GitInfo | undefined {
  if (!process.env['TF_BUILD']) {
    return undefined;
  }
  const rawBranch = process.env['SYSTEM_PULLREQUEST_SOURCEBRANCH'] ?? process.env['BUILD_SOURCEBRANCH'];
  return {
    repoUrl: process.env['BUILD_REPOSITORY_URI'],
    branch: rawBranch?.replace('refs/heads/', ''),
    commitSha: process.env['BUILD_SOURCEVERSION'],
    authorName: process.env['BUILD_REQUESTEDFOR'],
    commitMessage: process.env['BUILD_SOURCEVERSIONMESSAGE'],
  };
}

function getBitbucketInfo(): GitInfo | undefined {
  if (!process.env['BITBUCKET_PIPELINE_UUID']) {
    return undefined;
  }
  const slug = process.env['BITBUCKET_REPO_FULL_NAME'];
  return {
    repoUrl: slug ? `https://bitbucket.org/${slug}` : undefined,
    branch: process.env['BITBUCKET_BRANCH'],
    commitSha: process.env['BITBUCKET_COMMIT'],
    commitMessage: runGit(['log', '-1', '--format=%s']),
  };
}

function getLocalGitInfo(): GitInfo | undefined {
  const gitDir = runGit(['rev-parse', '--git-dir']);
  if (!gitDir) {
    return undefined;
  }
  const rawUrl = runGit(['config', '--get', 'remote.origin.url']);
  return {
    repoUrl: rawUrl ? normalizeRepoUrl(rawUrl) : undefined,
    branch: runGit(['rev-parse', '--abbrev-ref', 'HEAD']),
    commitSha: runGit(['rev-parse', 'HEAD']),
    authorName: runGit(['log', '-1', '--format=%an']),
    commitMessage: runGit(['log', '-1', '--format=%s']),
  };
}

export function getGitInfo(): GitInfo {
  const info = getGitHubInfo()
    ?? getGitLabInfo()
    ?? getJenkinsInfo()
    ?? getCircleCIInfo()
    ?? getTravisInfo()
    ?? getAzureDevOpsInfo()
    ?? getBitbucketInfo()
    ?? getLocalGitInfo();
  return info ?? {};
}
