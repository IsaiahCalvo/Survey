import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { followupPlan, affectedSuites, followupState } from '../scripts/ci-followup-plan.mjs';
import { dailyAttemptDue, WALK_JOB, actionsApi } from '../scripts/ci-daily-attempt.mjs';

const repo = 'owner/repo', head = 'a'.repeat(40), merge = 'b'.repeat(40);
const pr = { number: 12, state: 'open', draft: false, head: { sha: head, repo: { full_name: repo } },
  base: { repo: { full_name: repo } }, merge_commit_sha: merge, changed_files: 1, user: { login: 'owner' } };
const run = { path: '.github/workflows/ci.yml', conclusion: 'success', head_branch: 'feature', head_sha: head,
  event: 'pull_request', head_repository: { full_name: repo } };
function fixture({ current = pr, files = [{ filename: 'src/view.jsx' }], event = { workflow_run: run }, ...overrides } = {}) {
  const calls = [];
  return { calls, options: { repo, sha: 'c'.repeat(40), suite: 'native', eventName: 'workflow_run', event,
    api: async path => {
      calls.push(path);
      if (path.startsWith('commits/')) return [current];
      if (path.includes('/files?')) return files;
      if (path === 'pulls/12') return current;
      throw new Error(`Unexpected API call: ${path}`);
    }, ...overrides } };
}

test('green current PR uses a pinned merge; shared changes run both native platforms and E2E', async () => {
  const { options } = fixture();
  assert.deepEqual(await followupPlan(options), { run: true, ios: true, android: true,
    ref: merge, head, pr: 12, reason: 'Current PR passed core CI' });
  assert.equal((await followupPlan({ ...options, suite: 'e2e' })).run, true);
});
test('failed/cancelled core CI, main builds and fork workflow_run events never allocate costly PR suites', async () => {
  for (const patch of [{ conclusion: 'failure' }, { conclusion: 'cancelled' }, { head_branch: 'main' },
    { head_repository: { full_name: 'fork/repo' } }, { event: 'push' }, { path: '.github/workflows/fake-core.yml' }]) {
    const { options, calls } = fixture({ event: { workflow_run: { ...run, ...patch } } });
    assert.equal((await followupPlan(options)).run, false);
    assert.equal(calls.length, 0);
  }
});
test('closed, stale, draft and cross-repo PRs are skipped after a green CI completion', async () => {
  for (const current of [{ ...pr, state: 'closed' }, { ...pr, head: { ...pr.head, sha: 'd'.repeat(40) } },
    { ...pr, draft: true }, { ...pr, head: { ...pr.head, repo: { full_name: 'fork/repo' } } }]) {
    assert.equal((await followupPlan(fixture({ current }).options)).run, false);
  }
});
test('a PR head that changes between the list and full PR lookup cannot start a suite', async () => {
  const { options } = fixture();
  const original = options.api;
  options.api = path => path === 'pulls/12' ? { ...pr, head: { ...pr.head, sha: 'd'.repeat(40) } } : original(path);
  assert.equal((await followupPlan(options)).run, false);
});
test('fork pull_request tests keep the unprivileged merge ref; same-repo events wait for core CI', async () => {
  const base = fixture({ eventName: 'pull_request', event: { pull_request: pr } }).options;
  assert.equal((await followupPlan(base)).run, false);
  const fork = { ...pr, head: { ...pr.head, repo: { full_name: 'fork/repo' } } };
  const plan = await followupPlan({ ...base, event: { pull_request: fork } });
  assert.equal(plan.run, true);
  assert.equal(plan.ref, base.sha);
  assert.equal((await followupPlan({ ...base, event: { pull_request: { ...fork, draft: true } } })).run, false);
});
test('manual runs retain all suites, including perf runs; Dependabot E2E policy stays intact', async () => {
  assert.equal((await followupPlan(fixture({ eventName: 'workflow_dispatch' }).options)).run, true);
  const options = fixture({ suite: 'e2e', event: { workflow_run: { ...run, triggering_actor: { login: 'dependabot[bot]' } } } }).options;
  assert.equal((await followupPlan(options)).run, false);
});
test('platform-only files avoid the other platform; renames check both paths', () => {
  assert.deepEqual(affectedSuites([{ filename: 'ios/App/App.swift' }]), { ios: true, android: false, e2e: false });
  assert.deepEqual(affectedSuites([{ filename: 'android/app/build.gradle' }]), { ios: false, android: true, e2e: false });
  assert.deepEqual(affectedSuites([{ filename: 'docs/moved.md', previous_filename: 'src/form.jsx' }]),
    { ios: true, android: true, e2e: true });
  assert.deepEqual(affectedSuites([{ filename: 'supabase/migrations/one.sql' }]), { ios: false, android: false, e2e: true });
});
test('incomplete file lists run all suites; API failures and missing merge refs fail visibly', async () => {
  assert.equal((await followupPlan(fixture({ current: { ...pr, changed_files: 4000 }, files: [] }).options)).run, true);
  await assert.rejects(followupPlan(fixture({ api: async () => { throw new Error('API unavailable'); } }).options), /unavailable/);
  await assert.rejects(followupPlan(fixture({ current: { ...pr, merge_commit_sha: null } }).options), /not ready/);
});
test('files are paged before deciding a suite is unaffected', async () => {
  const { options } = fixture({ current: { ...pr, changed_files: 101 } });
  const original = options.api;
  options.api = path => path.includes('/files?')
    ? (path.endsWith('page=1') ? Array.from({ length: 100 }, (_, i) => ({ filename: `docs/${i}.md` })) : [{ filename: 'src/last.jsx' }])
    : original(path);
  assert.equal((await followupPlan(options)).run, true);
});
test('expected skipped, failed, cancelled or missing jobs cannot report green', () => {
  assert.equal(followupState(['success', 'success']), 'success');
  for (const result of ['skipped', 'failure', 'cancelled']) assert.equal(followupState(['success', result]), 'failure');
  assert.equal(followupState([]), 'error');
  assert.equal(followupState([undefined]), 'error');
});

