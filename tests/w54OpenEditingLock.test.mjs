// w54 — RULED 2026-09-28 owner: open editing + lock.
//
//   1. Anyone who can edit may cut, move, restyle or delete ANY mark (other
//      people's and Survey Markers included) with no pop-up and no block.
//   2. Cutting a Survey Marker picks up its placement only; Paste puts the
//      SAME survey item (same id => same Row ID) back on a page.
//   3. Any mark can be locked / unlocked by its author or the document owner;
//      a locked mark cannot be moved / resized / restyled / cut / deleted /
//      erased by anyone until unlocked, and stays selectable.
//   +  Undo covers the user's own edits on ANYONE's marks (coordinator, from
//      the History audit): with two users, B's edit to A's mark is B's step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  canDelete,
  canModify,
  canModifySurveyMarker,
  canSelect,
  canToggleLock,
  filterEraserCommitIds,
  getMarkLockedBy,
  isUserLocked,
} from '../src/lib/collab/permissionScope.js';
import { buildBulkDeletePlan } from '../src/lib/collab/bulkDeletePlan.js';
import { guardLockedMarksOnSave, withCalloutLock, withMarkLock, withSurveyMarkerLock } from '../src/utils/markLock.js';
import { canMoveAnnotation } from '../src/utils/annotationFamilyRules.js';
import {
  applyAnnotationHistoryAction,
  buildAnnotationHistoryAction,
  filterAnnotationHistoryActionByOwner,
  invertAnnotationHistoryAction,
} from '../src/utils/annotationLocalHistory.js';
import { buildFamilyClipboard, planFamilyPaste } from '../src/utils/familyClipboard.js';
import {
  applySurveyMarkerHistoryAction,
  buildSurveyMarkerHistoryAction,
  invertSurveyMarkerHistoryAction,
  isSurveyMarkerPlaced,
  patchSurveyMarkerRenderPages,
  placeSurveyMarkerRecord,
  surveyMarkerRenderEntry,
  unplaceSurveyMarkerRecord,
} from '../src/utils/surveyMarkerFamily.js';
import { buildSurveyMarkerRow, mapSurveyMarkerRowToLocalAnnotation } from '../src/services/documentSurveyMarkerMapper.js';

const OWNER = 'user-owner';
const ALICE = 'user-alice';
const BOB = 'user-bob';

const mark = (id, authorId, extra = {}) => ({
  type: 'rect',
  id,
  left: 10,
  top: 10,
  width: 20,
  height: 20,
  stroke: '#000',
  meta: { authorId },
  data: { id, authorId, ...(extra.data || {}) },
  ...extra,
});

// ---------------------------------------------------------------------------
// 1. Open editing
// ---------------------------------------------------------------------------

test('any editor may change and delete anyone\'s unlocked mark', () => {
  const bobs = mark('b1', BOB);
  for (const viewerId of [OWNER, ALICE, BOB]) {
    assert.equal(canModify({ annotation: bobs, viewerId, documentOwnerId: OWNER }), true, viewerId);
    assert.equal(canDelete({ annotation: bobs, viewerId, documentOwnerId: OWNER }), true, viewerId);
  }
  // Unattributed legacy marks too.
  const legacy = { type: 'path', data: { id: 'legacy' } };
  assert.equal(canModify({ annotation: legacy, viewerId: ALICE, documentOwnerId: OWNER }), true);
  // Before sign-in / owner metadata: still fail closed for other people's marks.
  assert.equal(canModify({ annotation: bobs, viewerId: null, documentOwnerId: OWNER }), false);
  assert.equal(canModify({ annotation: bobs, viewerId: ALICE, documentOwnerId: null }), false);
  assert.equal(canModify({ annotation: mark('a1', ALICE), viewerId: ALICE, documentOwnerId: null }), true);
});

test('a Survey Marker from someone else is no longer blocked', () => {
  const bobsMarker = { userId: BOB, pageNumber: 1, bounds: { x: 1, y: 1, width: 5, height: 5 } };
  assert.equal(canModifySurveyMarker({ surveyMarker: bobsMarker, viewerId: ALICE, documentOwnerId: OWNER }), true);
});

