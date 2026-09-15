// 2026-09-15 — Guard for the claim the CI split rests on:
// "the BLOCKING jobs contain no timing-sensitive test".
//
// ci.yml routes the millisecond-budget suites into the non-blocking `perf`
// lane (CI_PERF_TEST_FILES) and the slow-but-timing-free correctness suites
// into `timing-suites`. Everything else lands in one of the four `test` shards,
// which ARE blocking: a red shard reds the run, and deploy-production.yml gates
// on that run's conclusion.
//
// This test asserts the shards are actually free of wall-clock budgets. It
// fails today: four shard-resident files assert on elapsed time, one of them at
// a 100ms budget — tighter than the 250ms reading (341.6ms on run 34094848036)
// that the whole split was built to stop from vetoing a deploy.
//
// Fix either by moving the offending file into CI_PERF_TEST_FILES /
// TIMING_SENSITIVE_TEST_FILES, or by recording it in ACKNOWLEDGED below with
// the reason it is safe to leave in the blocking path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SHARD_COUNT = 4;

// Built from fragments so this file never matches its own scanner.
const TIMED_VALUE = ['elapsed', 'bestMs', 'durationMs', 'tookMs', 'cpuMs'].join('|');
const WALL_CLOCK_ASSERTION = new RegExp(
  String.raw`assert[.\w]*\([^)]*\b(?:${TIMED_VALUE})\b`,
);

/** Files already known and argued for in scripts/ci-perf-tests.mjs. */
const ACKNOWLEDGED = new Set([
  'tests/geometryHitTest.test.mjs',
  'tests/cloudStrokeBandFuzz.test.mjs',
]);

const SELF = 'tests/ciBlockingPathWallClockBudgets.test.mjs';

function shardFiles(shard) {
  return execFileSync(
    process.execPath,
    ['scripts/run-node-tests.mjs', `--shard=${shard}/${SHARD_COUNT}`, '--list'],
    { encoding: 'utf8' },
  ).split('\n').filter(Boolean);
}

test('no blocking CI test shard asserts on wall-clock time', () => {
  const offenders = [];
  for (let shard = 1; shard <= SHARD_COUNT; shard += 1) {
    for (const file of shardFiles(shard)) {
      if (file === SELF) continue;
      const source = readFileSync(file, 'utf8');
      const match = WALL_CLOCK_ASSERTION.exec(source);
      if (match) offenders.push(`shard ${shard}: ${file} -> ${match[0].trim()}`);
    }
  }

  const unacknowledged = offenders.filter(
    (line) => ![...ACKNOWLEDGED].some((file) => line.includes(file)),
  );

  assert.deepEqual(
    unacknowledged,
    [],
    'These blocking shard files assert on elapsed wall-clock time. A loaded '
    + 'hosted runner can red them, which reds the run, which stops the '
    + 'production deploy — the exact failure the perf lane was built to remove:'
    + `\n  ${unacknowledged.join('\n  ')}`,
  );
});
