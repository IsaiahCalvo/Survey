// 2026-09-15 — Adversarial verification of tests/ciBlockingPathWallClockBudgets.test.mjs.
//
// THE PROMISE UNDER TEST. The CI split rests on one property: no BLOCKING test
// shard asserts on wall-clock time, so a loaded hosted runner cannot red a
// shard, red the run, and stop the production deploy. ci.yml, ci-perf-tests.mjs
// and the guard's own header all say the guard is what keeps that property true
// ("tests/ciBlockingPathWallClockBudgets.test.mjs guards the boundary").
//
// THE DEFECT. The guard detects a wall-clock assertion by matching the source
// text of every shard file against
//
//     assert[.\w]*\([^)]*\b(?:elapsed|bestMs|durationMs|tookMs|cpuMs)\b
//
// That is a five-name allowlist reverse-engineered from the files that happen to
// exist today, not a description of the property. It sees `elapsed` and misses
// every other ordinary spelling of the same assertion — `elapsedMs` (the word
// boundary after "elapsed" fails on the "M"), `ms`, `took`, `duration`,
// `latencyMs` — and, because `[^)]*` cannot cross a closing parenthesis, it also
// misses both inline forms, `assert.ok(Date.now() - t0 < 500)` and
// `assert.ok(performance.now() - t0 < 500)`.
//
// So a new millisecond budget lands in a blocking shard and the guard stays
// green. Verified by hand on this branch: a file containing
// `assert.ok(elapsedMs < 50, ...)` was written to tests/, confirmed to land in
// blocking shard 1, and the guard still reported "✔ no blocking CI test shard
// asserts on wall-clock time".
//
// The test below reproduces that end to end rather than restating the regex:
// it writes one probe file containing an ordinary elapsed-time budget, runs the
// guard, and requires the guard to go red. It fails today.
//
// RESOLVED 2026-09-15 (same day, second pass). The guard's detector was
// rewritten as the property rather than the name list: it now looks for a clock
// call (Date.now, performance.now, process.hrtime, process.cpuUsage,
// performance.mark/measure) reaching an assert/expect value argument, either
// inline or through a light data-flow pass that separates INSTANTS (fixture
// timestamps, cache-busting ids) from DURATIONS (one instant minus another).
// It also scans the isolated-suite selection now, not just the shards, so the
// parenthetical below is fixed too. This test passes; nothing in it was
// weakened to get there.
//
// (Related, not asserted here: the guard scans only the four `test` shards. The
// `timing-suites` job is BLOCKING too, and a wall-clock budget added to
// tests/annotationDocConcurrency.test.mjs or tests/svgPathTransformFidelity.test.mjs
// is likewise invisible to it.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = 'tests/ciBlockingPathWallClockBudgets.test.mjs';
const PROBE = 'tests/wallClockGuardDetectorProbe.generated.test.mjs';

// A wall-clock budget written the way somebody would naturally write one. The
// budget is an hour so the probe can never fail on its own if it is ever run;
// what matters is only that the source contains the assertion.
const PROBE_SOURCE = `import test from 'node:test';
import assert from 'node:assert/strict';

test('generated probe: an ordinary elapsed-time budget in a blocking shard', () => {
  const startedAt = Date.now();
  let total = 0;
  for (let index = 0; index < 1e5; index += 1) total += index;
  const elapsedMs = Date.now() - startedAt;
  assert.ok(elapsedMs < 3_600_000, \`took \${elapsedMs}ms (total \${total})\`);
});
`;

/**
 * How many shards ci.yml actually runs. Hard-coding four here would make this
 * test lie the day the matrix is re-balanced: it would ask for shards that do
 * not exist, the probe would look homeless, and the assertion would fail for a
 * reason that has nothing to do with the detector. Read the matrix instead.
 */
function shardCountFromWorkflow() {
  const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  const matrix = /^\s*shard:\s*\[([^\]]*)\]/m.exec(ci);
  assert.ok(matrix, 'ci.yml no longer declares a `shard:` matrix for the test job');
  const shards = matrix[1].split(',').map((entry) => entry.trim()).filter(Boolean);
  assert.ok(shards.length > 0, 'ci.yml declares an empty `shard:` matrix');
  return shards.length;
}

function runFromRoot(args) {
  // NODE_TEST_CONTEXT is set by the node:test runner for the processes it
  // spawns. Inheriting it here would put the child's reporter into the parent's
  // protocol and swallow its output, so strip it and run the child as an
  // ordinary standalone test run.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env });
}

test('the blocking-shard wall-clock guard catches an ordinary elapsed-time budget', (t) => {
  const probePath = join(root, PROBE);
  assert.ok(!existsSync(probePath), `${PROBE} is left over from an earlier run`);
  writeFileSync(probePath, PROBE_SOURCE);
  t.after(() => rmSync(probePath, { force: true }));

  // The probe must actually be in a blocking shard, or the guard is right to
  // stay green and this test would be measuring nothing.
  const shardCount = shardCountFromWorkflow();
  const shards = Array.from({ length: shardCount }, (_, index) => runFromRoot([
    'scripts/run-node-tests.mjs', `--shard=${index + 1}/${shardCount}`, '--list',
  ]).stdout.split('\n').filter(Boolean));
  const home = shards.findIndex((files) => files.includes(relative(root, probePath)));
  assert.notEqual(home, -1, 'the probe did not land in any blocking shard');

  const guard = runFromRoot(['--test', GUARD]);
  assert.notEqual(
    guard.status,
    0,
    'A blocking CI test shard now contains `assert.ok(elapsedMs < ...)` — a real '
    + 'wall-clock budget on a loaded hosted runner — and the guard reported no '
    + 'offenders. Its detector only recognises the literal names elapsed, bestMs, '
    + 'durationMs, tookMs and cpuMs, so every other spelling of the same assertion '
    + '(elapsedMs, ms, took, duration, latencyMs, or an inline Date.now() / '
    + 'performance.now() difference) reaches a blocking shard unguarded.\n'
    + `guard output:\n${guard.stdout}${guard.stderr}`,
  );
});
