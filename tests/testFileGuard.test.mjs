// KAL-446 (2026-10-13): the test gate's per-file hang guard
// (scripts/test-file-guard.mjs) bounds hangs by the file's OWN CPU time and
// progress instead of raw wall-clock time, so a busy machine can no longer
// kill a slow-but-working eraser stress file and red a blocking CI shard.
//
// The decision is a pure function of what was observed, so most of this file
// tests it with no clock at all. The last tests run real processes to prove
// the guard still stops the two kinds of hang it exists for — and stops the
// whole process tree, not just the `node --test` wrapper.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CPU_BUDGET_MS,
  HARD_CAP_MS,
  STALL_WINDOW_MS,
  WALL_GRACE_MS,
  decideFileGuard,
  parseCpuTimeMs,
  parseProcStat,
  parsePsTable,
  processTreeCpu,
  runGuardedTestFile,
} from '../scripts/test-file-guard.mjs';

test('ps CPU times parse on Linux and macOS', () => {
  assert.equal(parseCpuTimeMs('00:01:05'), 65_000);
  assert.equal(parseCpuTimeMs('1-02:03:04'), (86_400 + 2 * 3600 + 3 * 60 + 4) * 1000);
  assert.equal(parseCpuTimeMs('1:05.50'), 65_500);
  assert.equal(parseCpuTimeMs('0:00.01'), 10);
  assert.equal(parseCpuTimeMs(''), null);
  assert.equal(parseCpuTimeMs('n/a'), null);
});

test('the CPU total covers the node --test wrapper and every descendant, nothing else', () => {
  const table = [
    '  1     0 Ss   00:10:00',
    ' 50     1 Sl   00:00:01', // the gate's child: `node --test file`
    ' 51    50 Rl   00:00:44', // the test file process, waiting for a core
    ' 52    51 S    00:00:03', // a child the test spawned
    ' 60     1 R    00:30:00', // an unrelated CPU hog
  ].join('\n');
  const tree = processTreeCpu(50, parsePsTable(table));
  assert.deepEqual(tree.pids, [50, 51, 52]);
  assert.equal(tree.cpuMs, 48_000);
  assert.equal(tree.busy, true, 'a runnable test process marks the tree busy');
  assert.equal(
    processTreeCpu(50, parsePsTable(table.replace('Rl  ', 'Sl  '))).busy,
    false,
    'the hog outside the tree does not count',
  );
  assert.equal(processTreeCpu(99, parsePsTable(table)), null, 'an exited root reads as no sample');
});

test('/proc stat lines parse even when the command name has spaces and parentheses', () => {
  const line = '4242 (node (x) y) R 4200 4242 4200 0 -1 4194304 1 0 0 0 1234 56 0 0 20 0 11 0 1 2 3';
  assert.deepEqual(parseProcStat(line, 100), { pid: 4242, ppid: 4200, state: 'R', cpuMs: 12_900 });
  assert.equal(parseProcStat('', 100), null);
});

// A reading every 2.5 s of wall time, with the tree gaining `cpuPerSample`;
// `busy` = some process in the tree was runnable (R) or in disk wait (D).
function samplesUntil(wallMs, cpuPerSample, {
  startCpu = 0, every = 2_500, from = 90_000, busy = cpuPerSample > 0,
} = {}) {
  const samples = [];
  let cpu = startCpu;
  for (let at = from; at <= wallMs; at += every) {
    samples.push({ wallMs: at, cpuMs: cpu, busy });
    cpu += cpuPerSample;
  }
  return samples;
}

test('THE KAL-446 CASE: a starved but working file is never killed for being slow', () => {
  // The property stress sweep needs ~45-60 s of CPU. At load ~60 on 4 cores
  // (measured while building this) it got ~4% of a core and ran for over 15
  // minutes: 0.1 s of CPU per 2.5 s reading.
  const decision = decideFileGuard({
    wallMs: 1_200_000,
    samples: samplesUntil(1_200_000, 100, { startCpu: 15_000 }),
  });
  assert.deepEqual(decision, { kill: false });
});

test('a file starved almost completely is still not a hang while it waits in the run queue', () => {
  // Load ~100 on 4 cores: the file gains under a second of CPU per window,
  // but `ps` keeps seeing it runnable. (Observed for real while building this.)
  assert.deepEqual(decideFileGuard({
    wallMs: 400_000,
    samples: samplesUntil(400_000, 50, { startCpu: 30_000, busy: true }),
  }), { kill: false });
});

test('before its grace period no file is judged at all', () => {
  assert.deepEqual(decideFileGuard({ wallMs: WALL_GRACE_MS - 1, samples: [] }), { kill: false });
  assert.deepEqual(decideFileGuard({ wallMs: WALL_GRACE_MS - 1, samples: null }), { kill: false });
});

