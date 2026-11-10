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
  assert.match(src, /if \(!marksHidden\(\) \|\| undoRedoKeyActiveRef\.current === false \|\| isTypingTarget\(event\.target\)\) return;/);
});

test('the Undo buttons step back a polygon point first', () => {
  const src = read('PDFViewer.jsx');
  const at = src.indexOf('const handleUndo = useCallback(() => {');
  assert.match(src.slice(at, at + 400), /if \(stepBackPolyDraftForUndo\(\)\) return;/);
});

test('Back closes the mark menu before the document', () => {
  assert.match(read('hooks/useAnnotationContextMenu.jsx'), /useBackLayer\(Boolean\(annotationContextMenu\), closeAnnotationContextMenu\)/);
});
