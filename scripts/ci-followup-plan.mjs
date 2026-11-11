// Start costly PR suites only after core CI passed on the current head.
// Forks keep their unprivileged pull_request runs; never build fork code in
// workflow_run, whose token/cache context belongs to the default branch.
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { actionsApi } from './ci-daily-attempt.mjs';

const sharedNative = ['src/', 'public/', '.github/native-flows/'];
const nativeFiles = new Set(['capacitor.config.ts', 'index.html', 'vite.config.js', 'package.json', 'package-lock.json',
  '.github/workflows/ios-native.yml', 'scripts/ci-followup-plan.mjs', 'scripts/ci-daily-attempt.mjs']);
const e2ePrefixes = ['src/', 'supabase/migrations/', 'tests/e2e-signed-in/', 'tests/e2e-speed/'];
const e2eFiles = new Set(['supabase/config.toml', 'scripts/e2e-local-supabase.mjs', 'scripts/e2e-fake-groq.mjs',
  'playwright.e2e-signed-in.config.mjs', 'playwright.speed.config.mjs', 'scripts/perf/big-doc-seed.mjs',
  'vite.config.js', 'viteEnvConfig.mjs', 'index.html', 'package.json', 'package-lock.json',
  '.github/workflows/e2e-signed-in.yml', 'scripts/ci-followup-plan.mjs', 'scripts/ci-daily-attempt.mjs']);

export function affectedSuites(files, complete = true) {
  if (!complete) return { ios: true, android: true, e2e: true };
  const paths = files.flatMap(file => [file.filename, file.previous_filename].filter(Boolean));
  const shared = paths.some(path => nativeFiles.has(path) || sharedNative.some(prefix => path.startsWith(prefix)));
  return { ios: shared || paths.some(path => path.startsWith('ios/')),
    android: shared || paths.some(path => path.startsWith('android/')),
    e2e: paths.some(path => e2eFiles.has(path) || e2ePrefixes.some(prefix => path.startsWith(prefix))) };
}

export async function followupPlan({ eventName, event, repo, sha, suite, api, actor }) {
  const skip = reason => ({ run: false, ios: false, android: false, reason });
  if (eventName === 'workflow_dispatch') {
    return { run: true, ios: true, android: true, ref: sha, head: sha, pr: '', reason: 'Manual run' };
  }
  let pr;
  if (eventName === 'pull_request') {
    pr = event.pull_request;
    if (pr.head.repo?.full_name === repo) return skip('Wait for core CI on this PR');
    // Original PR path filters select the suite on forks. Keep the default
    // merge checkout, a read-only token and no workflow_run privileges.
    if (pr.draft) return skip('Draft PR');
    if (suite === 'e2e' && actor === 'dependabot[bot]') return skip('Dependabot PR');
    return { run: true, ios: true, android: true, ref: sha, head: pr.head.sha, pr: pr.number, reason: 'Fork PR' };
  }
  const run = event.workflow_run;
  if (eventName !== 'workflow_run' || run?.conclusion !== 'success'
    || run.path !== '.github/workflows/ci.yml'
    || run.head_branch === 'main' || !['pull_request', 'workflow_dispatch'].includes(run.event)
    || run.head_repository?.full_name !== repo) return skip('Not a green same-repo PR build');
  const prs = await api(`commits/${run.head_sha}/pulls?per_page=100`);
  if (!Array.isArray(prs)) throw new Error('Missing pull request list');
  const matches = prs.filter(item => item.state === 'open' && item.head?.sha === run.head_sha
    && item.head.repo?.full_name === repo && item.base.repo?.full_name === repo);
  if (matches.length > 1) throw new Error('More than one open PR for the CI head');
  if (!matches.length) return skip('PR closed, superseded, or from a fork');
  pr = await api(`pulls/${matches[0].number}`);
  if (pr.state !== 'open' || pr.head.sha !== run.head_sha || pr.head.repo?.full_name !== repo
    || pr.base.repo?.full_name !== repo) return skip('PR changed while planning');
  if (pr.draft) return skip('Draft PR');
  if (suite === 'e2e' && (run.triggering_actor?.login || run.actor?.login) === 'dependabot[bot]') return skip('Dependabot PR');
  if (!/^[a-f0-9]{40}$/.test(pr.merge_commit_sha || '')) throw new Error('PR merge commit is not ready');
  const files = [];
  for (let page = 1; page <= 30; page++) {
    const batch = await api(`pulls/${pr.number}/files?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('Missing changed files');
    files.push(...batch);
    if (batch.length < 100) break;
  }
  const affected = affectedSuites(files, Number.isInteger(pr.changed_files) && files.length === pr.changed_files);
  const selected = suite === 'native' ? affected.ios || affected.android : affected.e2e;
  return { run: selected, ios: selected && affected.ios, android: selected && affected.android,
    ref: pr.merge_commit_sha, head: pr.head.sha, pr: pr.number, reason: selected ? 'Current PR passed core CI' : 'Suite unaffected' };
}

export function followupState(results) {
  if (!results.length || results.some(result => !['success', 'failure', 'cancelled', 'skipped'].includes(result))) return 'error';
  // A cancelled job is a superseded run. GitHub statuses are last-write-wins with
  // no run id, so posting failure here can paint the same head red after a newer
  // follow-up has already posted pending or success.
  if (results.some(result => result === 'cancelled')) return null;
  return results.every(result => result === 'success') ? 'success' : 'failure';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const plan = await followupPlan({ eventName: process.env.GITHUB_EVENT_NAME,
    event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
    repo: process.env.GITHUB_REPOSITORY, sha: process.env.GITHUB_SHA, suite: process.env.FOLLOWUP_SUITE,
    actor: process.env.GITHUB_TRIGGERING_ACTOR,
    api: actionsApi({ repo: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN }) });
  for (const [key, value] of Object.entries(plan)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  console.log(plan.reason);
}