const now = new Date('2026-11-11T12:00:00Z');
function history(jobs, runs = [{ id: 3 }]) {
  return async path => path.includes('/workflows/') ? { workflow_runs: runs } : { jobs };
}
test('one real daily iOS attempt blocks automatic repeats after success, failure or cancellation', async () => {
  for (const conclusion of ['success', 'failure', 'cancelled', null]) {
    const api = history([{ name: WALK_JOB, runner_name: 'Hosted Agent', started_at: '2026-11-11T01:00:00Z', conclusion }]);
    assert.equal(await dailyAttemptDue({ api, now, runId: 4 }), false);
  }
});
test('skipped or never-allocated jobs do not consume the daily walk; manual runs can retry', async () => {
  for (const job of [{ name: WALK_JOB, conclusion: 'skipped', runner_name: 'x', started_at: now.toISOString() },
    { name: WALK_JOB, conclusion: 'cancelled', runner_name: '', started_at: now.toISOString() },
    { name: WALK_JOB, runner_name: 'x', started_at: '2026-11-10T01:00:00Z' }]) {
    assert.equal(await dailyAttemptDue({ api: history([job]), now, runId: 4 }), true);
  }
  assert.equal(await dailyAttemptDue({ manual: true, api: () => { throw new Error('not needed'); } }), true);
});
test('daily history ignores itself, accepts reusable job names, and fails closed on missing history', async () => {
  const jobs = [{ name: `daily-walk / ${WALK_JOB}`, runner_name: 'x', started_at: now.toISOString() }];
  assert.equal(await dailyAttemptDue({ api: history(jobs), now, runId: 3 }), true);
  assert.equal(await dailyAttemptDue({ api: history(jobs), now, runId: 4 }), false);
  await assert.rejects(dailyAttemptDue({ api: async () => ({}), now, runId: 4 }), /history/);
});
test('daily history pages runs and jobs, including runs created before today', async () => {
  let runPages = 0, jobPages = 0;
  const api = async path => {
    if (path.includes('/workflows/')) {
      runPages++;
      assert.match(path, /created=%3E%3D2026-11-09/);
      return { workflow_runs: path.includes('page=1&') ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 101 }] };
    }
    jobPages++;
    if (path.includes('/101/')) return { jobs: path.endsWith('page=1')
      ? Array.from({ length: 100 }, () => ({ name: 'due' }))
      : [{ name: WALK_JOB, started_at: now.toISOString(), runner_name: 'x' }] };
    return { jobs: [] };
  };
  assert.equal(await dailyAttemptDue({ api, now, runId: 999 }), false);
  assert.equal(runPages, 2);
  assert.equal(jobPages, 102);
});
test('API errors cannot silently skip a due check', async () => {
  const api = actionsApi({ repo, token: 'test', fetcher: async () => ({ ok: false, status: 403 }) });
  await assert.rejects(dailyAttemptDue({ api, now, runId: 4 }), /403/);
});
test('workflow wiring preserves the gate, all shards, checks on ready drafts, and the independent daily walk', () => {
  const read = name => readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
  assert.match(read('ci'), /name: Build the app and gate the run/);
  assert.match(read('ci'), /types: \[opened, synchronize, reopened, ready_for_review\]/);
  assert.match(read('e2e-signed-in'), /fromJSON\('\[1, 2, 3, 4, 5, 6\]'\)/);
  assert.match(read('e2e-signed-in'), /INFORMATIONAL ONLY/);
  for (const name of ['ios-native', 'e2e-signed-in']) {
    const source = read(name);
    assert.match(source, /needs: \[plan, start-pr\]/);
    assert.match(source, /ref: \$\{\{ needs.plan.outputs.ref \}\}/);
    assert.match(source, /statuses: write/);
  }
  assert.match(read('ios-signed-in'), /group: daily-ios-signed-in\n  cancel-in-progress: false/);
  assert.match(read('ios-signed-in'), /ios-offline-relaunch.yaml/);
  assert.doesNotMatch(read('ios-signed-in'), /actions\/cache/);
  for (const name of ['deploy-production', 'backend-alerts', 'live-journey-check', 'crash-summary']) {
    assert.match(read(name), /types: \[completed\]\n    branches: \[main\]/);
    assert.match(read(name), /schedule:/);
  }
});
