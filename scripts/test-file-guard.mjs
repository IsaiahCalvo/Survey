// The per-file hang guard used by scripts/run-node-tests.mjs.
//
// 2026-10-13 (KAL-446) — WHY THIS IS NOT A PLAIN WALL-CLOCK TIMER ANY MORE.
//
// The gate used to SIGKILL every test file at 120 s of wall-clock time. That
// is a hang guard, but it is also a speed budget in disguise: wall time is the
// file's own work PLUS however long the machine made it wait. The eraser
// property stress sweep (tests/partialEraserPropertyStress.test.mjs) needs
// ~45 s of CPU; on a busy machine it was starved past 120 s of wall time and
// killed with "exceeded its 120000ms file timeout" although nothing was wrong
// with the eraser. In CI that kill reds a blocking shard and holds the
// production deploy. The same limit sits ~8x above the six sequential stress
// parts, the fang regression and eraserLaneReviewFixes, so they lose the same
// coin flip on a busier machine. (The old kill also hit only the
// `node --test` wrapper: the test process itself, a grandchild, kept running
// and loading the machine for every file after it.)
//
// The guard now asks the questions a hang guard is actually about: "has this
// file stopped doing anything?" and "is it burning far more of its OWN CPU
// than any test should?" Host load can stretch wall time without limit, but
// it cannot add CPU time to the file's processes, and it cannot make a working
// process look asleep, so both answers are the same on an idle laptop and on
// a runner at load 100.
//
// The rules, checked only once a file has run for WALL_GRACE_MS (so the
// ~500 sub-second files never pay for a single sample):
//
//   1. CPU budget — the file's process tree has used more than CPU_BUDGET_MS
//      of CPU: a runaway loop, or a file that has outgrown one process and
//      should be split. Killed.
//   2. Stalled — over the last STALL_WINDOW_MS the tree gained less than
//      STALL_MIN_PROGRESS_MS of CPU AND no thread in it was ever seen
//      runnable (R) or in disk wait (D): it is asleep with nothing to do — a
//      leaked handle, a deadlock, an await that never resolves. Killed. An
//      idle hang is therefore still caught at ~120 s, as before. A starved
//      file on a busy machine fails both halves: it still gains some CPU
//      (CPU time is read to 10 ms, not rounded to whole seconds), and its
//      threads sit in the run queue waiting for a core.
//   3. Hard cap — HARD_CAP_MS (60 min) of wall time, a last resort for a
//      process that is neither working nor asleep (stuck on disk for ever),
//      so an unattended local run still ends with a named file. It is set
//      far above anything load can cause on purpose: a 15-minute cap was
//      tried and killed a healthy property-stress run at load ~60 on 4
//      cores. Real hangs are caught by rules 1 and 2; in CI the job's own
//      20-minute timeout comes first.
//
// CPU readings come from /proc on Linux (CI) and from `ps` elsewhere (macOS
// prints CPU time to the hundredth of a second). If neither can be read the
// guard falls back to the old 120 s wall-clock kill rather than guarding
// nothing.
import { spawn, execFile, execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

export const WALL_GRACE_MS = 120_000;
export const CPU_BUDGET_MS = 120_000;
export const STALL_WINDOW_MS = 30_000;
export const STALL_MIN_PROGRESS_MS = 100;
export const HARD_CAP_MS = 3_600_000;
export const SAMPLE_EVERY_MS = 2_500;

/**
 * Parse a `ps -o time=` value into milliseconds. Linux procps prints
 * `[[dd-]hh:]mm:ss`, macOS prints `[hh:]mm:ss.ss`; both are handled.
 */
export function parseCpuTimeMs(text) {
  const value = String(text ?? '').trim();
  if (!value) return null;
  let days = 0;
  let clock = value;
  const dash = value.indexOf('-');
  if (dash >= 0) {
    days = Number(value.slice(0, dash));
    clock = value.slice(dash + 1);
  }
  const parts = clock.split(':').map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part)) || !Number.isFinite(days)) return null;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return Math.round((days * 86_400 + seconds) * 1000);
}

const BUSY_STATE = /^[RD]/;

/** Rows from `ps -A -o pid=,ppid=,stat=,time=`. */
export function parsePsTable(text) {
  const rows = [];
  for (const line of String(text ?? '').split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s*$/.exec(line);
    if (!match) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      cpuMs: parseCpuTimeMs(match[4]) ?? 0,
      busy: BUSY_STATE.test(match[3]),
    });
  }
  return rows;
}

/**
 * One /proc/<pid>/stat line. The command name sits in parentheses and may
 * itself contain spaces or parentheses, so fields are counted from the LAST
 * ')'. Field 3 is the state, 4 the parent pid, 14/15 user/system clock ticks.
 */
export function parseProcStat(text, clockTicksPerSecond = 100) {
  const value = String(text ?? '');
  const close = value.lastIndexOf(')');
  if (close < 0) return null;
  const pid = Number.parseInt(value, 10);
  const fields = value.slice(close + 1).trim().split(/\s+/);
  const ticks = Number(fields[11]) + Number(fields[12]);
  if (!Number.isFinite(pid) || !Number.isFinite(ticks)) return null;
  return {
    pid,
    ppid: Number(fields[1]),
    state: fields[0],
    cpuMs: Math.round((ticks * 1000) / clockTicksPerSecond),
  };
}