test('a runaway loop is killed once it has used its CPU budget', () => {
  const samples = samplesUntil(130_000, 2_500, { startCpu: 90_000 });
  assert.ok(samples.at(-1).cpuMs > CPU_BUDGET_MS);
  const decision = decideFileGuard({ wallMs: 130_000, samples });
  assert.equal(decision.kill, true);
  assert.equal(decision.reason, 'cpu-budget');
});

test('an idle hang (leaked handle, never-resolving await) is still killed at the old 120 s mark', () => {
  const decision = decideFileGuard({
    wallMs: WALL_GRACE_MS + 2_500,
    samples: samplesUntil(WALL_GRACE_MS + 2_500, 0, { startCpu: 4_000 }),
  });
  assert.equal(decision.kill, true);
  assert.equal(decision.reason, 'stalled');
});

test('stall needs a full window of evidence, and a trickle of real work is progress', () => {
  // Only 20 s of readings: no full window yet.
  const short = samplesUntil(WALL_GRACE_MS + 5_000, 0, { from: WALL_GRACE_MS - 15_000 });
  assert.ok(short.at(-1).wallMs - short[0].wallMs < STALL_WINDOW_MS);
  assert.deepEqual(decideFileGuard({ wallMs: WALL_GRACE_MS + 5_000, samples: short }), { kill: false });
  // 0.1 s of CPU per reading = 1.2 s per window: slow, but working, even
  // if it was asleep (waiting on I/O or a child) at every reading.
  assert.deepEqual(decideFileGuard({
    wallMs: 200_000,
    samples: samplesUntil(200_000, 100, { busy: false }),
  }), { kill: false });
});

test('the hard cap and the no-ps fallback still bound every file', () => {
  const capped = decideFileGuard({ wallMs: HARD_CAP_MS, samples: samplesUntil(HARD_CAP_MS, 500) });
  assert.equal(capped.reason, 'hard-cap');
  const fallback = decideFileGuard({ wallMs: WALL_GRACE_MS, samples: null });
  assert.equal(fallback.reason, 'wall-fallback');
});

// --- Real processes, tiny limits -------------------------------------------

const quiet = { stdio: 'ignore', log: () => {}, sampleEveryMs: 100 };

function withProbe(source, run) {
  const dir = mkdtempSync(join(tmpdir(), 'test-file-guard-'));
  const file = join(dir, 'probe.test.mjs');
  const pidFile = join(dir, 'pid');
  writeFileSync(file, `import test from 'node:test';\nimport { writeFileSync } from 'node:fs';\n`
    + `writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n${source}\n`);
  return run(file, pidFile).finally(() => rmSync(dir, { recursive: true, force: true }));
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test('a real busy-loop file is stopped on its CPU budget, test process included', async () => {
  await withProbe(`test('spins', () => { for (;;) {} });`, async (file, pidFile) => {
    const result = await runGuardedTestFile(file, {
      ...quiet,
      wallGraceMs: 1_000,
      cpuBudgetMs: 1_500,
      // Long enough that a starved runner cannot call the loop "stalled".
      stallWindowMs: 600_000,
      hardCapMs: 300_000,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.killed, true);
    assert.equal(result.reason, 'cpu-budget');
    assert.ok(existsSync(pidFile), 'the probe started');
    const testPid = Number(readFileSync(pidFile, 'utf8'));
    // The test file runs in a grandchild of the gate. The old guard killed
    // only the `node --test` wrapper and left this loop spinning.
    let alive = isAlive(testPid);
    for (let tries = 0; alive && tries < 50; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      alive = isAlive(testPid);
    }
    assert.equal(alive, false, 'the spinning test process was killed too');
  });
});

test('a real idle hang is stopped as stalled', async () => {
  await withProbe(`test('never ends', () => new Promise(() => { setInterval(() => {}, 1_000); }));`, async (file) => {
    const result = await runGuardedTestFile(file, {
      ...quiet,
      wallGraceMs: 2_000,
      stallWindowMs: 1_500,
      hardCapMs: 300_000,
    });
    assert.equal(result.killed, true);
    assert.equal(result.reason, 'stalled');
  });
});

test('a passing file passes and a failing file fails, untouched by the guard', async () => {
  await withProbe(`test('fine', () => {});`, async (file) => {
    assert.deepEqual(await runGuardedTestFile(file, quiet), { exitCode: 0, killed: false });
  });
  await withProbe(`test('broken', () => { throw new Error('no'); });`, async (file) => {
    assert.deepEqual(await runGuardedTestFile(file, quiet), { exitCode: 1, killed: false });
  });
});
