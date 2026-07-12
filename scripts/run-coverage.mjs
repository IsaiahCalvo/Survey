#!/usr/bin/env node
/**
 * Pure-logic coverage runner for the /loop coverage push.
 * Scope: src/lib, src/utils, src/services, packages/shared/dist
 */
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
    if (entry.isFile() && shouldInclude(fullPath)) files.push(fullPath);
  }
  return files;
}

const testFiles = (await Promise.all([
  collectTestFiles('tests', (file) => file.endsWith('.test.mjs')),
  collectTestFiles('src', (file) => (
    file.endsWith('.test.mjs') &&
    dirname(file).split(/[\\/]/).includes('__tests__')
  )),
]))
  .flat()
  .map((file) => relative(process.cwd(), file))
  .sort();

const args = [
  '--test',
  '--test-concurrency=1',
  '--experimental-test-module-mocks',
  '--experimental-test-coverage',
  '--test-coverage-include=src/lib/**',
  '--test-coverage-include=src/utils/**',
  '--test-coverage-include=src/services/**',
  '--test-coverage-include=packages/shared/dist/**',
  '--test-coverage-exclude=**/__tests__/**',
  '--test-coverage-exclude=**/*.test.*',
  ...testFiles,
];

const child = spawn(process.execPath, args, { stdio: 'inherit' });
child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
