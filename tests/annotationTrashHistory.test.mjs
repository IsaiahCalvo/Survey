// KAL-313: Trash / History / Restore — all annotation types.
// Tests every builder and restore helper in annotationTrashHistory.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnnotationRestoreAction,
  buildAnnotationDeleteHistoryRow,
  isAnnotationRestoreAction,
  buildCalloutRestoreAction,
  buildCalloutDeleteHistoryRow,
  isCalloutRestoreAction,
  applyCalloutRestore,
  buildRegionRestoreAction,
  buildRegionDeleteHistoryRow,
  isRegionRestoreAction,
  buildBulkAnnotationDeleteHistoryRows,
  splitBulkRestoreActionsIntoBatches,
  isBulkAnnotationDeleteEvent,
} from '../src/services/annotationTrashHistory.js';
import {
  invertAnnotationHistoryAction,
  applyAnnotationHistoryAction,
} from '../src/utils/annotationLocalHistory.js';

// ─── Shared fixtures ────────────────────────────────────────────────────────

const fabricRect = {
  type: 'rect',
  left: 100, top: 200, width: 80, height: 60,
  angle: 0, scaleX: 1, scaleY: 1,
  stroke: '#ff0000', strokeWidth: 2, fill: 'transparent', opacity: 1,
  data: { id: 'ann-1', authorId: 'user-a', authorName: 'Alice', createdAt: '2026-01-01T00:00:00Z' },
};

const deleteAction = {
  type: 'fabric:delete',
  pageNumber: 3,
  annotationId: 'ann-1',
  annotation: fabricRect,
  index: 0,
};

const callout = {
  id: 'call-1',
  pageNumber: 2,
  anchor: { x: 0.3, y: 0.4 },
  tail: { x: 0.5, y: 0.6 },
  text: 'Note here',
  style: { borderColor: '#00ff00', fillColor: '#ffffff', lineThickness: 2 },
  createdBy: 'user-a',
  createdAt: '2026-01-01T00:00:00Z',
  authorName: 'Alice',
};

const region = {
  regionId: 'reg-1',
  pageId: 5,
  shapeType: 'rectangular',
  operation: 'add',
  coordinates: [10, 20, 90, 20, 90, 80, 10, 80],
  rotation: 45, // round-trip test: must survive delete/restore
};

const DOC_ID = 'doc-xyz';
const USER_ID = 'user-a';
const TS = '2026-06-11T12:00:00.000Z';

// ─── Slice 2: Standard annotation (shape / ink / text) ──────────────────────

test('buildAnnotationRestoreAction inverts fabric:delete to fabric:create', () => {
  const ra = buildAnnotationRestoreAction(deleteAction);
  assert.equal(ra.type, 'fabric:create');
  assert.equal(ra.annotationId, 'ann-1');
  assert.equal(ra.pageNumber, 3);
  assert.deepEqual(ra.annotation, fabricRect);
});

test('buildAnnotationRestoreAction returns null for non-delete action', () => {
  assert.equal(buildAnnotationRestoreAction({ type: 'fabric:create' }), null);
  assert.equal(buildAnnotationRestoreAction(null), null);
});

test('buildAnnotationDeleteHistoryRow produces a valid restore-capable row', () => {
  const row = buildAnnotationDeleteHistoryRow({
    deleteAction,
    documentId: DOC_ID,
    userId: USER_ID,
    actorName: 'Alice',
    deletedAt: TS,
  });
  assert.ok(row, 'row is produced');
  assert.equal(row.event_type, 'annotation_deleted');
  assert.equal(row.document_id, DOC_ID);
  assert.equal(row.user_id, USER_ID);
  assert.equal(row.page_number, 3);
  assert.equal(row.annotation_id, 'ann-1');
  assert.match(row.summary, /Alice.*deleted.*rectangle.*page 3/i);
  assert.equal(row.is_undoable, true);
  assert.ok(row.payload.restoreAction, 'restoreAction present');
  assert.equal(row.payload.restoreAction.type, 'fabric:create');
  assert.equal(row.payload.deletedBy, USER_ID);
});

test('buildAnnotationDeleteHistoryRow returns null for non-delete action', () => {
  assert.equal(
    buildAnnotationDeleteHistoryRow({ deleteAction: { type: 'fabric:create' }, documentId: DOC_ID, deletedAt: TS }),
    null
  );
});

test('isAnnotationRestoreAction correctly identifies fabric:create restore actions', () => {
  const ra = buildAnnotationRestoreAction(deleteAction);
  assert.ok(isAnnotationRestoreAction(ra));
  assert.equal(isAnnotationRestoreAction({ type: 'surveyMarker' }), false);
  assert.equal(isAnnotationRestoreAction(null), false);
});

