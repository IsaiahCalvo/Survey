// Actions history, rather than a cache mark: workflow_run caches can be read-only.
// Serial workflow concurrency makes the check-and-start pair safe from two starts.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const WALK_JOB = 'iOS signed-in walk (local Supabase, export to share sheet)';

export async function dailyAttemptDue({ api, now = new Date(), runId, manual = false }) {
  if (manual) return true;
  const day = now.toISOString().slice(0, 10);
  // Include runs created yesterday: a queued job can start on the next day.
  const since = new Date(now.getTime() - 2 * 86400000).toISOString().slice(0, 10);
  let exhausted = false;
  for (let page = 1; page <= 30; page++) {
    const data = await api(`actions/workflows/ios-signed-in.yml/runs?per_page=100&page=${page}&created=%3E%3D${since}`);
    if (!Array.isArray(data.workflow_runs)) throw new Error('Missing workflow history');
    for (const run of data.workflow_runs) {
      if (String(run.id) === String(runId)) continue;
      // filter=all counts a failed earlier attempt even after a rerun.
      for (let jobsPage = 1; jobsPage <= 30; jobsPage++) {
        const jobs = await api(`actions/runs/${run.id}/jobs?filter=all&per_page=100&page=${jobsPage}`);
        if (!Array.isArray(jobs.jobs)) throw new Error('Missing job history');
        if (jobs.jobs.some(job => job.name.endsWith(WALK_JOB) && job.runner_name
          && job.conclusion !== 'skipped' && job.started_at?.slice(0, 10) === day)) return false;
        if (jobs.jobs.length < 100) break;
        if (jobsPage === 30) throw new Error('Job history is incomplete');
      }
    }
    if (data.workflow_runs.length < 100) { exhausted = true; break; }
  }
  if (!exhausted) throw new Error('Workflow history is incomplete');
  return true;
}

export function actionsApi({ repo, token, fetcher = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('Invalid repository');
  return async path => {
    const response = await fetcher(`https://api.github.com/repos/${repo}/${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Actions API returned ${response.status}`);
    return response.json();
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const run = await dailyAttemptDue({ api: actionsApi({ repo: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN }),
    runId: process.env.GITHUB_RUN_ID, manual: process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' });
  appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\n`);
  console.log(run ? 'Start the daily walk' : 'A walk already started today; use a manual run to retry.');
}
