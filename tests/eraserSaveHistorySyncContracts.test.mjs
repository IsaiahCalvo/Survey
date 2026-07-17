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

test('eraser save path publishes precise ids for cloud sync fan-out', () => {
  const app = readFileSync(resolve(ROOT, 'src/viewerShared.js'), 'utf8')
    + '\n' + readFileSync(resolve(ROOT, 'src/PDFViewer.jsx'), 'utf8');

  assert.ok(app.includes("new CustomEvent('annotations:precise-fabric-commit'"), 'expected precise commit event');
  assert.ok(app.includes('deletedIds: eraserDeletedIds'), 'expected deleted id payload');
  assert.ok(app.includes('changedIds: eraserChangedIds'), 'expected changed id payload');
});

// 2026-07-17: two tests pinning the retired useAnnotationCloudSync hook's
// consumption of the precise-commit event (and its pointer-deferral flush)
// were deleted with the hook module — the hook was unmounted, so nothing
// consumed the event through it. The PDFViewer dispatch pinned above is kept:
// whether the event dispatch itself should be retired is a pass-2 decision
// (it requires a PDFViewer.jsx edit).