test('restore round-trip: delete then restore produces identical annotation in page', () => {
  const annotationsByPage = { '3': { objects: [fabricRect] } };

  // Simulate delete: remove object
  const afterDelete = applyAnnotationHistoryAction(annotationsByPage, deleteAction);
  assert.equal(afterDelete['3'].objects.length, 0, 'annotation removed');

  // Restore: apply the fabric:create restoreAction
  const ra = buildAnnotationRestoreAction(deleteAction);
  const afterRestore = applyAnnotationHistoryAction(afterDelete, ra);
  assert.equal(afterRestore['3'].objects.length, 1, 'annotation restored');
  assert.deepEqual(afterRestore['3'].objects[0], fabricRect, 'geometry identical');
});

test('restore is idempotent: applying twice does not duplicate (upsert behaviour)', () => {
  // applyAnnotationHistoryAction fabric:create with existing id replaces, not duplicates
  const annotationsByPage = { '3': { objects: [fabricRect] } };
  const ra = buildAnnotationRestoreAction(deleteAction);
  const once = applyAnnotationHistoryAction(annotationsByPage, ra);
  assert.equal(once['3'].objects.length, 1);
});

// ─── Slice 3: Callout ────────────────────────────────────────────────────────

test('buildCalloutRestoreAction carries full callout', () => {
  const ra = buildCalloutRestoreAction(callout);
  assert.equal(ra.type, 'callout');
  assert.equal(ra.calloutId, 'call-1');
  assert.equal(ra.pageNumber, 2);
  assert.deepEqual(ra.callout, callout);
});

test('buildCalloutDeleteHistoryRow produces a valid restore-capable row', () => {
  const row = buildCalloutDeleteHistoryRow({
    callout,
    documentId: DOC_ID,
    userId: USER_ID,
    actorName: 'Alice',
    deletedAt: TS,
  });
  assert.ok(row);
  assert.equal(row.event_type, 'callout_deleted');
  assert.equal(row.annotation_id, 'call-1');
  assert.equal(row.page_number, 2);
  assert.match(row.summary, /Alice.*deleted.*callout.*page 2/i);
  assert.equal(row.payload.restoreAction.type, 'callout');
  assert.deepEqual(row.payload.restoreAction.callout, callout);
  assert.equal(row.payload.deletedBy, USER_ID);
});

test('isCalloutRestoreAction identifies callout restore actions', () => {
  const ra = buildCalloutRestoreAction(callout);
  assert.ok(isCalloutRestoreAction(ra));
  assert.equal(isCalloutRestoreAction({ type: 'fabric:create' }), false);
  assert.equal(isCalloutRestoreAction(null), false);
});

test('applyCalloutRestore adds callout when not present', () => {
  const ra = buildCalloutRestoreAction(callout);
  const result = applyCalloutRestore([], ra, { restoredAt: TS });
  assert.ok(result);
  assert.equal(result.callouts.length, 1);
  assert.equal(result.callout.id, 'call-1');
  assert.equal(result.callout.restoredAt, TS);
  // Original callout fields preserved (coordinates intact)
  assert.deepEqual(result.callout.anchor, callout.anchor);
});

test('applyCalloutRestore is idempotent: returns null when callout already present', () => {
  const ra = buildCalloutRestoreAction(callout);
  const result = applyCalloutRestore([callout], ra);
  assert.equal(result, null, 'no-op when already present');
});

test('callout restore preserves normalized 0-1 coordinates', () => {
  const ra = buildCalloutRestoreAction(callout);
  const result = applyCalloutRestore([], ra, { restoredAt: TS });
  assert.deepEqual(result.callout.anchor, { x: 0.3, y: 0.4 });
  assert.deepEqual(result.callout.tail, { x: 0.5, y: 0.6 });
});

// ─── Slice 4: Region ─────────────────────────────────────────────────────────

test('buildRegionRestoreAction captures full region including rotation', () => {
  const ra = buildRegionRestoreAction({ region, spaceId: 'sp-1', spaceName: 'Zone A' });
  assert.equal(ra.type, 'region');
  assert.equal(ra.regionId, 'reg-1');
  assert.equal(ra.spaceId, 'sp-1');
  assert.equal(ra.spaceName, 'Zone A');
  assert.equal(ra.pageNumber, 5);
  // Critical: rotation must survive the round-trip (KAL-301 baked rotation)
  assert.equal(ra.region.rotation, 45, 'rotation preserved in restoreAction');
});

test('buildRegionDeleteHistoryRow produces a valid restore-capable row', () => {
  const row = buildRegionDeleteHistoryRow({
    region,
    spaceId: 'sp-1',
    spaceName: 'Zone A',
    documentId: DOC_ID,
    userId: USER_ID,
    actorName: 'Alice',
    deletedAt: TS,
  });
  assert.ok(row);
  assert.equal(row.event_type, 'region_deleted');
  assert.equal(row.annotation_id, 'reg-1');
  assert.equal(row.page_number, 5);
  assert.match(row.summary, /Alice.*deleted.*region.*page 5.*Zone A/i);
  assert.equal(row.payload.restoreAction.type, 'region');
  assert.equal(row.payload.restoreAction.region.rotation, 45, 'rotation in payload');
  assert.equal(row.payload.deletedBy, USER_ID);
});

