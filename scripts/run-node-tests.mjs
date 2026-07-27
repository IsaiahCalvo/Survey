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

// Most of these suites contain real wall-clock performance budgets or
// multi-second transport timing assertions. The SVG transform suite can also
// wedge a Node 24 test worker after the parallel suite completes. Keep the main
// suite parallel, then run these files alone for deterministic CI.
const isolatedTestFiles = [
  'tests/annotationDocConcurrency.test.mjs',
  'tests/partialEraseCurveLocality.test.mjs',
  'tests/partialEraserComplexity.test.mjs',
  'tests/svgPathTransformFidelity.test.mjs',
].filter((file) => testFiles.includes(file));
const isolatedSet = new Set(isolatedTestFiles);
const parallelTestFiles = testFiles.filter((file) => !isolatedSet.has(file));

function runTestBatch(files, label) {
  if (files.length === 0) return Promise.resolve(0);
  console.log(`\n[tests] ${label}`);
  return new Promise((resolveExitCode) => {
    const child = spawn(process.execPath, ['--test', ...files], {
      stdio: 'inherit',
    });
    child.on('exit', (code, signal) => {
      if (signal) {
        console.error(`Test runner terminated by ${signal}.`);
        resolveExitCode(1);
        return;
      }
      resolveExitCode(code ?? 1);
    });
  });
}

let exitCode = await runTestBatch(parallelTestFiles, 'parallel suite');
for (const file of isolatedTestFiles) {
  if (exitCode !== 0) break;
  exitCode = await runTestBatch([file], `isolated timing suite: ${file}`);
}
process.exit(exitCode);
