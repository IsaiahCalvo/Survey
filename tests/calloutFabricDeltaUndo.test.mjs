// tests/calloutFabricDeltaUndo.test.mjs
//
// R2.2 Slice 3 — callout CREATE/EDIT/STYLE commits ride the SHARED save
// pipeline (handleSaveAnnotations), so their undo entries are per-object
// fabric deltas (fabric:create / fabric:update / fabric:delete) built by the
// same diff engine shapes use. These tests exercise that lane exactly the way
// PDFViewer.jsx composes it in commitCalloutMutation:
//
//   commitCalloutMutation(page, mutateList, ctx) ≡
//     nextPage = applyCalloutListToByPage(
//       { [page]: currentPage },
//       mutateList(deriveCalloutsFromByPage({ [page]: currentPage })),
//       pageSizes)[page]
//     → handleSaveAnnotations builds
//       buildAnnotationHistoryAction({ pageNumber, previousPage, nextPage })
//     → Cmd+Z applies invertAnnotationHistoryAction through
//       applyAnnotationHistoryAction (after filterAnnotationHistoryActionByOwner).
//
// Covered:
//   1. create → fabric:create keyed by the callout id; invert removes it and
//      restores the previous page byte-identically.
//   2. update (drag geometry / style patch) → ONE fabric:update; invert
//      restores the previous page byte-identically.
//   3. CRITICAL byte-preservation invariant: a page holding ink + counter +
//      2 callouts, where ONE callout is edited, leaves the other 3 objects
//      byte-identical in the committed page JSON (ink + counter additionally
//      preserved BY REFERENCE).
//   4. filterAnnotationHistoryActionByOwner respects the projected callout
//      group's author fields (data.authorId / data.legacyCallout.meta.authorId).
//   5. restoreHistoryState-shaped legacy compatibility: a synthetic PRE-flip
//      snapshot whose `callouts` field disagrees with its annotationsByPage
//      slice still restores — applyCalloutListToByPage merges the callouts
//      field into byPage exactly as restoreHistoryState does before its single
//      setAnnotationsByPage call.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveCalloutsFromByPage,
  applyCalloutListToByPage,
} from '../src/utils/calloutAnnotationBridge.js';
import {
  buildAnnotationHistoryAction,
  invertAnnotationHistoryAction,
  applyAnnotationHistoryAction,
  filterAnnotationHistoryActionByOwner,
} from '../src/utils/annotationLocalHistory.js';

const PAGE_SIZES = { 1: { width: 612, height: 792 } };
const OWNER = 'user-owner-1';
const FOREIGN = 'user-foreign-2';

function makeCallout(id, overrides = {}) {
  return {
    id,
    pageNumber: 1,
    arrowTip: { x: 0.2, y: 0.3 },
    knee: { x: 0.35, y: 0.35 },
    textBoxPosition: { x: 0.5, y: 0.4 },
    textBoxWidth: 0.2,
    textBoxHeight: 0.08,
    text: `text for ${id}`,
    style: {
      borderColor: '#1e293b',
      lineThickness: 2,
      fontSize: 14,
      fontFamily: 'Arial',
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
    },
    meta: { authorId: OWNER },
    ...overrides,
  };
}

const INK = {
  type: 'path',
  path: [['M', 10, 10], ['L', 50, 60]],
  stroke: '#ff0000',
  strokeWidth: 3,
  fill: null,
  data: { id: 'ink-1', type: 'ink', authorId: OWNER },
};

const COUNTER = {
  type: 'circle',
  left: 100,
  top: 120,
  radius: 12,
  fill: '#2563eb',
  data: { id: 'counter-1', type: 'counter', displayNumber: 1, authorId: OWNER },
};

/** Mirror of commitCalloutMutation's single-page projection. */
function commitMutation(currentPage, mutateList, pageSizes = PAGE_SIZES) {
  const singlePageMap = { 1: currentPage };
  const currentList = deriveCalloutsFromByPage(singlePageMap);
  const rawNextList = mutateList(currentList);
  const nextList = rawNextList
    .filter((c) => c && (!Number.isFinite(Number(c.pageNumber)) || Number(c.pageNumber) === 1))
    .map((c) => (Number(c.pageNumber) === 1 ? c : { ...c, pageNumber: 1 }));
  const nextByPage = applyCalloutListToByPage(singlePageMap, nextList, pageSizes);
  return nextByPage[1] ?? nextByPage['1'];
}

/** Build a steady-state page (ink + counter + the given callouts) the way the
 *  pipeline would have written it: non-callout objects first, callouts
 *  projected by the shared bridge. */
function buildPage(calloutList) {
  const base = { objects: [INK, COUNTER] };
  const byPage = applyCalloutListToByPage({ 1: base }, calloutList, PAGE_SIZES);
  return calloutList.length > 0 ? byPage[1] : base;
}

const json = (v) => JSON.stringify(v);

