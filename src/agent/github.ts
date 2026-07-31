import type { AppConfig } from '../config.js';
import type { Logger } from '../core/logger.js';
import type { CommandExecutor } from './executor.js';
import path from 'node:path';

export interface PullRequestResult {
  url: string;
  number: number;
}

export interface MergePullRequestResult {
  sha: string;
}

export interface OpenPullRequestInput {
  branch: string;
  title: string;
  body: string;
}

export class GitHubService {
  public constructor(
    private readonly config: Pick<
      AppConfig,
      'GITHUB_TOKEN' | 'GITHUB_REPO' | 'GITHUB_DEFAULT_BRANCH'
    >,
    private readonly executor: CommandExecutor,
    private readonly logger: Logger,
  ) {}

  public get isConfigured(): boolean {
    return Boolean(this.config.GITHUB_TOKEN && this.config.GITHUB_REPO);
  }

  private assertConfigured(): void {
    if (!this.isConfigured) {
      throw new Error('GitHub is not configured (set GITHUB_TOKEN and GITHUB_REPO)');
    }
  }

  public async createBranch(branch: string): Promise<void> {
    this.assertConfigured();
    const top = await this.executor.run('git', ['rev-parse', '--show-toplevel']);
    if (top.exitCode !== 0 || path.resolve(top.stdout.trim()) !== this.executor.workdir) {
      await this.executor.runChecked('git', [
        'clone',
        `https://github.com/${this.config.GITHUB_REPO as string}.git`,
        '.',
      ]);
    }
    await this.executor.runChecked('git', ['config', 'user.name', 'Maple']);
    await this.executor.runChecked('git', ['config', 'user.email', 'maple@localhost']);
    const status = await this.executor.runChecked('git', ['status', '--porcelain']);
    if (status.stdout.trim()) {
      throw new Error('agent worktree has uncommitted changes from an earlier run');
    }
    await this.executor.runChecked('git', ['checkout', this.config.GITHUB_DEFAULT_BRANCH]);
    await this.executor.runChecked('git', ['pull', '--ff-only']);
    const existing = await this.executor.run('git', ['branch', '--list', branch]);
    if (existing.stdout.trim()) {
      await this.executor.runChecked('git', ['branch', '-D', branch]);
    }
    await this.executor.runChecked('git', ['checkout', '-b', branch]);
  }

  public async commitAll(message: string): Promise<void> {
    this.assertConfigured();
    await this.executor.runChecked('git', ['add', '-A']);
    await this.executor.runChecked('git', ['commit', '-m', message]);
  }

  public async push(branch: string): Promise<void> {
    this.assertConfigured();
    const token = this.config.GITHUB_TOKEN as string;
    const repo = this.config.GITHUB_REPO as string;
    const tokenFile = '.git/maple-token';
    const askpassFile = '.git/maple-askpass.sh';
    this.executor.writeFile(tokenFile, token, 0o600);
    this.executor.writeFile(
      askpassFile,
      '#!/bin/sh\ncase "$1" in *Username*) printf %s x-access-token ;; *) cat "$PWD/.git/maple-token" ;; esac\n',
      0o700,
    );
    try {
      await this.executor.runChecked(
        'git',
        [
          '-c',
          'core.hooksPath=/dev/null',
          'push',
          `https://github.com/${repo}.git`,
          `${branch}:${branch}`,
          '--force-with-lease',
        ],
        { GIT_ASKPASS: path.join(this.executor.workdir, askpassFile) },
      );
    } finally {
      this.executor.removeFile(tokenFile);
      this.executor.removeFile(askpassFile);
    }
  }

  public async openPullRequest(input: OpenPullRequestInput): Promise<PullRequestResult> {
    this.assertConfigured();
    const repo = this.config.GITHUB_REPO as string;
    const response = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.GITHUB_TOKEN as string}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        head: input.branch,
        base: this.config.GITHUB_DEFAULT_BRANCH,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`failed to open PR (${response.status}): ${text.slice(0, 300)}`);
    }

    const data = (await response.json()) as { html_url?: string; number?: number };
    this.logger.info({ url: data.html_url, number: data.number }, 'pull request opened');
    return { url: data.html_url ?? '', number: data.number ?? 0 };
  }

  public async mergePullRequest(number: number): Promise<MergePullRequestResult> {
    this.assertConfigured();
    const repo = this.config.GITHUB_REPO as string;
    const response = await fetch(`https://api.github.com/repos/${repo}/pulls/${number}/merge`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.config.GITHUB_TOKEN as string}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ merge_method: 'squash' }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      merged?: boolean;
      message?: string;
      sha?: string;
    };
    if (!response.ok || !data.merged || !data.sha) {
      throw new Error(
        `failed to merge PR (${response.status}): ${(data.message ?? 'merge rejected').slice(0, 300)}`,
      );
    }
    this.logger.info({ number, sha: data.sha }, 'pull request merged');
    return { sha: data.sha };
  }
}
