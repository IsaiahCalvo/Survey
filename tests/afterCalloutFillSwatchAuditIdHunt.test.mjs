// Genuine hunt of remaining unfixed LIVE audit IDs after selected-callout
// Fill swatch independence (c22e7910). No unique LIVE leftover proved.
// Do not invent Line /AP, callout Rotation, user-settable callout
// verticalAlign, a richTextEditor, or leftover-18.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('P1-21 tool-switch mid-drag still flushes commitShapeCreationRef', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /P1-21: leaving a creation tool mid-drag must commit/);
  assert.match(layer, /commitShapeCreationRef\.current\?\.\(null\)/);
  assert.match(layer, /SHAPE_CREATION_TOOLS\.includes\(activeTool\) \|\| FREEHAND_CREATION_TOOLS\.includes\(activeTool\)/);
  assert.match(layer, /const SHAPE_CREATION_TOOLS = \['rect', 'ellipse', 'line', 'arrow', 'survey-marker'\]/);
});

test('P1-27 circle restyle gates still treat imported circle with ellipse', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /type !== 'rect' && type !== 'ellipse' && type !== 'circle'/);
  assert.match(viewer, /type === 'rect' \|\| type === 'ellipse' \|\| type === 'circle' \|\| type === 'textbox'/);
  assert.match(viewer, /selectedType === 'ellipse' \|\| \(selectedType === 'circle' && selectedAnnot\?\.data\?\.type !== 'counter'\)/);
});

test('P1-32 rotation hold-arrow still reuses one interactionId', () => {
  const field = read('src/components/RotationInputField.jsx');
  assert.match(field, /takeRotationInteractionId/);
  assert.match(field, /rotation-input:\$\{annotationIndex\}:\$\{Date\.now\(\)\}/);
  assert.match(field, /if \(!rotationInteractionIdRef\.current\)/);
});

test('P1-20 Ctrl+Shift+D stays inert until __shapeSpyOn', () => {
  const spy = read('src/utils/shapeBleedDiagnostics.js');
  assert.match(spy, /if \(!spyOn\) return;/);
  assert.match(spy, /e\.key === 'D' \|\| e\.key === 'd'/);
});

test('P1-28 blank existing text still deletes instead of leaving a ghost', () => {
  const commit = read('src/utils/textEditCommit.js');
  assert.match(commit, /export function buildExistingTextCommitJSON/);
  assert.match(commit, /if \(!String\(text \?\? ''\)\.trim\(\)\) return null;/);
});

test('P1-16 survey markers still paint when no module is selected', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /P1-16: when no module is selected/);
  assert.match(viewer, /!selectedModuleId \|\| moduleId === selectedModuleId/);
});

test('P1-25 Ctrl+Shift+V is renderer toggle, not a live create-legacy-arrow leftover', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /Ctrl\+Shift\+V toggles renderer mode/);
  assert.match(viewer, /e\.ctrlKey && e\.shiftKey && e\.key === 'V'/);
  assert.doesNotMatch(viewer, /createLegacyGroupArrow/);
});

test('KB-1 partial eraser still skips non-ink; KB-2 still stamps data.zOrder', () => {
  const policy = read('src/utils/eraserPolicy.js');
  assert.match(policy, /return isPartialEraseEligible\(annotation\) \? 'partial' : 'skip'/);
  const zOrder = read('src/utils/annotationZOrder.js');
  assert.match(zOrder, /ensureData\(obj\)\.zOrder = key/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
