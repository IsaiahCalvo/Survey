import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('eraser save path short-circuits precise no-op before history and state save', () => {
  const app = readFileSync(resolve(ROOT, 'src/viewerShared.js'), 'utf8')
    + '\n' + readFileSync(resolve(ROOT, 'src/PDFViewer.jsx'), 'utf8');
  const noopIndex = app.indexOf("reason: 'eraser:precise-noop'");
  const recordIndex = app.indexOf('recordAnnotationCommit({', noopIndex);
  const stateIndex = app.indexOf('setAnnotationsByPage(prev => {', noopIndex);

  assert.ok(noopIndex > 0, 'expected eraser precise no-op branch');
  assert.ok(recordIndex > noopIndex, 'expected commit recording after no-op branch');
  assert.ok(stateIndex > noopIndex, 'expected state save after no-op branch');
});

test('eraser save path carries precise ids through the history/save contract', () => {
  const app = readFileSync(resolve(ROOT, 'src/viewerShared.js'), 'utf8')
    + '\n' + readFileSync(resolve(ROOT, 'src/PDFViewer.jsx'), 'utf8');

  assert.ok(app.includes('deletedIds: eraserDeletedIds'), 'expected deleted id payload');
  assert.ok(app.includes('changedIds: eraserChangedIds'), 'expected changed id payload');
});

test('eraser save path prefers durable storage-key selectors from object mutations', () => {
  const app = readFileSync(resolve(ROOT, 'src/PDFViewer.jsx'), 'utf8');

  assert.match(app, /normalizedSaveContext\?\.objectMutations/);
  assert.match(app, /deletedStorageKeys:\s*eraserDeletedStorageKeys/);
  assert.match(app, /changedStorageKeys:\s*eraserChangedStorageKeys/);
  assert.match(app, /createdStorageKeys:\s*eraserCreatedStorageKeys/);
});

// 2026-07-17 (pass 2): the 'annotations:precise-fabric-commit' window event
// dispatch was removed from PDFViewer — its only consumer, the retired
// useAnnotationCloudSync hook, was deleted in pass 1 and a fresh grep found
// zero remaining listeners (src, agent-cli, electron, scripts). The precise
// eraser ids remain pinned above via the local history/save contract.
