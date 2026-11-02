// Owner 2026-11-02: "As soon as the PDF loads, everything should be available.
// I should be able to annotate, select, pan, and scroll instantaneously."
//
// While a cloud document's store is still opening, the toolbar and the page
// used to be locked (a read-only layer + a see-through cover over page one)
// because the store's load would paint over anything drawn meanwhile. Now the
// document is editable at once and the edits are laid on top of each load
// (openingEditsMerge.js). These tests pin the merge rule, the full open path
// against the real store (edits reach the store; a newer cloud copy of an
// untouched mark still wins), and that nothing locks input while opening.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';

import {
  collectOpeningMarkEdits,
  mergeOpeningKeyedEdits,
  mergeOpeningListEdits,
  mergeOpeningMarkEdits,
} from '../src/utils/openingEditsMerge.js';
import {
  createViewerCaptureState,
  docToByPage,
  recordViewerDelivery,
  syncByPageToDoc,
} from '../src/services/annotationDocStore.js';

const rect = (id, extra = {}) => ({
  type: 'rect',
  left: 10,
  top: 20,
  width: 100,
  height: 50,
  fill: 'transparent',
  stroke: '#ff0000',
  strokeWidth: 2,
  opacity: 1,
  meta: { authorId: 'user-a' },
  data: { id, type: 'shape', authorId: 'user-a' },
  ...extra,
});

const callout = (id, text = 'note', childLeft = 0) => ({
  type: 'group',
  left: childLeft,
  top: 0,
  objects: [{ type: 'line', left: childLeft, data: { calloutPart: 'line1' } }],
  meta: { authorId: 'user-a' },
  data: {
    id,
    type: 'callout',
    authorId: 'user-a',
    legacyCallout: { id, pageNumber: 1, text, arrowTip: { x: 0.1, y: 0.1 } },
  },
});

const ids = (byPage, pageKey) => (byPage[pageKey]?.objects || []).map((object) => object.data.id);
const find = (byPage, id) => Object.values(byPage)
  .flatMap((page) => page?.objects || [])
  .find((object) => object?.data?.id === id);

test('no touch, no merge: the store copy replaces the screen as before', () => {
  const next = { 1: { objects: [rect('a')] } };
  assert.equal(mergeOpeningMarkEdits({ next, baseline: null, current: { 1: { objects: [] } } }), next);
  const screen = { 1: { objects: [rect('a')] } };
  assert.equal(mergeOpeningMarkEdits({ next, baseline: screen, current: screen }), next);
});

test('a mark drawn while opening is kept on top of the loaded marks', () => {
  const baseline = { 1: { objects: [rect('a')] } };
  const current = { 1: { objects: [baseline[1].objects[0], rect('new', { left: 300 })] } };
  const next = { 1: { objects: [rect('a'), rect('b')] }, 2: { objects: [rect('c')] } };
  const merged = mergeOpeningMarkEdits({ next, baseline, current });
  assert.deepEqual(ids(merged, 1), ['a', 'b', 'new']);
  assert.equal(merged[2], next[2], 'untouched pages keep the store copy by reference');
});

test('a moved mark keeps the move; a deleted mark stays deleted; a new page is created', () => {
  const a = rect('a');
  const d = rect('d');
  const baseline = { 1: { objects: [a, d] } };
  const current = {
    1: { objects: [{ ...a, left: 250 }] },
    3: { version: '7', objects: [rect('p3')] },
  };
  const next = { 1: { objects: [rect('a'), rect('d'), rect('b')] } };
  const merged = mergeOpeningMarkEdits({ next, baseline, current });
  assert.deepEqual(ids(merged, 1), ['a', 'b']);
  assert.equal(find(merged, 'a').left, 250);
  assert.deepEqual(ids(merged, 3), ['p3']);
  assert.equal(merged[3].version, '7', 'a new page keeps its page fields');
});

test('a mark moved to another page leaves its old page', () => {
  const a = rect('a');
  const baseline = { 1: { objects: [a] }, 2: { objects: [] } };
  const current = { 1: { objects: [] }, 2: { objects: [a] } };
  const next = { 1: { objects: [rect('a'), rect('b')] } };
  const merged = mergeOpeningMarkEdits({ next, baseline, current });
  assert.deepEqual(ids(merged, 1), ['b']);
  assert.deepEqual(ids(merged, 2), ['a']);
});

test('a re-built but unchanged mark (callout re-projected on measure) is not an edit', () => {
  const baseline = { 1: { objects: [callout('c1', 'note', 0), rect('a')] } };
  // Same saved payload, new drawn children: the viewer did this, not the user.
  const current = { 1: { objects: [callout('c1', 'note', 42), { ...baseline[1].objects[1] }] } };
  assert.equal(collectOpeningMarkEdits(baseline, current), null);
  const next = { 1: { objects: [callout('c1', 'newer text from the cloud'), rect('a', { stroke: '#00ff00' })] } };
  assert.equal(mergeOpeningMarkEdits({ next, baseline, current }), next);
  // A real callout edit (its text) does count.
  const edited = { 1: { objects: [callout('c1', 'typed while opening'), baseline[1].objects[1]] } };
  const merged = mergeOpeningMarkEdits({ next, baseline, current: edited });
  assert.equal(find(merged, 'c1').data.legacyCallout.text, 'typed while opening');
});