/**
 * The root pid plus every live descendant, their CPU times, and whether any
 * of them is busy. `node --test <file>` runs the file in a grandchild process,
 * so the root alone would read almost no CPU at all.
 */
export function processTreeCpu(rootPid, rows) {
  const children = new Map();
  const byPid = new Map();
  for (const row of rows ?? []) {
    byPid.set(row.pid, row);
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(row.pid);
  }
  if (!byPid.has(rootPid)) return null;
  const pids = [];
  const queue = [rootPid];
  const seen = new Set();
  while (queue.length) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    pids.push(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  const treeCpu = new Map(pids.map((pid) => [pid, byPid.get(pid).cpuMs]));
  const cpuMs = [...treeCpu.values()].reduce((total, value) => total + value, 0);
  const busy = pids.some((pid) => byPid.get(pid).busy);
  return { pids, treeCpu, cpuMs, busy };
}

/**
 * The guard's decision, as a pure function of what has been observed, so it
 * can be tested without a clock.
 *
 * @param {object} input
 * @param {number} input.wallMs  wall time since the file started
 * @param {Array<{wallMs:number, cpuMs:number, busy:boolean}>|null} input.samples
 *        readings of the file's process tree, oldest first: total CPU, and
 *        whether any thread in it was runnable or in disk wait; null when
 *        CPU time cannot be read on this machine
 * @returns {{kill:false}|{kill:true, reason:'cpu-budget'|'stalled'|'hard-cap'|'wall-fallback', detail:string}}
 */
export function decideFileGuard({
  wallMs,
  samples,
  wallGraceMs = WALL_GRACE_MS,
  cpuBudgetMs = CPU_BUDGET_MS,
  stallWindowMs = STALL_WINDOW_MS,
  stallMinProgressMs = STALL_MIN_PROGRESS_MS,
  hardCapMs = HARD_CAP_MS,
}) {
  if (wallMs < wallGraceMs) return { kill: false };
  if (wallMs >= hardCapMs) {
    return { kill: true, reason: 'hard-cap', detail: `ran for ${hardCapMs}ms of wall time` };
  }
  if (!samples) {
    return {
      kill: true,
      reason: 'wall-fallback',
      detail: `exceeded its ${wallGraceMs}ms file timeout (CPU time unavailable on this machine)`,
    };
  }
  const latest = samples.at(-1);
  if (!latest) return { kill: false };
  if (latest.cpuMs > cpuBudgetMs) {
    return {
      kill: true,
      reason: 'cpu-budget',
      detail: `used ${latest.cpuMs}ms of CPU, over its ${cpuBudgetMs}ms CPU budget `
        + '(a runaway loop, or a file that should be split)',
    };
  }
  // The newest reading at least a full window old. Without one there is no
  // honest way to call the file stalled yet.
  let windowStart = null;
  for (const sample of samples) {
    if (latest.wallMs - sample.wallMs >= stallWindowMs) windowStart = sample;
  }
  if (!windowStart) return { kill: false };
  const progressMs = latest.cpuMs - windowStart.cpuMs;
  const waitingForCpu = samples.some((sample) => sample.wallMs >= windowStart.wallMs && sample.busy);
  if (!waitingForCpu && progressMs < stallMinProgressMs) {
    return {
      kill: true,
      reason: 'stalled',
      detail: `made no progress (${progressMs}ms of CPU in the last `
        + `${latest.wallMs - windowStart.wallMs}ms, never runnable) after ${wallGraceMs}ms — a hang`,
    };
  }
  return { kill: false };
}

let clockTicks = null;
function clockTicksPerSecond() {
  if (clockTicks === null) {
    try {
      clockTicks = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim()) || 100;
    } catch {
      clockTicks = 100;
    }
  }
  return clockTicks;
}

function readProcStatFile(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

/** Linux: every process from /proc; `busy` checks every thread's state. */
function readProcRows() {
  let entries;
  try { entries = readdirSync('/proc'); } catch { return null; }
  const ticks = clockTicksPerSecond();
  const rows = [];
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    const parsed = parseProcStat(readProcStatFile(`/proc/${name}/stat`), ticks);
    if (!parsed) continue;
    rows.push({
      pid: parsed.pid,
      ppid: parsed.ppid,
      cpuMs: parsed.cpuMs,
      // Resolved per thread only for the processes in the file's tree.
      busy: undefined,
      mainState: parsed.state,
    });
  }
  return rows.length ? rows : null;
}

function procThreadsBusy(pid) {
  let tids;
  try { tids = readdirSync(`/proc/${pid}/task`); } catch { return false; }
  // A JS thread waiting on a starved GC helper sleeps while the helper sits in
  // the run queue, so the main thread's state alone is not enough.
  return tids.some((tid) => {
    const parsed = parseProcStat(readProcStatFile(`/proc/${pid}/task/${tid}/stat`));
    return parsed ? BUSY_STATE.test(parsed.state) : false;
  });
}

