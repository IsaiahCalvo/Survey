/**
 * w63 — Paste and Duplicate select what they create (Figma / Acrobat).
 *
 * Intended UX: after Cmd+V (or right-click Paste) the pasted marks are the
 * whole selection, so the next arrow key or drag moves the copies and never
 * the originals. Duplicate and the mixed-selection ("family") paste already
 * did this; the plain shape paste (one mark, or several shapes) and the
 * callout paste did not. Verified live in headless Chromium on 2026-09-28
 * (arrow key after paste moved only the copy). PDFViewer is too large to
 * mount in a unit test, so this guards the wiring as text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

const bodyOf = (start, endMarker) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `${start} not found`);
  const to = source.indexOf(endMarker, from + start.length);
  assert.ok(to > from, `${endMarker} not found after ${start}`);
  return source.slice(from, to);
};

test('the shape paste selects every pasted mark, in both branches', () => {
  const helper = bodyOf('const selectPastedMarks = useCallback(', '}, []);');
  assert.match(helper, /setSelectedCalloutIds\(new Set\(\)\)/, 'callouts drop out of the selection');
  assert.match(helper, /setPendingSvgSelection\(\{[\s\S]*annotationIndices[\s\S]*surveyMarkerIds:\s*\[\]/);

  const paste = bodyOf('const pasteAnnotationAt = useCallback(', 'pasteAnnotationAtRef.current = pasteAnnotationAt;');
  // Group branch: the indices the clones were pushed at.
  assert.match(paste, /const firstPastedIndex = next\.objects\.length;[\s\S]*?next\.objects\.push\(c\)/);
  assert.match(paste, /selectPastedMarks\(pageNumber, clones\.map\(\(_, offset\) => firstPastedIndex \+ offset\)\)/);
  // Single branch: the one index it was pushed at.
  assert.match(paste, /const pastedIndex = next\.objects\.length;\s*next\.objects\.push\(pasted\)/);
  assert.match(paste, /selectPastedMarks\(pageNumber, \[pastedIndex\]\)/);
  // Selection is set only after the save, never before.
  assert.ok(paste.lastIndexOf('handleSaveAnnotations(') < paste.lastIndexOf('selectPastedMarks('));
});

test('the callout paste selects the new callout and nothing else', () => {
  const paste = bodyOf('const handlePasteCallout = useCallback(', '}, [clipboardCallout');
  assert.match(paste, /setSelectedCalloutIds\(new Set\(\[newId\]\)\)/);
  assert.match(paste, /setPendingSvgSelection\(\{ pageNumber, annotationIndices: \[\], surveyMarkerIds: \[\]/);
});

test('the family paste and Duplicate keep selecting what they created', () => {
  const family = bodyOf('const commitFamilyPaste = useCallback(', 'return true;\n  }, [');
  assert.match(family, /setPendingSvgSelection\(\{[\s\S]*annotationIndices,[\s\S]*surveyMarkerIds:/);
  const dup = bodyOf('const duplicateFamilySelection = useCallback(', '}, [collectFamilySelection, commitFamilyPaste]);');
  assert.match(dup, /commitFamilyPaste\(/);
});