test('survey markers and spaces drawn while opening are kept', () => {
  const baselineMarkers = { m1: { pageNumber: 1, bounds: { x: 1 } } };
  const currentMarkers = { ...baselineMarkers, m2: { pageNumber: 1, bounds: { x: 2 } } };
  const storeMarkers = { m1: { pageNumber: 1, bounds: { x: 9 } }, m3: { pageNumber: 2, bounds: { x: 3 } } };
  assert.deepEqual(
    mergeOpeningKeyedEdits({ next: storeMarkers, baseline: baselineMarkers, current: currentMarkers }),
    { m1: { pageNumber: 1, bounds: { x: 9 } }, m3: { pageNumber: 2, bounds: { x: 3 } }, m2: { pageNumber: 1, bounds: { x: 2 } } },
  );
  const deletedOne = mergeOpeningKeyedEdits({ next: storeMarkers, baseline: baselineMarkers, current: {} });
  assert.deepEqual(Object.keys(deletedOne), ['m3']);

  const s1 = { id: 's1', name: 'Lobby' };
  const storeSpaces = [{ id: 's1', name: 'Lobby (renamed elsewhere)' }, { id: 's2', name: 'Roof' }];
  assert.deepEqual(
    mergeOpeningListEdits({ next: storeSpaces, baseline: [s1], current: [s1, { id: 's3', name: 'New' }] }),
    [...storeSpaces, { id: 's3', name: 'New' }],
  );
  assert.equal(mergeOpeningListEdits({ next: storeSpaces, baseline: [s1], current: [s1] }), storeSpaces);
});

test('open path against the real store: opening edits are saved, a newer cloud copy still wins elsewhere', () => {
  // The cloud store: a, b (b recoloured on another screen after this
  // device's saved copy was made) and d.
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [rect('a'), rect('b', { stroke: '#00aa00' }), rect('d')] } });

  // This device's early paint (older copy: b still red), then the user's
  // first touch fixes the baseline.
  const preview = { 1: { objects: [rect('a'), rect('b'), rect('d')] } };
  const baseline = preview;
  // While the store opens: draw c, move a, delete d.
  const [a, b] = preview[1].objects;
  const screen = { 1: { objects: [{ ...a, left: 222 }, b, rect('c', { left: 400 })] } };

  // The store finishes opening and hands its marks to the viewer.
  const viewer = createViewerCaptureState();
  const stored = docToByPage(doc);
  recordViewerDelivery(viewer, stored);
  // useAnnotationDoc first hands the store its own copy (writes nothing), so
  // the capture knows the screen held d and stores its delete.
  const before = Y.encodeStateVector(doc);
  syncByPageToDoc(doc, stored, { viewer });
  assert.equal(Y.encodeStateAsUpdate(doc, before).length <= 2, true, 'priming writes nothing');
  const merged = mergeOpeningMarkEdits({ next: stored, baseline, current: screen });
  // ...which the capture then writes into the store.
  syncByPageToDoc(doc, merged, { viewer });

  const after = docToByPage(doc);
  assert.deepEqual(ids(after, 1).sort(), ['a', 'b', 'c']);
  assert.equal(find(after, 'a').left, 222, 'the move made while opening is saved');
  assert.equal(find(after, 'c').left, 400, 'the mark drawn while opening is saved');
  assert.equal(find(after, 'b').stroke, '#00aa00', 'an untouched mark keeps the newer cloud copy');
  assert.equal(find(after, 'd'), undefined, 'the delete made while opening is saved');
});

test('nothing locks the toolbar or page one while the store opens', () => {
  const hook = readFileSync(new URL('../src/hooks/useAnnotationDoc.js', import.meta.url), 'utf8');
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  // The store-opening read-only layer (dimmed toolbar, drawing keys off) is gone;
  // only a store that cannot open at all still makes the document read-only.
  assert.doesNotMatch(hook, /annotation-store-opening/);
  assert.match(hook, /claimBodyReadOnly\(`annotation-store-unavailable:\$\{documentId\}`\)/);
  // The hydrate lays the user's opening edits on top of the store's marks.
  assert.match(hook, /mergeOpeningMarkEdits\(\{ next: projected, baseline: openingBaseline\.byPage, current: previousByPage \}\)/);
  assert.match(hook, /withOpeningMarks\(projectedByPage, previousByPage\)/);
  assert.match(hook, /if \(openingBaseline\) \{[\s\S]{0,400}handle\.applyByPage\(stripMetaFallbackCallouts\(projectedByPage, metaFallbackIdsRef\.current\)\);/);
  assert.match(hook, /window\.addEventListener\('pointerdown', takeBaseline, true\)/);
  // An erase made while opening waits for the store instead of being dropped.
  assert.match(hook, /if \(!hydratedRef\.current\) await whenStoreOpen\(\);/);
  // No see-through cover or input blocker over the first page.
  assert.doesNotMatch(viewer, /annotationPreviewInputBlocked|data-annotation-preview-input-blocker/);
  assert.doesNotMatch(viewer, /renderAnnotationHydrationPageCover|annotationVisualCoverActive|annotationHydrationGated/);
  assert.doesNotMatch(viewer, /cursor: 'progress'/);
});