test('the bulk-delete plan never asks: cross-author deletes are direct, locked ones are left out', () => {
  const plan = buildBulkDeletePlan({
    candidateIds: ['a1', 'b1', 'b2'],
    annotations: [mark('a1', ALICE), mark('b1', BOB), withMarkLock(mark('b2', BOB), BOB)],
    viewerId: ALICE,
    documentOwnerId: OWNER,
  });
  assert.equal(plan.mode, 'direct');
  assert.deepEqual(plan.ownIds, ['a1']);
  assert.deepEqual(plan.foreignIds, ['b1']);
  assert.deepEqual(plan.lockedIds, ['b2']);
  assert.equal(plan.count, 2);
  const allLocked = buildBulkDeletePlan({
    candidateIds: ['b2'],
    annotations: [withMarkLock(mark('b2', BOB), BOB)],
    viewerId: OWNER,
    documentOwnerId: OWNER,
  });
  assert.equal(allLocked.mode, 'no-op');
});

test('the cross-author confirm modal and the Deleted-Undo toast are gone from the delete path', () => {
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  // Code only (the header comment names the removed copy on purpose).
  const modal = readFileSync(new URL('../src/components/collab/ConfirmDeleteModal.jsx', import.meta.url), 'utf8')
    .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(modal, /Delete annotations from multiple people/);
  assert.doesNotMatch(modal, /of your annotations on this page/);
  assert.match(modal, /plan\.mode !== 'counter-series'/);
  assert.doesNotMatch(viewer, /Only your own marks can be cut/);
  assert.doesNotMatch(viewer, /Survey Markers stay put on Cut/);
  assert.doesNotMatch(viewer, /annotations from \$\{/);
});

// ---------------------------------------------------------------------------
// 3. Lock
// ---------------------------------------------------------------------------

test('the lock stamp is read from every place a type keeps it', () => {
  assert.equal(getMarkLockedBy(withMarkLock(mark('a', ALICE), ALICE)), ALICE);
  assert.equal(getMarkLockedBy(withCalloutLock({ id: 'c' }, BOB)), BOB);
  assert.equal(getMarkLockedBy({ data: { legacyCallout: { lockedBy: OWNER } } }), OWNER);
  assert.equal(getMarkLockedBy(withSurveyMarkerLock({ id: 'm' }, ALICE)), ALICE);
  // A Survey Marker's lock is its top-level stamp only: a stale copy in a
  // row projection's annotationData never keeps it locked after Unlock.
  assert.equal(getMarkLockedBy({ annotationData: { lockedBy: BOB } }), null);
  const roundTripped = { lockedBy: BOB, annotationData: { lockedBy: BOB } };
  assert.equal(getMarkLockedBy(withSurveyMarkerLock(roundTripped, null)), null);
  assert.equal(withSurveyMarkerLock(roundTripped, null).annotationData.lockedBy, undefined);
  assert.equal(getMarkLockedBy(withMarkLock(withMarkLock(mark('a', ALICE), ALICE), null)), null);
  // The older system flag is NOT a user lock (it keeps marks out of marquee).
  assert.equal(isUserLocked({ locked: true, data: {} }), false);
});

test('a locked mark refuses every change for everyone, stays selectable, and only its author or the owner may toggle it', () => {
  const locked = withMarkLock(mark('b1', BOB), BOB);
  for (const viewerId of [OWNER, ALICE, BOB]) {
    assert.equal(canModify({ annotation: locked, viewerId, documentOwnerId: OWNER }), false, viewerId);
    assert.equal(canDelete({ annotation: locked, viewerId, documentOwnerId: OWNER }), false, viewerId);
    assert.equal(canSelect({ annotation: locked, viewerId, documentOwnerId: OWNER }), true, viewerId);
  }
  assert.equal(canMoveAnnotation(locked), false);
  assert.equal(canToggleLock({ annotation: locked, viewerId: BOB, documentOwnerId: OWNER }), true, 'author');
  assert.equal(canToggleLock({ annotation: locked, viewerId: OWNER, documentOwnerId: OWNER }), true, 'owner');
  assert.equal(canToggleLock({ annotation: locked, viewerId: ALICE, documentOwnerId: OWNER }), false, 'other');
  const lockedMarker = withSurveyMarkerLock({ userId: BOB }, BOB);
  assert.equal(canModifySurveyMarker({ surveyMarker: lockedMarker, viewerId: OWNER, documentOwnerId: OWNER }), false);
  assert.equal(canToggleLock({ surveyMarker: lockedMarker, viewerId: ALICE, documentOwnerId: OWNER }), false);
  assert.equal(canToggleLock({ surveyMarker: lockedMarker, viewerId: BOB, documentOwnerId: OWNER }), true);
  assert.deepEqual(filterEraserCommitIds({
    annotationIds: ['b1', 'x'],
    annotations: [locked, { id: 'x', data: { authorId: BOB } }],
    viewerId: ALICE,
    documentOwnerId: OWNER,
  }), ['x'], 'the eraser skips the locked mark and takes the colleague\'s unlocked one');
});

test('the save guard puts back any change to a locked mark and lets only the lock toggle through', () => {
  const locked = withMarkLock(mark('b1', BOB), BOB);
  const free = mark('a1', ALICE);
  const before = [free, locked];

  // Move attempt: reverted.
  const moved = guardLockedMarksOnSave({
    previousObjects: before,
    nextObjects: [free, { ...locked, left: 99 }],
    viewerId: ALICE,
    documentOwnerId: OWNER,
  });
  assert.equal(moved.changed, true);
  assert.equal(moved.objects[1].left, 10);
  assert.deepEqual(moved.blockedIds, ['b1']);

  // Delete attempt: put back in its slot.
  const deleted = guardLockedMarksOnSave({ previousObjects: before, nextObjects: [free], viewerId: OWNER, documentOwnerId: OWNER });
  assert.deepEqual(deleted.objects.map((o) => o.id), ['a1', 'b1']);

  // Restack only: allowed (order is not "moving" the mark).
  const restacked = guardLockedMarksOnSave({ previousObjects: before, nextObjects: [locked, free], viewerId: ALICE, documentOwnerId: OWNER });
  assert.equal(restacked.changed, false);

  // Unlock by the author: allowed. By someone else: refused.
  const unlocked = withMarkLock(locked, null);
  assert.equal(guardLockedMarksOnSave({ previousObjects: before, nextObjects: [free, unlocked], viewerId: BOB, documentOwnerId: OWNER }).changed, false);
  const refused = guardLockedMarksOnSave({ previousObjects: before, nextObjects: [free, unlocked], viewerId: ALICE, documentOwnerId: OWNER });
  assert.equal(getMarkLockedBy(refused.objects[1]), BOB);

  // Unlock AND move in one save: refused whole (unlock first).
  const both = guardLockedMarksOnSave({ previousObjects: before, nextObjects: [free, { ...unlocked, left: 50 }], viewerId: BOB, documentOwnerId: OWNER });
  assert.equal(both.objects[1].left, 10);
  assert.equal(getMarkLockedBy(both.objects[1]), BOB);

  // Locking someone else's mark: only the owner (or its author).
  const lockFree = [withMarkLock(free, BOB), locked];
  const byBob = guardLockedMarksOnSave({ previousObjects: before, nextObjects: lockFree, viewerId: BOB, documentOwnerId: OWNER });
  assert.equal(getMarkLockedBy(byBob.objects[0]), null, 'Bob cannot lock Alice\'s mark');
  const byOwner = guardLockedMarksOnSave({ previousObjects: before, nextObjects: [withMarkLock(free, OWNER), locked], viewerId: OWNER, documentOwnerId: OWNER });
  assert.equal(getMarkLockedBy(byOwner.objects[0]), OWNER);

  // A lock is always stamped with the viewer's own id.
  const forged = guardLockedMarksOnSave({ previousObjects: before, nextObjects: [withMarkLock(free, OWNER), locked], viewerId: ALICE, documentOwnerId: OWNER });
  assert.equal(getMarkLockedBy(forged.objects[0]), null, 'Alice (author) cannot lock in the owner\'s name');

  // Nothing locked anywhere: the very same array comes back (hot path).
  const plain = [free];
  const next = [{ ...free, left: 30 }];
  assert.equal(guardLockedMarksOnSave({ previousObjects: plain, nextObjects: next, viewerId: ALICE, documentOwnerId: OWNER }).objects, next);
});

test('a locked callout (its lock lives in the projected group\'s legacyCallout) is guarded the same way', () => {
  const group = {
    type: 'group',
    data: { type: 'callout', id: 'c1', authorId: BOB, legacyCallout: { id: 'c1', text: 'hi', meta: { authorId: BOB } } },
  };
  const lockedGroup = withMarkLock(group, BOB);
  assert.equal(lockedGroup.data.legacyCallout.lockedBy, BOB);
  const edited = { ...lockedGroup, data: { ...lockedGroup.data, legacyCallout: { ...lockedGroup.data.legacyCallout, text: 'changed' } } };
  const result = guardLockedMarksOnSave({ previousObjects: [lockedGroup], nextObjects: [edited], viewerId: OWNER, documentOwnerId: OWNER });
  assert.equal(result.objects[0].data.legacyCallout.text, 'hi');
  // Re-projection of the group (another callout on the page was edited):
  // derived geometry / normalized coords / legacyCallout.meta change, the
  // callout itself does not — not a blocked edit.
  const reprojected = {
    ...lockedGroup,
    left: 3,
    data: {
      ...lockedGroup.data,
      legacyNormalizedCoords: { knee: { x: 0.2, y: 0.3 } },
      legacyCallout: { ...lockedGroup.data.legacyCallout, meta: { authorId: BOB, extra: 1 } },
    },
  };
  assert.equal(guardLockedMarksOnSave({ previousObjects: [lockedGroup], nextObjects: [reprojected], viewerId: ALICE, documentOwnerId: OWNER }).changed, false);
});

test('a pasted copy of a locked mark or callout is not locked', () => {
  const locked = withMarkLock(mark('b1', BOB), BOB);
  const clipboard = buildFamilyClipboard({ pageNumber: 1, objects: [locked], indices: [0] });
  let n = 0;
  const plan = planFamilyPaste(clipboard, { objects: [], dx: 5, dy: 5, newId: () => `new-${n += 1}`, authorId: ALICE, pageNumber: 1 });
  assert.equal(plan.objects.length, 1);
  assert.equal(getMarkLockedBy(plan.objects[0]), null);
  const calloutPlan = planFamilyPaste({
    items: [{ kind: 'callout', callout: withCalloutLock({ id: 'c1', textBoxPosition: { x: 0.1, y: 0.1 } }, BOB) }],
    pageWidth: 612,
    pageHeight: 792,
  }, { newId: () => 'nc', authorId: ALICE, pageNumber: 1 });
  assert.equal(getMarkLockedBy(calloutPlan.callouts[0]), null);
});

test('the canvas render entry of a locked Survey Marker carries the lock (for the badge and the drag stop)', () => {
  const record = withSurveyMarkerLock({ pageNumber: 1, bounds: { x: 1, y: 2, width: 3, height: 4 }, moduleId: 'mod' }, ALICE);
  assert.equal(surveyMarkerRenderEntry('m1', record).lockedBy, ALICE);
});

// ---------------------------------------------------------------------------
// 2. Survey Marker Cut = pick up the placement
// ---------------------------------------------------------------------------

const placedMarker = () => ({
  id: 'surveyMarker-1',
  pageNumber: 2,
  bounds: { x: 100, y: 50, width: 40, height: 20, angle: 0 },
  moduleId: 'mod-a',
  categoryId: 'cat-a',
  regionId: null,
  name: 'Door 1',
  checklistResponses: { q1: 'yes' },
  excelSync: { assignedToken: 'ROWID-TOKEN' },
  stack: { after: 'x', before: null, order: 1 },
  userId: BOB,
});

test('cutting a Survey Marker keeps the survey item, its answers and its Excel identity; Undo puts the box back', () => {
  const record = placedMarker();
  const unplaced = unplaceSurveyMarkerRecord(record);
  assert.equal(isSurveyMarkerPlaced(unplaced), false);
  assert.equal(unplaced.pageNumber, null);
  assert.equal(unplaced.bounds, null);
  assert.equal('stack' in unplaced, false);
  assert.deepEqual(unplaced.checklistResponses, { q1: 'yes' });
  assert.deepEqual(unplaced.excelSync, { assignedToken: 'ROWID-TOKEN' });
  assert.equal(unplaced.id, record.id);

  const action = buildSurveyMarkerHistoryAction([{ id: record.id, before: record, after: unplaced }]);
  const cut = applySurveyMarkerHistoryAction({ [record.id]: record }, action);
  assert.equal(cut.markers[record.id].pageNumber, null);
  // Meanwhile an Excel edit changes the answers: Undo of the Cut keeps it.
  const edited = { [record.id]: { ...cut.markers[record.id], checklistResponses: { q1: 'no' } } };
  const undone = applySurveyMarkerHistoryAction(edited, invertSurveyMarkerHistoryAction(action));
  assert.equal(undone.markers[record.id].pageNumber, 2);
  assert.deepEqual(undone.markers[record.id].bounds, record.bounds);
  assert.deepEqual(undone.markers[record.id].checklistResponses, { q1: 'no' });

  // The page stops drawing it, and draws it again after the Undo.
  const pages = { 2: [surveyMarkerRenderEntry(record.id, record)] };
  const afterCut = patchSurveyMarkerRenderPages(pages, cut.markers, [record.id]);
  assert.equal((afterCut[2] || []).length, 0);
  const afterUndo = patchSurveyMarkerRenderPages(afterCut, undone.markers, [record.id]);
  assert.equal(afterUndo[2].length, 1);
});

test('pasting a cut Survey Marker places the SAME item (same id, module and category) on any page', () => {
  const record = placedMarker();
  const clipboard = buildFamilyClipboard({
    pageNumber: 2,
    markers: [{ id: record.id, record, categoryName: 'Doors' }],
    pageMarkers: [{ id: record.id, stack: record.stack }],
    cut: true,
  });
  assert.equal(clipboard.items[0].cutMarkerId, record.id);

  const plan = planFamilyPaste(clipboard, {
    objects: [],
    dx: 10,
    dy: 20,
    pageNumber: 5,
    resolveMarker: () => { throw new Error('a cut item must not become a new item'); },
    resolveCutMarker: () => ({ regionId: 'region-9' }),
  });
  assert.deepEqual(plan.markers, [], 'no new survey item');
  assert.equal(plan.placedMarkers.length, 1);
  const place = plan.placedMarkers[0];
  assert.equal(place.id, record.id);
  assert.equal(place.pageNumber, 5);
  assert.equal(place.bounds.x, 110);
  assert.equal(place.bounds.y, 70);

  const unplaced = unplaceSurveyMarkerRecord(record);
  const placed = placeSurveyMarkerRecord(unplaced, place);
  assert.equal(placed.id, record.id);
  assert.equal(placed.moduleId, 'mod-a');
  assert.equal(placed.categoryId, 'cat-a');
  assert.equal(placed.regionId, 'region-9');
  assert.deepEqual(placed.excelSync, { assignedToken: 'ROWID-TOKEN' });
  assert.deepEqual(placed.checklistResponses, { q1: 'yes' });

  // Can't go back (wrong module open, or already back on the page): skipped.
  const skipped = planFamilyPaste(clipboard, { pageNumber: 1, resolveCutMarker: () => null });
  assert.equal(skipped.placedMarkers.length, 0);
  assert.equal(skipped.skippedCutMarkers, 1);

  // Copy (not Cut) still makes a NEW item.
  const copy = buildFamilyClipboard({ pageNumber: 2, markers: [{ id: record.id, record, categoryName: 'Doors' }] });
  assert.equal(copy.items[0].cutMarkerId, undefined);
});

test('the Survey Marker mirror row says when an item is off the page and carries its lock and author', () => {
  const unplaced = withSurveyMarkerLock(unplaceSurveyMarkerRecord(placedMarker()), BOB);
  const row = buildSurveyMarkerRow({ documentId: 'doc', userId: ALICE, annotationId: unplaced.id, annotation: unplaced });
  assert.equal(row.annotation_data.unplaced, true);
  assert.equal(row.annotation_data.lockedBy, BOB);
  assert.equal(row.annotation_data.authorId, BOB);
  const back = mapSurveyMarkerRowToLocalAnnotation(row);
  assert.equal(back.pageNumber, null);
  assert.equal(back.bounds, null);
  assert.equal(back.lockedBy, BOB);
});

// ---------------------------------------------------------------------------
// Undo covers the user's own edits on anyone's marks (two users)
// ---------------------------------------------------------------------------

test('two users: Bob\'s edit to Alice\'s mark is Bob\'s Undo step (not skipped for an older step of his own)', () => {
  const alicesMark = mark('a1', ALICE);
  const bobsMark = mark('b1', BOB);
  const page0 = { objects: [alicesMark, bobsMark] };
  // Bob's older step: he moves his own mark.
  const page1 = { objects: [alicesMark, { ...bobsMark, left: 40 }] };
  const bobOwnStep = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: page0, nextPage: page1 });
  // Bob's newer step: he restyles ALICE's mark.
  const page2 = { objects: [{ ...alicesMark, stroke: '#f00' }, page1.objects[1]] };
  const bobOnAlicesStep = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: page1, nextPage: page2 });

  // Both are kept on Bob's stack (the old owner filter dropped the second).
  assert.ok(filterAnnotationHistoryActionByOwner(bobOwnStep, BOB, OWNER));
  const kept = filterAnnotationHistoryActionByOwner(bobOnAlicesStep, BOB, OWNER);
  assert.ok(kept, 'Bob\'s edit to Alice\'s mark is recorded for Bob');

  // Bob presses Cmd+Z once: his LATEST step (Alice's colour) is undone, his
  // own move stays.
  const after = applyAnnotationHistoryAction({ 1: page2 }, invertAnnotationHistoryAction(kept));
  const objects = after[1].objects;
  assert.equal(objects.find((o) => o.id === 'a1').stroke, '#000');
  assert.equal(objects.find((o) => o.id === 'b1').left, 40);

  // Alice's own later edit to another field of her mark survives Bob's Undo
  // (field-level undo writes back only the colour).
  const aliceMoved = { 1: { objects: [{ ...page2.objects[0], left: 77 }, page2.objects[1]] } };
  const merged = applyAnnotationHistoryAction(aliceMoved, invertAnnotationHistoryAction(kept));
  const a1 = merged[1].objects.find((o) => o.id === 'a1');
  assert.equal(a1.stroke, '#000');
  assert.equal(a1.left, 77);

  // An unknown viewer still records nothing.
  assert.equal(filterAnnotationHistoryActionByOwner(bobOnAlicesStep, null, OWNER), null);
});

