import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for undo after tool-switch (create/transform with A,
// switch to B, undo restores A's last commit, invents 0 B ink).
// Live proof: debug/scenarios/e2e-undo-across-tool-switch.spec.mjs
// Distinct from E-05 create-A-then-B stack, leftover-18 / X-01,
// tool-switch draft discard, and pointercancel.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('tool-switch does not wipe undo; only document change / page mutation does', () => {
  const viewer = read('src/PDFViewer.jsx');
  const svg = read('src/components/SVGAnnotationLayer.jsx');
  const setActive = viewer.slice(
    viewer.indexOf('const setActiveToolLogged = useCallback'),
    viewer.indexOf('const setActiveToolLogged = useCallback') + 900,
  );
  assert.match(setActive, /setActiveTool\(next\)/);
  assert.doesNotMatch(setActive, /addHistoryCheckpoint|setUndoHistory\(\[\]\)/);

  assert.match(viewer, /wipe undo\/redo history ONLY when the document actually/);
  assert.match(viewer, /if \(!isSamePdfReload\) \{\s*\n\s*setUndoHistory\(\[\]\)/);
  assert.match(viewer, /setUndoHistory\(\[\]\);\s*\n\s*setRedoHistory\(\[\]\);\s*\n\s*undoHistoryRef\.current = \[\];[\s\S]*Page mutations remap annotation addresses/);

  assert.match(svg, /leaving a creation tool mid-drag must commit/);
  assert.match(svg, /if \(inFlight\) \{\s*\n\s*commitShapeCreationRef\.current\?\.\(null\)/);
  const toolSwitchFlush = svg.slice(
    svg.indexOf('leaving a creation tool mid-drag must commit'),
    svg.indexOf('leaving a creation tool mid-drag must commit') + 700,
  );
  assert.doesNotMatch(toolSwitchFlush, /addHistoryCheckpoint/);
});

test('create/transform still checkpoint; new create clears redo', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /source === 'path:created'/);
  assert.match(viewer, /source === 'object:modified'/);
  assert.match(viewer, /addHistoryCheckpoint\('annotations:save'/);
  assert.match(viewer, /setRedoHistory\(\[\]\); \/\/ Clear redo history when new action is performed/);
  assert.match(viewer, /isUndoKeyEvent/);
  assert.match(viewer, /isRedoKeyEvent/);
});

test('live spec covers create\/transform then switch, undo restore, empty redo, 390, file.id', () => {
  const spec = read('debug/scenarios/e2e-undo-across-tool-switch.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /empty-stack chords must hold imported ids/);
  assert.match(spec, /tool-switch must invent 0 pen/);
  assert.match(spec, /tool-switch must keep A/);
  assert.match(spec, /redo after tool-switch must invent 0 pen/);
  assert.match(spec, /Ctrl\+Z after Pen must restore create-time size/);
  assert.match(spec, /undo after tool-switch must invent 0 pen/);
  assert.match(spec, /Ctrl\+Y after tool-switch must restore the transform/);
  assert.match(spec, /390 toolbar Undo after Pen must restore create-time size/);
  assert.match(spec, /390 Ctrl\+Y after tool-switch must restore the transform/);
  assert.match(spec, /hubPreview/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
