import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const TARGET = resolve('src/services/annotationCloudSync.js');

function walkSrcFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walkSrcFiles(full, out);
      continue;
    }
    if (/\.(js|jsx|mjs|ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('P1-55 intended: dual-write flag is false and comments say RETIRED', () => {
  const src = readFileSync(TARGET, 'utf8');
  assert.match(src, /export const DOCUMENT_ANNOTATIONS_DUAL_WRITE_LIVE = false/);
  assert.match(src, /RETIRED/);
});

test('P1-55 break: comments no longer claim a live dual-write era', () => {
  const src = readFileSync(TARGET, 'utf8');
  assert.doesNotMatch(
    src,
    /ALWAYS fires the legacy upsertFabricAnnotation\. v2\.3 clients still in the\s+wild read from this column; the dual-write era keeps them whole\./,
  );
});

test('P1-55 edge: no production importer of the retired helpers', () => {
  const offenders = walkSrcFiles(resolve('src')).filter((file) => {
    if (file === TARGET) return false;
    const text = readFileSync(file, 'utf8');
    return /\bdualWriteFabricCommit\b|\bdualWriteFabricDelete\b/.test(text);
  });
  assert.deepEqual(offenders, [], 'no production file should import the retired dual-write helpers');
});
