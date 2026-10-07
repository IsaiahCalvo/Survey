import { readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { TIMING_SENSITIVE_TEST_FILES } from './timing-sensitive-tests.mjs';

import { CI_PERF_TEST_FILES } from './ci-perf-tests.mjs';

async function collectTestFiles(root, shouldInclude) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTestFiles(fullPath, shouldInclude));
      continue;
    }
    if (entry.isFile() && shouldInclude(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

const testFiles = (await Promise.all([
  collectTestFiles('tests', (file) => file.endsWith('.test.mjs')),
  collectTestFiles('src', (file) => (
    file.endsWith('.test.mjs') &&
    dirname(file).split(/[\\/]/).includes('__tests__')
  ))
]))
  .flat()
  .map((file) => relative(process.cwd(), file))
  .sort();

if (testFiles.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

// The suites that must never share a machine with other tests. The list lives
// in its own module (scripts/timing-sensitive-tests.mjs) so every CI job can
// import exactly the same paths: the shards exclude precisely this set, so no
// file is ever run twice or silently dropped.
//
// The list splits in two, and the split is what decides blocking vs not:
//
//   * CI_PERF_TEST_FILES (scripts/ci-perf-tests.mjs) — the files that assert
//     real wall-clock or CPU budgets. They run ONLY under `--only-perf`,
//     in the non-blocking performance-budgets step. `npm test` skips them: a
//     timing reading
//     taken on a loaded runner must never be able to veto a merge or a deploy.
//
//   * the rest — annotationDocConcurrency (99 CRDT convergence tests) and
//     svgPathTransformFidelity (no timing assertion at all). Slow correctness
//     gates, not budgets, so they keep their teeth: they stay BLOCKING and run
//     alone, one process at a time, under `--only-timing-sensitive`.
const perfSet = new Set(CI_PERF_TEST_FILES);
const timingSensitiveSet = new Set(TIMING_SENSITIVE_TEST_FILES);

// A perf file dropped out of the timing-sensitive list would fall into a shard
// and carry its wall-clock budget onto a loaded, parallel runner — the exact
// failure both lists exist to prevent. Fail loudly rather than drift.
const perfOutsideTimingList = CI_PERF_TEST_FILES
  .filter((file) => !timingSensitiveSet.has(file));
if (perfOutsideTimingList.length > 0) {
  console.error(
    'CI_PERF_TEST_FILES must be a subset of TIMING_SENSITIVE_TEST_FILES; '
    + `missing from the timing-sensitive list: ${perfOutsideTimingList.join(', ')}`,
  );
  process.exit(1);
}

const blockingIsolatedFiles = TIMING_SENSITIVE_TEST_FILES
  .filter((file) => testFiles.includes(file) && !perfSet.has(file));
const perfTestFiles = TIMING_SENSITIVE_TEST_FILES
  .filter((file) => testFiles.includes(file) && perfSet.has(file));

// 2026-09-15 — SKIP_TIMING_SUITES=1 runs everything EXCEPT the isolated suites
// above. It exists for one caller: CI on a Dependabot dependency-bump PR
// (.github/workflows/ci.yml). Those suites are the slowest and the only ones
// whose result can turn on how busy the shared runner was rather than on
// whether something broke — which is precisely what happened on CI run
// 34094848036 (2026-09-07), where roundStrokeOutlinePerformance failed on both
// attempts at 341.6ms and emailed a failure for a change that was fine. A
// version bump cannot move those readings on its own, so skipping them on bot
// PRs removes false alarms without removing coverage: no assertion is relaxed,
// every human push and pull request still runs them all, and they run again on
// main the moment a bump lands.
//
// Never set this in a local run or a human PR — it is not a "make CI green"
// switch, and leaving these unrun on a change that touches eraser, cloud,
// SVG-path or annotation-doc code would hide a genuine regression.
const skipTimingSuites = process.env.SKIP_TIMING_SUITES === '1';
const isolatedTestFiles = skipTimingSuites ? [] : blockingIsolatedFiles;
// The notice is printed further down, AFTER the `--list` early exit, so
// `--list` output stays one test path per line and nothing else.
const skipNotice = (skipTimingSuites && blockingIsolatedFiles.length > 0)
  ? `[tests] SKIP_TIMING_SUITES=1 — not running ${blockingIsolatedFiles.length} isolated `
    + `suite(s): ${blockingIsolatedFiles.join(', ')}`
  : null;
// Note the main pass excludes the isolated files whether or not SKIP is set:
// skipping them must mean NOT RUN, never "quietly folded into the main pass on
// a shared runner", which is the exact placement the isolation exists to avoid.
const isolatedSet = new Set(blockingIsolatedFiles);
const mainTestFiles = testFiles.filter(
  (file) => !isolatedSet.has(file) && !perfSet.has(file),
);

// ---------------------------------------------------------------------------
// CLI
//
//   (no arguments)             main pass, then the isolated timing pass — the
//                              historical behaviour, unchanged.
//   --shard=N/M                run only bin N (1-based) of an M-way split of
//                              the MAIN pass. Timing-sensitive files are never
//                              in a shard.
//   --only-timing-sensitive    run only the BLOCKING timing-sensitive files,
//                              alone and sequentially (the first step of the
//                              CI `isolated` job). Never includes the
//                              perf-budget files.
//   --only-perf                run only the wall-clock/CPU budget files, alone
//                              and sequentially (the non-blocking
//                              performance-budgets step of that same job).
//                              Unlike every other mode this does NOT stop
//                              at the first failure: the lane is a report, and
//                              a report that stops after the first slow file
//                              hides the other two.
//   --list                     print the selected files, one per line, and
//                              exit without running anything. Used to prove
//                              the shards plus the two isolated jobs partition
//                              the suite exactly.
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const options = {
    shard: null, onlyTimingSensitive: false, onlyPerf: false, list: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    let value = null;

    if (arg === '--only-timing-sensitive') {
      options.onlyTimingSensitive = true;
      continue;
    }
    if (arg === '--only-perf') {
      options.onlyPerf = true;
      continue;
    }
    if (arg === '--list') {
      options.list = true;
      continue;
    }
    if (arg.startsWith('--shard=')) {
      value = arg.slice('--shard='.length);
    } else if (arg === '--shard') {
      value = argv[index + 1];
      index += 1;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }

    const match = /^(\d+)\/(\d+)$/.exec(value ?? '');
    if (!match) {
      console.error(`--shard expects N/M (for example --shard=2/4), got: ${value}`);
      process.exit(1);
    }
    const shardIndex = Number(match[1]);
    const shardCount = Number(match[2]);
    if (shardCount < 1 || shardIndex < 1 || shardIndex > shardCount) {
      console.error(`--shard=${value} is out of range: need 1 <= N <= M and M >= 1.`);
      process.exit(1);
    }
    options.shard = { index: shardIndex, count: shardCount };
  }

  const exclusive = [
    options.shard ? '--shard' : null,
    options.onlyTimingSensitive ? '--only-timing-sensitive' : null,
    options.onlyPerf ? '--only-perf' : null,
  ].filter(Boolean);
  if (exclusive.length > 1) {
    console.error(`${exclusive.join(', ')} are mutually exclusive.`);
    process.exit(1);
  }

  return options;
}

// Measured CI wall seconds (median of three full runs, September 2026),
// including the per-file process spawn. Only used to BALANCE the shards — a
// stale or missing entry costs a little balance, never correctness. Files with
// no entry are assumed to be the sub-second common case: the ~492 unlisted
// files account for 28% of a 389s test step, i.e. ~0.22s each.
const DEFAULT_TEST_FILE_WEIGHT = 0.22;
const MEASURED_TEST_FILE_WEIGHTS = new Map([
  // 2026-10-04: the 58.8s sequential-stress file was split six ways (same
  // seeds, every sixth one per part) so no single file nears the 120s cap.
  ['tests/partialEraserSequentialStressPart1.test.mjs', 9.8],
  ['tests/partialEraserSequentialStressPart2.test.mjs', 9.8],
  ['tests/partialEraserSequentialStressPart3.test.mjs', 9.8],
  ['tests/partialEraserSequentialStressPart4.test.mjs', 9.8],
  ['tests/partialEraserSequentialStressPart5.test.mjs', 9.8],
  ['tests/partialEraserSequentialStressPart6.test.mjs', 9.8],
  ['tests/partialEraserPropertyStress.test.mjs', 40.4],
  ['tests/cloudExportStackSafety.test.mjs', 28.7],
  ['tests/annotationDocSyncDurability.test.mjs', 12.5],
  ['tests/partialEraserFangRegression.test.mjs', 9.3],
  ['tests/cloudStrokeBandFuzz.test.mjs', 7.7],
  ['tests/fabricEraserPreviewHandoffMounted.test.mjs', 7.3],
  ['tests/printDrawerPathStackSafety.test.mjs', 7.1],
  ['tests/annotationDocSyncCatchup.test.mjs', 6.7],
  ['tests/freeTextAppearanceGlyphOverflow.test.mjs', 6.7],
  ['tests/cloudStudioVisualParity.test.mjs', 4.0],
  ['tests/pdfAnnotationImporter.test.mjs', 3.6],
  ['tests/annotationEraseTransaction.test.mjs', 2.6],
  ['tests/revisionCloudGeometryParity.test.mjs', 2.0],
  ['tests/fabricEraserLifecycleMounted.test.mjs', 2.0],
  ['tests/annotationDocWriterTeardown.test.mjs', 2.0],
  ['tests/analyticsQuotaPostgres.test.mjs', 1.6],
]);

function weightOf(file) {
  return MEASURED_TEST_FILE_WEIGHTS.get(file) ?? DEFAULT_TEST_FILE_WEIGHT;
}

// Deterministic longest-processing-time split: heaviest file first, each file
// into the currently lightest bin, ties broken by bin index and then by path.
// Given the same input list it always produces the same partition, every file
// lands in exactly one bin, and no file is dropped.
function shardTestFiles(files, shardCount) {
  const bins = Array.from({ length: shardCount }, () => ({ files: [], load: 0 }));
  const ordered = [...files].sort((a, b) => {
    const delta = weightOf(b) - weightOf(a);
    if (delta !== 0) return delta;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  for (const file of ordered) {
    let lightest = 0;
    for (let index = 1; index < bins.length; index += 1) {
      if (bins[index].load < bins[lightest].load) lightest = index;
    }
    bins[lightest].files.push(file);
    bins[lightest].load += weightOf(file);
  }

  // Restore the suite's normal alphabetical order inside each shard so a shard
  // log reads like a slice of an ordinary run.
  return bins.map((bin) => ({ ...bin, files: bin.files.sort() }));
}

const options = parseArgs(process.argv.slice(2));

let selectedMainFiles = mainTestFiles;
let selectedIsolatedFiles = isolatedTestFiles;
let selectedPerfFiles = [];
// Every mode but the perf lane stops at the first failure: one broken file
// makes the rest of a correctness run meaningless. The perf lane is a report,
// so it runs every budget file and names each one that was over budget.
let stopOnFirstFailure = true;
let selectionLabel = 'full suite';

if (options.shard) {
  const { index, count } = options.shard;
  const bins = shardTestFiles(mainTestFiles, count);
  selectedMainFiles = bins[index - 1].files;
  selectedIsolatedFiles = [];
  selectionLabel = `shard ${index}/${count} (${selectedMainFiles.length} files, `
    + `~${bins[index - 1].load.toFixed(1)}s estimated)`;
} else if (options.onlyTimingSensitive) {
  selectedMainFiles = [];
  // On a Dependabot bump this job has nothing to run. Exit 0 rather than fall
  // through to the "no files selected" error below: an empty-by-design run must
  // not turn the aggregate CI gate red.
  if (skipTimingSuites && !options.list) {
    if (skipNotice) console.log(skipNotice);
    console.log('[tests] SKIP_TIMING_SUITES=1 — nothing to run in this job.');
    process.exit(0);
  }
  selectionLabel = `blocking isolated suites only `
    + `(${selectedIsolatedFiles.length} files)`;
} else if (options.onlyPerf) {
  // A rename or deletion that quietly emptied the perf lane would look green
  // forever. Fail loudly instead.
  const missing = CI_PERF_TEST_FILES.filter((file) => !testFiles.includes(file));
  if (missing.length > 0) {
    console.error(`Missing perf test files: ${missing.join(', ')}`);
    process.exit(1);
  }
  selectedMainFiles = [];
  selectedIsolatedFiles = [];
  selectedPerfFiles = perfTestFiles;
  stopOnFirstFailure = false;
  selectionLabel = `performance budget suites only (${selectedPerfFiles.length} files)`;
}

if (options.list) {
  const listing = [
    ...selectedMainFiles, ...selectedIsolatedFiles, ...selectedPerfFiles,
  ].map((file) => `${file}\n`).join('');
  // Exit only once the listing has been flushed. A bare process.exit() right
  // after console.log can cut a piped listing short when the reader is slow
  // (seen as the wall-clock guard tests' probe file "missing" from its shard).
  process.stdout.write(listing, () => process.exit(0));
  await new Promise(() => {});
}

if (
  selectedMainFiles.length === 0
  && selectedIsolatedFiles.length === 0
  && selectedPerfFiles.length === 0
) {
  console.error(`No test files selected for ${selectionLabel}.`);
  process.exit(1);
}

if (skipNotice) console.log(skipNotice);
console.log(`[tests] selection: ${selectionLabel}`);

function runTestFile(file, label, timeoutMs = 120_000) {
  console.log(`\n[tests] ${label}`);
  return new Promise((resolveExitCode) => {
    // A fresh process per file avoids Node 24's worker-pool wedge. The named
    // timeout turns any future leaked handle or unfinished test into a useful,
    // bounded failure that reports the exact file.
    const child = spawn(process.execPath, ['--test', file], {
      stdio: 'inherit',
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.once('error', (error) => {
      clearTimeout(timer);
      console.error(`${file} failed to start: ${error.message}`);
      resolveExitCode(1);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        console.error(`${file} exceeded its ${timeoutMs}ms file timeout.`);
        resolveExitCode(1);
        return;
      }
      if (signal) {
        console.error(`${file} terminated by ${signal}.`);
        resolveExitCode(1);
        return;
      }
      resolveExitCode(code ?? 1);
    });
  });
}

let exitCode = 0;
for (const file of selectedMainFiles) {
  exitCode = await runTestFile(file, `file: ${file}`);
  if (exitCode !== 0) break;
}
for (const file of selectedIsolatedFiles) {
  if (exitCode !== 0) break;
  exitCode = await runTestFile(file, `isolated timing suite: ${file}`);
}

if (selectedPerfFiles.length > 0) {
  const overBudget = [];
  for (const file of selectedPerfFiles) {
    const code = await runTestFile(file, `perf budget suite: ${file}`);
    if (code !== 0) overBudget.push(file);
    if (code !== 0 && stopOnFirstFailure) break;
  }
  if (overBudget.length > 0) {
    console.error(`\n[perf] over budget: ${overBudget.join(', ')}`);
    exitCode = 1;
  } else {
    console.log(`\n[perf] all ${selectedPerfFiles.length} budget suites passed.`);
  }
}

process.exit(exitCode);
