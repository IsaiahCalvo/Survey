import { readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { TIMING_SENSITIVE_TEST_FILES } from './timing-sensitive-tests.mjs';

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

// These suites contain real wall-clock performance budgets or multi-second
// transport timing assertions. Run them alone after the main suite. The list
// lives in its own module so the CI performance job can import exactly the
// same paths (see scripts/timing-sensitive-tests.mjs).
const isolatedTestFiles = TIMING_SENSITIVE_TEST_FILES
  .filter((file) => testFiles.includes(file));
const isolatedSet = new Set(isolatedTestFiles);
const mainTestFiles = testFiles.filter((file) => !isolatedSet.has(file));

// ---------------------------------------------------------------------------
// CLI
//
//   (no arguments)             main pass, then the isolated timing pass — the
//                              historical behaviour, unchanged.
//   --shard=N/M                run only bin N (1-based) of an M-way split of
//                              the MAIN pass. Timing-sensitive files are never
//                              in a shard.
//   --only-timing-sensitive    run only the timing-sensitive files, alone and
//                              sequentially (the CI performance job).
//   --list                     print the selected files, one per line, and
//                              exit without running anything. Used to prove
//                              the shards partition the suite.
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const options = { shard: null, onlyTimingSensitive: false, list: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    let value = null;

    if (arg === '--only-timing-sensitive') {
      options.onlyTimingSensitive = true;
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

  if (options.shard && options.onlyTimingSensitive) {
    console.error('--shard and --only-timing-sensitive are mutually exclusive.');
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
  ['tests/partialEraserSequentialStress.test.mjs', 58.8],
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
  selectionLabel = `timing-sensitive suites only (${selectedIsolatedFiles.length} files)`;
}

if (options.list) {
  for (const file of [...selectedMainFiles, ...selectedIsolatedFiles]) {
    console.log(file);
  }
  process.exit(0);
}

if (selectedMainFiles.length === 0 && selectedIsolatedFiles.length === 0) {
  console.error(`No test files selected for ${selectionLabel}.`);
  process.exit(1);
}

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
process.exit(exitCode);