describe('callout fabric delta undo — create', () => {
  it('projects a create commit into ONE fabric:create keyed by the callout id', () => {
    const prevPage = buildPage([makeCallout('cal-a')]);
    const created = makeCallout('cal-b');
    const nextPage = commitMutation(prevPage, (list) => [...list, created]);

    const action = buildAnnotationHistoryAction({
      pageNumber: 1,
      previousPage: prevPage,
      nextPage,
    });
    assert.ok(action, 'expected a history action for the create');
    assert.equal(action.type, 'fabric:create');
    assert.equal(action.annotationId, 'cal-b');

    // Cmd+Z: invert → fabric:delete → applying restores the previous page.
    const inverse = invertAnnotationHistoryAction(action);
    assert.equal(inverse.type, 'fabric:delete');
    const restored = applyAnnotationHistoryAction({ 1: nextPage }, inverse);
    assert.equal(json(restored['1'] ?? restored[1]), json(prevPage));

    // Cmd+Shift+Z: re-applying the original action returns the committed page.
    const redone = applyAnnotationHistoryAction({ 1: prevPage }, action);
    assert.equal(json(redone['1'] ?? redone[1]), json(nextPage));
  });
});

describe('callout fabric delta undo — update', () => {
  it('geometry drag commit becomes ONE fabric:update; invert restores byte-identically', () => {
    const prevPage = buildPage([makeCallout('cal-a'), makeCallout('cal-b')]);
    const nextPage = commitMutation(prevPage, (list) => list.map((c) => (
      c.id === 'cal-a' ? { ...c, arrowTip: { x: 0.6, y: 0.7 }, knee: { x: 0.55, y: 0.6 } } : c
    )));

    const action = buildAnnotationHistoryAction({
      pageNumber: 1,
      previousPage: prevPage,
      nextPage,
    });
    assert.ok(action, 'expected a history action for the drag');
    assert.equal(action.type, 'fabric:update', 'exactly one updated object expected');
    assert.equal(action.annotationId, 'cal-a');

    const inverse = invertAnnotationHistoryAction(action);
    const restored = applyAnnotationHistoryAction({ 1: nextPage }, inverse);
    assert.equal(json(restored['1'] ?? restored[1]), json(prevPage));
  });

  it('style patch commit (previously NOT undoable) becomes ONE fabric:update', () => {
    const prevPage = buildPage([makeCallout('cal-a')]);
    const nextPage = commitMutation(prevPage, (list) => list.map((c) => (
      c.id === 'cal-a'
        ? { ...c, style: { ...c.style, bold: true, underline: true, borderColor: '#dc2626' } }
        : c
    )));

    const action = buildAnnotationHistoryAction({
      pageNumber: 1,
      previousPage: prevPage,
      nextPage,
    });
    assert.equal(action?.type, 'fabric:update');
    assert.equal(action.annotationId, 'cal-a');

    // SEAM (bc28e2a0): the committed legacyCallout stores the normalized style
    // fields exactly as patched.
    const committedStyle = action.after?.data?.legacyCallout?.style;
    assert.equal(committedStyle.bold, true);
    assert.equal(committedStyle.underline, true);
    assert.equal(committedStyle.borderColor, '#dc2626');

    const restored = applyAnnotationHistoryAction(
      { 1: nextPage },
      invertAnnotationHistoryAction(action)
    );
    assert.equal(json(restored['1'] ?? restored[1]), json(prevPage));
  });
});

describe('CRITICAL invariant — non-target objects byte-preserved', () => {
  it('ink + counter + 2 callouts, edit 1 callout → other 3 objects byte-identical', () => {
    const prevPage = buildPage([makeCallout('cal-a'), makeCallout('cal-b')]);
    const nextPage = commitMutation(prevPage, (list) => list.map((c) => (
      c.id === 'cal-b' ? { ...c, text: 'edited text', textBoxWidth: 0.3 } : c
    )));

    const findById = (page, id) => page.objects.find((o) => (o?.data?.id ?? null) === id);

    // Non-callout objects: preserved BY REFERENCE (strip+re-project copies the
    // page but keeps every non-callout object untouched).
    assert.equal(findById(nextPage, 'ink-1'), findById(prevPage, 'ink-1'));
    assert.equal(findById(nextPage, 'counter-1'), findById(prevPage, 'counter-1'));

    // The untouched callout: byte-identical after deterministic re-projection.
    assert.equal(json(findById(nextPage, 'cal-a')), json(findById(prevPage, 'cal-a')));

    // Only the edited callout differs — the diff engine sees exactly one update.
    const action = buildAnnotationHistoryAction({
      pageNumber: 1,
      previousPage: prevPage,
      nextPage,
    });
    assert.equal(action?.type, 'fabric:update');
    assert.equal(action.annotationId, 'cal-b');

    // Object count and order unchanged (edit is in-place, no reshuffle).
    assert.equal(nextPage.objects.length, prevPage.objects.length);
    assert.deepEqual(
      nextPage.objects.map((o) => o?.data?.id ?? null),
      prevPage.objects.map((o) => o?.data?.id ?? null)
    );
  });
});

