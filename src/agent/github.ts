import type { AppConfig } from '../config.js';
import type { Logger } from '../core/logger.js';
import type { CommandExecutor } from './executor.js';

export interface PullRequestResult {
  url: string;
  number: number;
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
    await this.executor.run('git', ['checkout', this.config.GITHUB_DEFAULT_BRANCH]);
    await this.executor.run('git', ['pull', '--ff-only']);
    await this.executor.run('git', ['checkout', '-b', branch]);
  }

  public async commitAll(message: string): Promise<void> {
    this.assertConfigured();
    await this.executor.run('git', ['add', '-A']);
    await this.executor.run('git', ['commit', '-m', message]);
  }

  public async push(branch: string): Promise<void> {
    this.assertConfigured();
    const token = this.config.GITHUB_TOKEN as string;
    const repo = this.config.GITHUB_REPO as string;
    const remote = `https://x-access-token:${token}@github.com/${repo}.git`;
    await this.executor.run('git', ['push', remote, `${branch}:${branch}`, '--force-with-lease']);
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
}
