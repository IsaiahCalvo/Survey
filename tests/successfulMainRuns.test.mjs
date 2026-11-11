import test from 'node:test';
import assert from 'node:assert/strict';
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