describe('filterAnnotationHistoryActionByOwner — projected callout author fields', () => {
  // RULED 2026-09-28 owner: open editing + lock — a step is the recorder's
  // own action, whoever drew the callout, so it is never scoped out by author.
  it('the recorder keeps their callout delta, whoever authored the callout', () => {
    const prevPage = buildPage([makeCallout('cal-a')]);
    const nextPage = commitMutation(prevPage, (list) => list.map((c) => (
      c.id === 'cal-a' ? { ...c, text: 'moved' } : c
    )));
    const action = buildAnnotationHistoryAction({
      pageNumber: 1,
      previousPage: prevPage,
      nextPage,
    });
    assert.equal(action?.type, 'fabric:update');

    // The projected group carries the author at data.authorId (mirrored from
    // legacyCallout.meta.authorId by calloutToAnnotationObject).
    assert.equal(action.after?.data?.authorId, OWNER);
    assert.equal(action.after?.data?.legacyCallout?.meta?.authorId, OWNER);

    assert.equal(filterAnnotationHistoryActionByOwner(action, OWNER), action);
    // RULED 2026-09-28 owner: open editing + lock — another editor's edit of
    // this callout is their Undo step too; only an unknown viewer gets none.
    assert.equal(filterAnnotationHistoryActionByOwner(action, FOREIGN), action);
    assert.equal(filterAnnotationHistoryActionByOwner(action, null), null);
  });

  // RULED 2026-09-28 owner: open editing + lock — a batch is kept whole.
  it('batch actions keep every callout entry the recorder changed', () => {
    const foreignCallout = makeCallout('cal-foreign', { meta: { authorId: FOREIGN } });
    const prevPage = buildPage([makeCallout('cal-a'), foreignCallout]);
    const nextPage = commitMutation(prevPage, (list) => list.map((c) => ({
      ...c,
      style: { ...c.style, lineThickness: 4 },
    })));

    const action = buildAnnotationHistoryAction({
      pageNumber: 1,
      previousPage: prevPage,
      nextPage,
    });
    assert.equal(action?.type, 'fabric:batch');

    const scoped = filterAnnotationHistoryActionByOwner(action, OWNER);
    assert.ok(scoped, 'the recorder keeps the batch');
    // RULED 2026-09-28 owner: open editing + lock — both callouts the step changed.
    assert.deepEqual(scoped.updated.map((e) => e.id).sort(), ['cal-a', 'cal-foreign']);

    const scopedForeign = filterAnnotationHistoryActionByOwner(action, FOREIGN);
    assert.ok(scopedForeign, 'any recorder keeps the batch');
    // RULED 2026-09-28 owner: open editing + lock — same, for the other editor.
    assert.deepEqual(scopedForeign.updated.map((e) => e.id).sort(), ['cal-a', 'cal-foreign']);
  });
});

describe('legacy snapshot compatibility — restoreHistoryState shape', () => {
  it('a synthetic PRE-flip snapshot (callouts field disagrees with byPage) still restores', () => {
    // Legacy (pre-Slice-2) checkpoints stored callouts as an INDEPENDENT
    // slice: annotationsByPage carries no callout objects at all.
    const legacySnapshot = {
      annotationsByPage: { 1: { objects: [INK, COUNTER] } },
      surveyMarkers: {},
      spaces: [],
      callouts: [makeCallout('cal-legacy')],
    };

    // restoreHistoryState's merge step, verbatim:
    const restoredByPage = applyCalloutListToByPage(
      legacySnapshot.annotationsByPage,
      legacySnapshot.callouts,
      PAGE_SIZES
    );

    const derived = deriveCalloutsFromByPage(restoredByPage);
    assert.equal(derived.length, 1);
    assert.equal(json(derived[0]), json(legacySnapshot.callouts[0]));

    // Non-callout objects survive the merge by reference.
    const objects = (restoredByPage[1] ?? restoredByPage['1']).objects;
    assert.ok(objects.includes(INK));
    assert.ok(objects.includes(COUNTER));
    assert.equal(objects.filter((o) => o?.data?.type === 'callout').length, 1);
  });

  it('a POST-flip snapshot (byPage already embeds the callouts) is a referential no-op merge', () => {
    const page = buildPage([makeCallout('cal-a')]);
    const snapshot = {
      annotationsByPage: { 1: page },
      callouts: deriveCalloutsFromByPage({ 1: page }),
    };
    const restoredByPage = applyCalloutListToByPage(
      snapshot.annotationsByPage,
      snapshot.callouts,
      PAGE_SIZES
    );
    assert.equal(restoredByPage, snapshot.annotationsByPage);
  });
});
