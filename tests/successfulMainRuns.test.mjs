import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { successfulMainRunShas } from '../scripts/successful-main-runs.mjs';

test('release selection accepts only finished successful main builds, without the stale success API filter', () => {
  const good = { head_sha: 'a'.repeat(40), head_branch: 'main', status: 'completed', conclusion: 'success' };
  assert.deepEqual(successfulMainRunShas({ workflow_runs: [
    { ...good, head_sha: 'b'.repeat(40), conclusion: 'failure' },
    { ...good, head_sha: 'c'.repeat(40), status: 'in_progress', conclusion: null },
    { ...good, head_sha: 'd'.repeat(40), head_branch: 'feature' },
    { ...good, head_sha: 'e'.repeat(40), conclusion: 'cancelled' },
    { ...good, head_sha: 'not-a-commit' }, good, good,
  ] }), [good.head_sha]);
  assert.throws(() => successfulMainRunShas({}), /Missing/);
  assert.deepEqual(successfulMainRunShas({ workflow_runs: [] }), []);
});

test('release selection reads the real CLI stdin and fails closed on bad input', () => {
  const script = fileURLToPath(new URL('../scripts/successful-main-runs.mjs', import.meta.url));
  const run = { head_sha: 'a'.repeat(40), head_branch: 'main', status: 'completed', conclusion: 'success' };
  const result = spawnSync(process.execPath, [script], { input: JSON.stringify({ workflow_runs: [run] }), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, run.head_sha);
  const bad = spawnSync(process.execPath, [script], { input: '{}', encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, '');
});
