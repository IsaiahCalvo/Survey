import { readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { spawn } from 'node:child_process';

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

// `--only-perf` runs ONLY the wall-clock/CPU budget suites (the non-blocking
// `perf` job in ci.yml). Every other invocation, `npm test` included, skips
// them: a timing reading on a loaded runner must never be able to veto a merge
// or a deploy. See scripts/ci-perf-tests.mjs for the full reasoning and for why
// each file is or is not on that list.
const onlyPerf = process.argv.slice(2).includes('--only-perf');
const perfSet = new Set(CI_PERF_TEST_FILES);
const perfTestFiles = testFiles.filter((file) => perfSet.has(file));

if (onlyPerf) {
  if (perfTestFiles.length !== CI_PERF_TEST_FILES.length) {
    // A rename or deletion that quietly emptied the perf lane would look green
    // forever. Fail loudly instead.
    const missing = CI_PERF_TEST_FILES.filter((file) => !testFiles.includes(file));
    console.error(`Missing perf test files: ${missing.join(', ')}`);
    process.exit(1);
  }
  // No early exit here. The blocking suite stops at the first failure because
  // one broken file makes the rest meaningless; the perf lane is a report, and
  // a report that stops after the first slow file hides the other two.
  const overBudget = [];
  for (const file of perfTestFiles) {
    const code = await runTestFile(file, `perf budget suite: ${file}`);
    if (code !== 0) overBudget.push(file);
  }
  if (overBudget.length === 0) {
    console.log(`\n[perf] all ${perfTestFiles.length} budget suites passed.`);
    process.exit(0);
  }
  console.error(`\n[perf] over budget: ${overBudget.join(', ')}`);
  process.exit(1);
}

// These suites contain multi-second transport timing assertions. Run them
// alone after the main suite. They stay BLOCKING: annotationDocConcurrency is
// 99 CRDT convergence tests and svgPathTransformFidelity has no timing
// assertion at all -- both are correctness gates that happen to be slow, not
// performance budgets. The three files that really did assert wall-clock or CPU
// budgets moved to CI_PERF_TEST_FILES; the perfSet guard below keeps them out
// even if one is ever re-added here by mistake.
const isolatedTestFiles = [
  'tests/annotationDocConcurrency.test.mjs',
  'tests/svgPathTransformFidelity.test.mjs',
].filter((file) => testFiles.includes(file) && !perfSet.has(file));
const isolatedSet = new Set(isolatedTestFiles);
const mainTestFiles = testFiles.filter(
  (file) => !isolatedSet.has(file) && !perfSet.has(file),
);

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
for (const file of mainTestFiles) {
  exitCode = await runTestFile(file, `file: ${file}`);
  if (exitCode !== 0) break;
}
for (const file of isolatedTestFiles) {
  if (exitCode !== 0) break;
  exitCode = await runTestFile(file, `isolated timing suite: ${file}`);
}
process.exit(exitCode);
