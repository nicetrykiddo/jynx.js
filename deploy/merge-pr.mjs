const number = Number(process.argv[2]);
const expectedBranch = process.argv[3];
const repo = process.env.GITHUB_REPO;
const token = process.env.GITHUB_TOKEN;
const base = process.env.GITHUB_DEFAULT_BRANCH || 'main';

if (!Number.isInteger(number) || number < 1) throw new Error('invalid pull request number');
if (!/^jynx\/[a-z0-9/-]+$/.test(expectedBranch ?? '')) {
  throw new Error('invalid pull request branch');
}
if (!repo || !token) throw new Error('GitHub deployment credentials are unavailable');

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
  'X-GitHub-Api-Version': '2022-11-28',
};
const detailResponse = await globalThis.fetch(
  `https://api.github.com/repos/${repo}/pulls/${number}`,
  {
    headers,
  },
);
const detail = await detailResponse.json().catch(() => ({}));
if (
  !detailResponse.ok ||
  detail.state !== 'open' ||
  detail.head?.ref !== expectedBranch ||
  detail.base?.ref !== base
) {
  throw new Error(`pull request does not match the verified deployment request`);
}

const mergeResponse = await globalThis.fetch(
  `https://api.github.com/repos/${repo}/pulls/${number}/merge`,
  {
    method: 'PUT',
    headers,
    body: JSON.stringify({ merge_method: 'squash' }),
  },
);
const merge = await mergeResponse.json().catch(() => ({}));
if (!mergeResponse.ok || !merge.merged || !merge.sha) {
  throw new Error(`merge rejected: ${String(merge.message ?? mergeResponse.status).slice(0, 300)}`);
}
process.stdout.write(`merged ${merge.sha}\n`);
import process from 'node:process';