test('an Excel import never deletes a cut (waiting to be pasted) or locked survey item, and neither reads as an Excel change', async () => {
  const { isPlacedSurveyMarker, computeImportDeletionCandidates } = await import('../src/services/surveyMarkerSyncDiff.js');
  const { computeExcelSyncFingerprint } = await import('../src/utils/excelSyncDirtyState.js');
  const cut = unplaceSurveyMarkerRecord({ ...placedMarker(), exportedAt: '2026-09-01T00:00:00Z' });
  assert.equal(isPlacedSurveyMarker(cut), true, 'a cut item keeps the placed-marker protection');
  assert.equal(isPlacedSurveyMarker(placeSurveyMarkerRecord(cut, { pageNumber: 1, bounds: { x: 1, y: 1, width: 2, height: 2 } })), true);
  const lockedUnplaced = withSurveyMarkerLock({ ...placedMarker(), pageNumber: null, bounds: null, exportedAt: 'x' }, BOB);
  assert.equal(isPlacedSurveyMarker(lockedUnplaced), true, 'a locked item is protected too');
  const candidates = computeImportDeletionCandidates(
    { c: { ...cut, name: 'Door 1' }, l: { ...lockedUnplaced, name: 'Door 2' } },
    { 'mod-a-cat-a': new Set(['Other']) },
  );
  assert.deepEqual(candidates, []);
  const template = { id: 't', linkedExcelPath: '/x.xlsx' };
  const base = { m: placedMarker() };
  assert.equal(
    computeExcelSyncFingerprint(template, base).hash,
    computeExcelSyncFingerprint(template, { m: withSurveyMarkerLock(base.m, BOB) }).hash,
    'locking a survey item is not an Excel change',
  );
});
