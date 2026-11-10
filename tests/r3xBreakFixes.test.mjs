// Fixes for the round 3 break test of the Drawboard PDF Pro gap betas
// (2026-11-10). Behaviour is covered by e2e and the backNavigation /
// pageTurnMarks tests; these pin the small source rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('New document: a name ending .pdf is not saved as .pdf.pdf', () => {
  assert.match(read('home/NewDocumentDialog.jsx'), /uniqueDocumentName\(String\(name\)\.trim\(\)\.replace\(\/\\\.pdf\$\/i, ''\)/);
});

test('a stored metric choice only counts while default-units is on', () => {
  assert.match(read('home/NewDocumentDialog.jsx'), /isFeatureOn\('default-units'\) && readUnits\(\) === 'metric'/);
  assert.match(read('components/MeasureScaleDialog.jsx'), /isFeatureOn\('default-units'\) && readUnits\(\) === 'metric'/);
});

test('Search keeps Match case / Whole word with the query across a remount', () => {
  const src = read('sidebar/SearchTextPanel.jsx');
  assert.match(src, /const lastOptionsByDocument = new Map\(\)/);
  assert.match(src, /lastOptionsByDocument\.set\(resolvedDocumentKey, \{ matchCase, wholeWord \}\)/);
});

test('hiding marks drops the pick and blocks mark-changing keys', () => {
  const src = read('PDFViewer.jsx');
  assert.match(src, /if \(marksHidden\(\)\) clearAnnotationSelectionForContextChange\('marks-hidden'\)/);
  // Only the front viewer swallows the keys (Home and other tabs keep theirs).
  assert.match(src, /if \(undoRedoKeyActiveRef\.current === false \|\| isTypingTarget\(event\.target\)\) return;[\s\S]{0,400}const gesture = selectionGestureRunning\(\);\n      if \(!marksHidden\(\) && !gesture\) return;/);
});

test('Undo, Delete and Duplicate wait while a mark is held mid-drag (R4-C K1)', async () => {
  const src = read('PDFViewer.jsx');
  const at = src.indexOf('const handleUndoRedoKey = (e) => {');
  assert.match(src.slice(at, at + 1200), /e\.preventDefault\(\);[\s\S]{0,300}if \(selectionGestureRunning\(\)\) \{[\s\S]{0,120}return;/);
  const { selectionGestureRunning } = await import('../src/utils/selectModes.js');
  assert.equal(selectionGestureRunning({ querySelector: () => null }), false);
  assert.equal(selectionGestureRunning({ querySelector: (sel) => (sel === '[data-selection-gesture="true"]' ? {} : null) }), true);
  assert.equal(selectionGestureRunning(null), false);
});

test('the Undo buttons step back a polygon point first', () => {
  const src = read('PDFViewer.jsx');
  const at = src.indexOf('const handleUndo = useCallback(() => {');
  assert.match(src.slice(at, at + 400), /if \(stepBackPolyDraftForUndo\(polyDraftOwner\)\) return;/);
});

test('Back closes the mark menu before the document', () => {
  assert.match(read('hooks/useAnnotationContextMenu.jsx'), /useBackLayer\(Boolean\(annotationContextMenu\), closeAnnotationContextMenu\)/);
});

test('a polygon draft only takes and lights its own viewer\'s Undo', async () => {
  const { setPolyDraftUndo, hasPolyDraftUndo, stepBackPolyDraftForUndo } = await import('../src/utils/polyDraft.js');
  const front = {};
  const behind = {};
  let steps = 0;
  const release = setPolyDraftUndo(() => { steps += 1; return true; }, behind);
  assert.equal(hasPolyDraftUndo(front), false);
  assert.equal(stepBackPolyDraftForUndo(front), false);
  assert.equal(steps, 0);
  assert.equal(hasPolyDraftUndo(behind), true);
  assert.equal(stepBackPolyDraftForUndo(behind), true);
  assert.equal(steps, 1);
  release();
  assert.equal(hasPolyDraftUndo(behind), false);
});

test('a draft in a tab behind ignores Enter, Escape and Backspace', () => {
  const src = read('components/SVGAnnotationLayer.jsx');
  assert.match(src, /if \(!draftTabActiveRef\.current\) return;\n\s*if \(!draftOwnsKeyboard\(e\.target\)\) return;/);
});

test('an open polygon draft is counted per viewer until released', async () => {
  const { markPolyDraftOpen, hasOpenPolyDraft } = await import('../src/utils/polyDraft.js');
  const viewer = {};
  const release = markPolyDraftOpen(viewer);
  assert.equal(hasOpenPolyDraft(viewer), true);
  assert.equal(hasOpenPolyDraft({}), false);
  release();
  release();
  assert.equal(hasOpenPolyDraft(viewer), false);
});
