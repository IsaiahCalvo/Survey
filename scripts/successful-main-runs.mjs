import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function successfulMainRunShas(payload) {
  if (!Array.isArray(payload?.workflow_runs)) throw new Error('Missing workflow run list');
  return [...new Set(payload.workflow_runs
    .filter((run) => run.head_branch === 'main' && run.status === 'completed' && run.conclusion === 'success'
      && /^[0-9a-f]{40}$/.test(run.head_sha))
    .map((run) => run.head_sha))];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(successfulMainRunShas(JSON.parse(readFileSync(0, 'utf8'))).join('\n')); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
