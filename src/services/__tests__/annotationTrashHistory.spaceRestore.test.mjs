// KAL-313 follow-up — standalone space restore + either-order restore + labels.
//
// Covers the live logic used by PDFViewer's restore dispatch:
//   - handleRestoreSpace delegates to applySpaceRestore (standalone + cascade)
//   - handleRestoreHistoryActivity's region branch delegates to
//     applyRegionRestoreToSpaces
//   - RevisionsPanel's expanded detail line uses describeHistoryEventSubject
//
// Product spec (Isaiah, 2026-06-10): every deletion is independently
// restorable, in either order. Restoring the space brings it back exactly as
// captured at delete time; a region deleted separately beforehand stays
// deleted, but its own entry then restores plainly because its space exists
// again.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSpaceDeleteHistoryRow,
  buildRegionDeleteHistoryRow,
  isSpaceRestoreAction,
  isRegionRestoreAction,
  applySpaceRestore,
  applyRegionRestoreToSpaces,
  resolveRegionRestoreCascade,
  describeHistoryEventSubject,
} from '../annotationTrashHistory.js';

const DOCUMENT_ID = 'doc-1';

const REGION_R1 = {
  regionId: 'region-r1',
  pageId: 3,
  shapeType: 'rectangular',
  coordinates: [10, 10, 110, 10, 110, 60, 10, 60],
  rotation: 30, // KAL-301 baked rotation — must survive the round-trip
};

const REGION_R2 = {
  regionId: 'region-r2',
  pageId: 3,
  shapeType: 'polygon',
  coordinates: [5, 5, 50, 5, 30, 40],
  rotation: 0,
};

const SPACE_FULL = {
  id: 'space-1',
  name: 'Kitchen',
  color: '#ff0000',
  assignedPages: [
    { pageId: 3, wholePageIncluded: false, regions: [REGION_R1, REGION_R2] },
    { pageId: 7, wholePageIncluded: true, regions: [] },
  ],
};

function buildSpaceRow(space, deletedAt = '2026-06-10T12:00:00.000Z') {
  return buildSpaceDeleteHistoryRow({
    space,
    documentId: DOCUMENT_ID,
    userId: 'user-1',
    actorName: 'Isaiah',
    deletedAt,
  });
}

function buildRegionRow(region, deletedAt = '2026-06-10T11:00:00.000Z') {
  return buildRegionDeleteHistoryRow({
    region,
    spaceId: SPACE_FULL.id,
    spaceName: SPACE_FULL.name,
    documentId: DOCUMENT_ID,
    userId: 'user-1',
    actorName: 'Isaiah',
    deletedAt,
  });
}

test('standalone space restore round-trips the full space object incl. assignedPages', () => {
  const row = buildSpaceRow(SPACE_FULL);
  assert.equal(row.event_type, 'space_deleted');
  assert.ok(isSpaceRestoreAction(row.payload.restoreAction));

  const result = applySpaceRestore([], row.payload.restoreAction, {
    restoredAt: '2026-06-10T13:00:00.000Z',
  });
  assert.ok(result, 'restore into empty live spaces must succeed');
  assert.equal(result.spaces.length, 1);

  const { restoredAt, ...restored } = result.space;
  assert.deepEqual(restored, SPACE_FULL, 'space must come back exactly as captured');
  assert.equal(restoredAt, '2026-06-10T13:00:00.000Z');
});

test('space restore preserves other live spaces', () => {
  const other = { id: 'space-other', name: 'Hall', assignedPages: [] };
  const row = buildSpaceRow(SPACE_FULL);
  const result = applySpaceRestore([other], row.payload.restoreAction);
  assert.equal(result.spaces.length, 2);
  assert.equal(result.spaces[0], other, 'existing spaces untouched');
});

test('space restore is a no-op when the space already exists (already-present message, not an error)', () => {
  const row = buildSpaceRow(SPACE_FULL);
  assert.equal(applySpaceRestore([SPACE_FULL], row.payload.restoreAction), null);
});

test('space restore rejects non-space restoreActions', () => {
  assert.equal(applySpaceRestore([], null), null);
  assert.equal(applySpaceRestore([], { type: 'region', regionId: 'x', spaceId: 'y', region: {} }), null);
});