function readPsRows() {
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid=,stat=,time='], { maxBuffer: 16 << 20 }, (error, stdout) => {
      const rows = error ? [] : parsePsTable(stdout);
      resolve(rows.length ? rows : null);
    });
  });
}

/** Default process reader: /proc where it exists, `ps` otherwise. */
async function readProcessRows(treeRootPid) {
  const procRows = readProcRows();
  if (!procRows) return readPsRows();
  const tree = processTreeCpu(treeRootPid, procRows.map((row) => ({ ...row, busy: false })));
  const inTree = new Set(tree?.pids ?? []);
  return procRows.map((row) => ({
    pid: row.pid,
    ppid: row.ppid,
    cpuMs: row.cpuMs,
    busy: inTree.has(row.pid) && (BUSY_STATE.test(row.mainState) || procThreadsBusy(row.pid)),
  }));
}

/**
 * Run one test file in a fresh `node --test` process under the guard.
 * Resolves { exitCode, killed, reason, detail }.
 */
export function runGuardedTestFile(file, {
  stdio = 'inherit',
  log = console.error,
  sampleEveryMs = SAMPLE_EVERY_MS,
  readRows = readProcessRows,
  ...limits
} = {}) {
  const wallGraceMs = limits.wallGraceMs ?? WALL_GRACE_MS;
  const stallWindowMs = limits.stallWindowMs ?? STALL_WINDOW_MS;
  return new Promise((resolveResult) => {
    const startedAt = Date.now();
    // A fresh process per file avoids Node 24's worker-pool wedge.
    // NODE_TEST_CONTEXT is dropped so a file run from inside another
    // `node --test` (the guard's own tests) still reports as a top-level run.
    const { NODE_TEST_CONTEXT: _nested, ...env } = process.env;
    const child = spawn(process.execPath, ['--test', file], { stdio, env });
    const samples = [];
    // Last CPU reading of every process ever seen in the tree. A child that
    // exits takes its CPU time out of the process table; keeping its last
    // reading makes the total monotonic, so a test that spawns short-lived
    // children is never mistaken for one that stopped working.
    const seenCpu = new Map();
    let cpuUnavailable = false;
    let lastPids = [];
    let verdict = null;
    let sampling = false;

    const killTree = async () => {
      // Read the tree once more before killing: a kill on the wall-clock limit
      // can come before (or without) any CPU sample, and stopping only the
      // `node --test` wrapper would leave the test process running.
      try {
        const rows = await readRows(child.pid);
        const tree = rows ? processTreeCpu(child.pid, rows) : null;
        if (tree) lastPids = [...new Set([...lastPids, ...tree.pids])];
      } catch { /* kill what we know */ }
      for (const pid of [...lastPids].reverse()) {
        if (pid === child.pid) continue;
        try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
      }
      child.kill('SIGKILL');
    };

    const tick = async () => {
      if (sampling || verdict || child.exitCode !== null || child.signalCode !== null) return;
      sampling = true;
      const wallMs = Date.now() - startedAt;
      // Sample only from one stall window before the grace period ends, so a
      // stall can be judged the moment grace runs out.
      if (!cpuUnavailable && wallMs >= wallGraceMs - stallWindowMs) {
        const rows = await readRows(child.pid);
        const tree = rows ? processTreeCpu(child.pid, rows) : null;
        if (!rows) cpuUnavailable = true;
        if (tree) {
          lastPids = tree.pids;
          for (const [pid, cpuMs] of tree.treeCpu) {
            seenCpu.set(pid, Math.max(cpuMs, seenCpu.get(pid) ?? 0));
          }
          let cpuMs = 0;
          for (const value of seenCpu.values()) cpuMs += value;
          samples.push({ wallMs: Date.now() - startedAt, cpuMs, busy: tree.busy });
        }
      }
      sampling = false;
      if (child.exitCode !== null || child.signalCode !== null) return;
      const decision = decideFileGuard({
        ...limits,
        wallMs: Date.now() - startedAt,
        samples: cpuUnavailable ? null : samples,
      });
      if (decision.kill) {
        verdict = decision;
        await killTree();
      }
    };
    const timer = setInterval(tick, sampleEveryMs);

    child.once('error', (error) => {
      clearInterval(timer);
      log(`${file} failed to start: ${error.message}`);
      resolveResult({ exitCode: 1, killed: false });
    });
    child.once('exit', (code, signal) => {
      clearInterval(timer);
      if (verdict) {
        log(`${file} was stopped by the test gate: it ${verdict.detail}.`);
        resolveResult({ exitCode: 1, killed: true, reason: verdict.reason, detail: verdict.detail });
        return;
      }
      if (signal) {
        log(`${file} terminated by ${signal}.`);
        resolveResult({ exitCode: 1, killed: false });
        return;
      }
      resolveResult({ exitCode: code ?? 1, killed: false });
    });
  });
}
