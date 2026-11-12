import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { distributionStore } from './lib/public-distribution.mjs';

// Allowlisted copy only: no issue titles, bodies, links, users or log text.
export function publicIncident(issue) {
  const title = String(issue.title || '');
  const kind = /is down/i.test(title) ? 'outage' : /deploy|smoke/i.test(title) ? 'update' : 'problem';
  return { kind, state: issue.state === 'open' ? 'open' : 'closed', created_at: issue.created_at, closed_at: issue.closed_at || null };
}

export async function publishPublicStatus() {
  const repo = process.env.GH_REPO || process.env.GITHUB_REPOSITORY || 'IsaiahCalvo/Survey';
  if (repo !== 'IsaiahCalvo/Survey') throw new Error('Unexpected source repository');
  const issues = JSON.parse(execFileSync('gh', ['issue', 'list', '--repo', repo, '--label', 'alert', '--state', 'all', '--limit', '1000', '--json', 'title,state,createdAt,closedAt'], { encoding: 'utf8' }));
  // Keep ALL open alerts; a page of closed issues must never hide an outage.
  const normalized = issues.map((issue) => publicIncident({ ...issue, state: issue.state.toLowerCase(), created_at: issue.createdAt, closed_at: issue.closedAt }));
  const items = [...normalized.filter((i) => i.state === 'open'), ...normalized.filter((i) => i.state === 'closed').slice(0, 15)];
  if (issues.length === 1000) throw new Error('Issue list reached its limit; refusing to publish an incomplete status');
  const store = await distributionStore();
  await store.ensureBucket();
  await store.put('status.json', JSON.stringify({ checkedAt: new Date().toISOString(), items }), 'application/json', true);
  console.log(`Published status: ${items.length} public incident records`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishPublicStatus().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