test('either-order: region deleted first, space restored alone, region entry then plain-restores', () => {
  // 1. Region r1 deleted separately FIRST — journaled with the full region object.
  const regionRow = buildRegionRow(REGION_R1, '2026-06-10T11:00:00.000Z');
  assert.equal(regionRow.event_type, 'region_deleted');
  assert.ok(isRegionRestoreAction(regionRow.payload.restoreAction));

  // 2. Space deleted afterwards — its delete-time snapshot no longer holds r1.
  const spaceAtDelete = {
    ...SPACE_FULL,
    assignedPages: [
      { pageId: 3, wholePageIncluded: false, regions: [REGION_R2] },
      { pageId: 7, wholePageIncluded: true, regions: [] },
    ],
  };
  const spaceRow = buildSpaceRow(spaceAtDelete, '2026-06-10T12:00:00.000Z');

  // 3. Restore the SPACE alone from its own entry.
  const spaceRestore = applySpaceRestore([], spaceRow.payload.restoreAction);
  assert.ok(spaceRestore);
  const page3 = spaceRestore.space.assignedPages.find((p) => p.pageId === 3);
  assert.deepEqual(page3.regions, [REGION_R2], 'separately-deleted region r1 stays deleted');

  // 4. The orphaned region entry is now a PLAIN restore (space exists again).
  assert.equal(
    resolveRegionRestoreCascade({
      spaceId: SPACE_FULL.id,
      liveSpaces: spaceRestore.spaces,
      historyEvents: [spaceRow, regionRow],
    }),
    'plain',
  );

  // 5. Plain-restore the region from its own entry.
  const regionApply = applyRegionRestoreToSpaces(spaceRestore.spaces, regionRow.payload.restoreAction);
  assert.equal(regionApply.status, 'ok');
  assert.equal(regionApply.pageId, 3);
  const restoredPage3 = regionApply.assignedPages.find((p) => String(p.pageId) === '3');
  assert.deepEqual(
    restoredPage3.regions,
    [REGION_R2, REGION_R1],
    'r1 appended unchanged — rotation and coordinates preserved',
  );

  // 6. Re-applying the same region restore is idempotent.
  const spacesAfter = spaceRestore.spaces.map((s) =>
    s.id === SPACE_FULL.id ? { ...s, assignedPages: regionApply.assignedPages } : s,
  );
  assert.equal(applyRegionRestoreToSpaces(spacesAfter, regionRow.payload.restoreAction).status, 'noop');
});

test('region restore with missing space signals cascade decision (cascade vs blocked)', () => {
  const regionRow = buildRegionRow(REGION_R1);
  const spaceRow = buildSpaceRow(SPACE_FULL);

  const applied = applyRegionRestoreToSpaces([], regionRow.payload.restoreAction);
  assert.deepEqual(applied, { status: 'space-missing', spaceId: SPACE_FULL.id });

  assert.equal(
    resolveRegionRestoreCascade({ spaceId: SPACE_FULL.id, liveSpaces: [], historyEvents: [spaceRow] }),
    'cascade',
  );
  assert.equal(
    resolveRegionRestoreCascade({ spaceId: SPACE_FULL.id, liveSpaces: [], historyEvents: [] }),
    'blocked',
  );
});

test('region restore creates the page entry when the page record is gone', () => {
  const regionRow = buildRegionRow(REGION_R1);
  const spaceWithoutPage3 = {
    ...SPACE_FULL,
    assignedPages: [{ pageId: 7, wholePageIncluded: true, regions: [] }],
  };
  const applied = applyRegionRestoreToSpaces([spaceWithoutPage3], regionRow.payload.restoreAction);
  assert.equal(applied.status, 'ok');
  const created = applied.assignedPages.find((p) => String(p.pageId) === '3');
  assert.deepEqual(created, { pageId: 3, regions: [REGION_R1], wholePageIncluded: false });
});

// ─── Labels — RevisionsPanel expanded-detail subject line ────────────────────

test('space_deleted entries label as Space, never "Annotation: <id>"', () => {
  const row = buildSpaceRow(SPACE_FULL);
  assert.equal(describeHistoryEventSubject(row), 'Space: "Kitchen"');

  const unnamed = buildSpaceRow({ id: 'space-9', assignedPages: [] });
  assert.equal(describeHistoryEventSubject(unnamed), 'Space: space-9');
});

test('region_deleted entries label as Region in <space>', () => {
  const row = buildRegionRow(REGION_R1);
  assert.equal(describeHistoryEventSubject(row), 'Region in "Kitchen"');

  const noSpaceName = buildRegionDeleteHistoryRow({
    region: REGION_R2,
    spaceId: 'space-1',
    spaceName: null,
    documentId: DOCUMENT_ID,
    deletedAt: '2026-06-10T11:00:00.000Z',
  });
  assert.equal(describeHistoryEventSubject(noSpaceName), 'Region in a space');
});

// w55 (ruled change, audit defect 17): History never shows a raw mark id to
// the reader — the row's own sentence already names the mark. Annotation
// entries now show no subject line, like bulk and empty events.
test('annotation entries show no raw-id subject line; bulk and empty events show nothing', () => {
  assert.equal(
    describeHistoryEventSubject({ event_type: 'annotation_deleted', annotation_id: 'ann-1' }),
    null,
  );
  assert.equal(
    describeHistoryEventSubject({ event_type: 'annotations_bulk_deleted', annotation_id: null }),
    null,
  );
  assert.equal(describeHistoryEventSubject({ event_type: 'page_rotated', annotation_id: null }), null);
  assert.equal(describeHistoryEventSubject(null), null);
});
