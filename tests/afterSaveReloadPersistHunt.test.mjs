// Genuine hunt of local save/reload, undo, and resize after product
// c22e7910. No unique LIVE leftover proved. Do not invent leftover-18,
// Line /AP, callout Rotation, user-settable callout verticalAlign, or
// a richTextEditor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('local ?testPdf= still mirrors annotationsByPage when file.id is absent', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /if \(pdfFile\?\.id\) return;/);
  assert.match(viewer, /saveAnnotationsByPage\(pdfId, annotationsByPage\);/);
  const shared = read('src/viewerShared.js');
  assert.match(shared, /export const saveAnnotationsByPage/);
  assert.match(shared, /localStorage\.setItem\(key, data\)/);
});

test('selected toolbar patch still merges data and checkpoints', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /source: 'toolbar:selected-edit'/);
  assert.match(viewer, /\.\.\.\(current\.data \|\| \{\}\), \.\.\.patch\.data/);
  assert.match(viewer, /handlePatchSelectedCallout/);
  assert.match(viewer, /source: 'callout:style'/);
});

test('undo still inverts local annotation history; resize still commits scale', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const inverse = invertAnnotationHistoryAction\(localAction\);/);
  assert.match(viewer, /applyLocalAnnotationHistoryAction\(inverse\)/);
  const interaction = read('src/hooks/useSVGInteraction.js');
  assert.match(interaction, /obj\.scaleX = Math\.abs\(newScaleX\);/);
  assert.match(interaction, /source: 'object:modified'/);
  assert.match(interaction, /action: 'scale'/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
