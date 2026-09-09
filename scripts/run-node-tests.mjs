import { readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { spawn } from 'node:child_process';

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
// transport timing assertions. Run them alone after the main suite.
const isolatedTestFiles = [
  'tests/annotationDocConcurrency.test.mjs',
  'tests/partialEraseCurveLocality.test.mjs',
  'tests/partialEraserComplexity.test.mjs',
  'tests/roundStrokeOutlinePerformance.test.mjs',
  'tests/svgPathTransformFidelity.test.mjs',
].filter((file) => testFiles.includes(file));
const isolatedSet = new Set(isolatedTestFiles);
const mainTestFiles = testFiles.filter((file) => !isolatedSet.has(file));

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
