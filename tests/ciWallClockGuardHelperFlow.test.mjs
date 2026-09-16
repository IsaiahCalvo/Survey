// 2026-09-15 — Adversarial verification, round 3, of
// tests/ciBlockingPathWallClockBudgets.test.mjs.
//
// THE PROMISE UNDER TEST. ci.yml's header says the guard "scans every BLOCKING
// selection — all four shards and --only-timing-sensitive — for any assertion
// that reaches a clock, so a new wall-clock budget cannot quietly land in the
// blocking path". The guard's own header goes further and says the detector is
// the PROPERTY rather than a list of names: "a file is timing-asserting when
// BOTH hold: 1. it reads a clock … and 2. an assert…() / expect() call takes,
// as one of its VALUE arguments, an elapsed quantity: a clock difference
// written inline, or an identifier that a light data-flow pass traces back to
// one."
//
// THE DEFECT. The data-flow pass is built out of one regex over `name = …`
// assignments (`bindings()` in the guard). It therefore only ever learns about
// durations that are bound with `=`. The single most ordinary way to write a
// timing helper in this repository — a plain function DECLARATION — has no
// `=` in it, so the helper is never classified, the value it returns is never
// a duration, and the budget asserted on that value is invisible:
//
//     function elapsedSince(startedAt) { return Date.now() - startedAt; }
//     …
//     const budgetMs = elapsedSince(startedAt);
//     assert.ok(budgetMs < 500, 'too slow');       // <- guard stays green
//
// The identical helper written as `const elapsedSince = (startedAt) => …` IS
// caught, which is what makes this a hole in the detector rather than a stated
// limit: the guard's header names exactly one known limit, and it is about a
// budget measured in a SPAWNED CHILD process. This one is in-file, in the plain
// style, and there are 379 `function` declarations across tests/ today.
//
// Four more in-file duration shapes escape the same way and are asserted below
// so a fix is not written narrowly against the helper alone: a duration stored
// on an object property, one destructured out of a returned object, one pushed
// into an array, and one returned by a class method.
//
// This test FAILS today. It passes when the detector classifies durations that
// reach an assertion through any of those shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = 'tests/ciBlockingPathWallClockBudgets.test.mjs';
const PROBE = 'tests/wallClockGuardHelperFlowProbe.generated.test.mjs';

/**
 * Each probe is an ordinary millisecond budget written in a shape the detector
 * claims to cover. The budget is an hour, so a probe that is ever actually run
 * cannot fail on its own; only its SOURCE matters here.
 */
const PROBES = new Map([
  ['a duration returned by a function declaration', `
function elapsedSince(startedAt) {
  return Date.now() - startedAt;
}

test('probe: helper written as a function declaration', () => {
  const startedAt = Date.now();
  let total = 0;
  for (let index = 0; index < 1e4; index += 1) total += index;
  const budgetMs = elapsedSince(startedAt);
  assert.ok(budgetMs < 3_600_000, \`total \${total}\`);
});
`],
  ['a duration held on an object property', `
test('probe: duration stored on an object property', () => {
  const timings = {};
  const startedAt = Date.now();
  let total = 0;
  for (let index = 0; index < 1e4; index += 1) total += index;
  timings.elapsed = Date.now() - startedAt;
  assert.ok(timings.elapsed < 3_600_000, \`total \${total}\`);
});
`],
  ['a duration destructured out of a returned object', `
function measure(work) {
  const startedAt = Date.now();
  const value = work();
  return { value, elapsedMs: Date.now() - startedAt };
}

test('probe: duration destructured from a measuring helper', () => {
  const { value, elapsedMs } = measure(() => 1 + 1);
  assert.ok(elapsedMs < 3_600_000, \`value \${value}\`);
});
`],
  ['a duration pushed into an array of samples', `
test('probe: best-of-N samples in an array', () => {
  const samples = [];
  for (let run = 0; run < 3; run += 1) {
    const startedAt = Date.now();
    let total = 0;
    for (let index = 0; index < 1e4; index += 1) total += index;
    samples.push(Date.now() - startedAt);
  }
  assert.ok(Math.min(...samples) < 3_600_000, 'best sample over budget');
});
`],
  ['a duration returned by a class method', `
class Stopwatch {
  since(startedAt) {
    return Date.now() - startedAt;
  }
}

test('probe: duration from a class method', () => {
  const stopwatch = new Stopwatch();
  const startedAt = Date.now();
  let total = 0;
  for (let index = 0; index < 1e4; index += 1) total += index;
  const spentMs = stopwatch.since(startedAt);
  assert.ok(spentMs < 3_600_000, \`total \${total}\`);
});
`],
]);

const PREAMBLE = `import test from 'node:test';
import assert from 'node:assert/strict';
`;

function runFromRoot(args) {
  // NODE_TEST_CONTEXT is set by the node:test runner for the processes it
  // spawns; inheriting it would fold the child's reporter into this run's
  // protocol and swallow its output.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env });
}

test('the blocking-path wall-clock guard follows a duration through a helper', (t) => {
  const probePath = join(root, PROBE);
  assert.ok(!existsSync(probePath), `${PROBE} is left over from an earlier run`);
  t.after(() => rmSync(probePath, { force: true }));

  const missed = [];
  for (const [label, body] of PROBES) {
    writeFileSync(probePath, PREAMBLE + body);

    // The probe has to be in a blocking selection, or a green guard would be
    // right and this test would be measuring nothing.
    const shards = [1, 2, 3, 4].map((shard) => runFromRoot([
      'scripts/run-node-tests.mjs', `--shard=${shard}/4`, '--list',
    ]).stdout.split('\n').filter(Boolean));
    const home = shards.findIndex((files) => files.includes(relative(root, probePath)));
    assert.notEqual(home, -1, `the "${label}" probe did not land in any blocking shard`);

    const guard = runFromRoot(['--test', GUARD]);
    if (guard.status === 0) missed.push(`${label} (blocking shard ${home + 1}/4)`);
  }
  rmSync(probePath, { force: true });

  assert.deepEqual(
    missed,
    [],
    'A blocking CI job can carry a real millisecond budget past the guard. Each '
    + 'shape below was written into a blocking test shard as an ordinary '
    + '`assert.ok(<elapsed> < budget)` and the guard still reported no offenders. '
    + "The guard's data-flow pass only classifies values bound with `=`, so a "
    + 'duration that reaches the assertion through a function declaration, an '
    + 'object property, a destructuring, an array element or a class method is '
    + 'invisible to it — while the same helper written as `const f = () => …` is '
    + 'caught. These are not the spawned-child limit the guard documents; they '
    + `are in-file and in the plain style:\n  ${missed.join('\n  ')}`,
  );
});
