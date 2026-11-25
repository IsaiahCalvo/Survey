// #1658: delete every mark, reload, and the marks came back. The viewer's
// display copy (cloud render cache) was never cleared at zero marks, and a
// touch before that copy was painted made the opening-edits merge count every
// painted mark as one the user added, so it was written back to the store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeOpeningMarkEdits } from '../src/utils/openingEditsMerge.js';

const VIEWER = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const HOOK = readFileSync(new URL('../src/hooks/useAnnotationDoc.js', import.meta.url), 'utf8');

const mark = (id) => ({ type: 'rect', data: { id }, left: 1, top: 1 });
const count = (byPage) => Object.values(byPage || {}).reduce((n, page) => n + (page?.objects?.length || 0), 0);

test('painted marks are not user adds once the baseline moves to the paint', () => {
  const painted = { 1: { objects: [mark('a'), mark('b')] } };
  const storeNow = {}; // every mark was deleted last session
  // Old behaviour: baseline taken on the empty screen, paint looks like adds.
  assert.equal(count(mergeOpeningMarkEdits({ next: storeNow, baseline: {}, current: painted })), 2);
  // With the baseline moved to the paint, nothing comes back.
  assert.equal(count(mergeOpeningMarkEdits({ next: storeNow, baseline: painted, current: painted })), 0);
  // A mark the user really drew after the paint still survives.
  const drawn = { 1: { objects: [mark('a'), mark('b'), mark('c')] } };
  const kept = mergeOpeningMarkEdits({ next: storeNow, baseline: painted, current: drawn });
  assert.deepEqual(kept[1].objects.map((o) => o.data.id), ['c']);
});

test('the viewer moves the opening baseline when it paints its display copy', () => {
  assert.match(HOOK, /const rebaseOpeningEdits = useCallback\(\(forDocumentId, byPage\) =>/);
  assert.match(HOOK, /current\.documentId !== forDocumentId \|\| current\.done \|\| !current\.byPage\) return;/);
  assert.match(HOOK, /\n\s+rebaseOpeningEdits,\n\s+\};\n\}/);
  assert.match(VIEWER, /rebaseOpeningEdits: rebaseAnnotationOpeningEdits,/);
  assert.match(VIEWER, /setAnnotationsByPage\(initialAnnotationsByPage\);\n[^\n]*\n[^\n]*\n\s+if \(isCloudBackedDoc\) rebaseAnnotationOpeningEdits\?\.\(pdfFile\?\.id, initialAnnotationsByPage\);/);
});

test('the display copy is cleared when every mark is deleted after the store opened', () => {
  const at = VIEWER.indexOf('saveCloudRenderAnnotationsByPage(\n');
  const effect = VIEWER.slice(VIEWER.lastIndexOf('useEffect(() => {', at), at);
  assert.doesNotMatch(effect, /=== 0\) return;/, 'no unconditional skip at zero marks');
  assert.match(effect, /normalAnnotationHydration\?\.ready === true && normalAnnotationHydration\?\.documentId === pdfFile\.id/);
});