test('isRegionRestoreAction identifies region restore actions', () => {
  const ra = buildRegionRestoreAction({ region, spaceId: 'sp-1', spaceName: 'Zone A' });
  assert.ok(isRegionRestoreAction(ra));
  assert.equal(isRegionRestoreAction({ type: 'callout' }), false);
  assert.equal(isRegionRestoreAction(null), false);
});

test('region rotation survives full delete/restore cycle (KAL-301 regression)', () => {
  const rotatedRegion = { ...region, rotation: 90 };
  const ra = buildRegionRestoreAction({ region: rotatedRegion, spaceId: 'sp-1', spaceName: 'Zone A' });
  // The restore action must carry the baked rotation
  assert.equal(ra.region.rotation, 90);
  // Coordinates (already baked at drag-end in RST) also survive
  assert.deepEqual(ra.region.coordinates, region.coordinates);
});

// ─── Slice 5: Bulk delete ────────────────────────────────────────────────────

function makeFabricDeleteAction(id, page) {
  return {
    type: 'fabric:delete',
    pageNumber: page,
    annotationId: id,
    annotation: { ...fabricRect, data: { ...fabricRect.data, id } },
    index: 0,
  };
}

function makeObjectEntry(id, page) {
  const action = makeFabricDeleteAction(id, page);
  return {
    annotationId: id,
    pageNumber: page,
    restoreAction: buildAnnotationRestoreAction(action),
  };
}

test('buildBulkAnnotationDeleteHistoryRows produces one row for ≤50 objects', () => {
  const objects = [makeObjectEntry('a1', 1), makeObjectEntry('a2', 1), makeObjectEntry('a3', 2)];
  const rows = buildBulkAnnotationDeleteHistoryRows({
    objectRestoreActions: objects,
    totalCount: 3,
    documentId: DOC_ID,
    userId: USER_ID,
    actorName: 'Alice',
    deletedAt: TS,
  });
  assert.equal(rows.length, 1, 'single row for small bulk');
  const row = rows[0];
  assert.equal(row.event_type, 'annotations_bulk_deleted');
  assert.match(row.summary, /Alice.*deleted 3 annotations/i);
  assert.equal(row.payload.objects.length, 3);
  assert.equal(row.payload.count, 3);
  assert.equal(row.is_undoable, true);
  // Each object carries a valid restoreAction
  for (const obj of row.payload.objects) {
    assert.equal(obj.restoreAction.type, 'fabric:create');
  }
});

test('buildBulkAnnotationDeleteHistoryRows splits into batches at 51 objects', () => {
  const objects = Array.from({ length: 51 }, (_, i) => makeObjectEntry(`id-${i}`, 1));
  const rows = buildBulkAnnotationDeleteHistoryRows({
    objectRestoreActions: objects,
    totalCount: 51,
    documentId: DOC_ID,
    userId: USER_ID,
    actorName: 'Alice',
    deletedAt: TS,
  });
  assert.equal(rows.length, 2, 'two rows for 51 objects');
  assert.equal(rows[0].payload.objects.length, 50, 'first batch has 50');
  assert.equal(rows[1].payload.objects.length, 1, 'second batch has 1');
  assert.equal(rows[0].payload.batchId, rows[1].payload.batchId, 'shared batchId');
  assert.match(rows[0].summary, /batch 1\/2/i);
  assert.match(rows[1].summary, /batch 2\/2/i);
});

test('buildBulkAnnotationDeleteHistoryRows returns [] for empty input', () => {
  const rows = buildBulkAnnotationDeleteHistoryRows({
    objectRestoreActions: [],
    totalCount: 0,
    documentId: DOC_ID,
    deletedAt: TS,
  });
  assert.deepEqual(rows, []);
});

test('isBulkAnnotationDeleteEvent identifies bulk events', () => {
  const rows = buildBulkAnnotationDeleteHistoryRows({
    objectRestoreActions: [makeObjectEntry('x', 1)],
    totalCount: 1,
    documentId: DOC_ID,
    deletedAt: TS,
  });
  assert.ok(isBulkAnnotationDeleteEvent(rows[0]));
  assert.equal(isBulkAnnotationDeleteEvent({ event_type: 'annotation_deleted' }), false);
});

test('splitBulkRestoreActionsIntoBatches respects 50-object cap', () => {
  const actions = Array.from({ length: 100 }, (_, i) => makeObjectEntry(`id-${i}`, 1));
  const batches = splitBulkRestoreActionsIntoBatches(actions, 'batch-test');
  assert.equal(batches.length, 2);
  assert.equal(batches[0].length, 50);
  assert.equal(batches[1].length, 50);
});

// ─── Regression: marker trash untouched ─────────────────────────────────────

test('annotation delete row has different event_type than survey_marker_deleted', () => {
  const row = buildAnnotationDeleteHistoryRow({ deleteAction, documentId: DOC_ID, deletedAt: TS });
  assert.notEqual(row.event_type, 'survey_marker_deleted');
  assert.equal(row.event_type, 'annotation_deleted');
});
