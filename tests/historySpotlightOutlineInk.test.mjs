// History spotlight × outline ink (a3380bbf capsule eraser).
//
// Since the capsule-eraser cutover, pen strokes persist as FILLED OUTLINE
// geometry: `path` holds absolute page-space commands, strokeWidth is 0,
// left/top stay 0, and the object carries polygons + paperCenterline copies of
// the same geometry. The History spotlight's contract is fabric-shaped —
// translate(left, top) around an origin-based path, and a left/top/width/height
// bounding-rect fallback — so the raw outline object must be projected down to
// a compact preview at write time or the delete-row spotlight draws a bbox
// rect at the page origin (KAL-74 S4 gates 'glow is path-shaped' / 'glow bbox
// ≈ stroke bbox').

import test from 'node:test';
import { equal, ok, deepEqual, match } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  projectAnnotationForHistoryPreview,
  isOutlineInkAnnotation,
} from '../src/utils/historyPreviewAnnotation.js';
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';
import { buildHistoryEventRowFromDebugEvent } from '../src/services/documentHistoryService.js';
import { buildAnnotationDeleteHistoryRow } from '../src/services/annotationTrashHistory.js';

const user = {
  id: 'user-1',
  email: 'isaiah@example.com',
  user_metadata: { full_name: 'Isaiah Calvo' },
};

function makeOutlineInk({ points, width = 4 } = {}) {
  return createProductionPaperInk({
    id: 'ink-1',
    tool: 'pen',
    color: '#112233',
    width,
    points: points || Array.from({ length: 24 }, (_, i) => ({ x: 300 + i * 5, y: 400 + i * 3 })),
  });
}

test('outline-ink preview is a compact fabric-shaped projection', () => {
  const annotation = makeOutlineInk();
  ok(isOutlineInkAnnotation(annotation), 'fixture is outline ink');
  const preview = projectAnnotationForHistoryPreview(annotation);
  ok(preview, 'preview present');
  equal(preview.type, 'path');
  ok(Array.isArray(preview.path) && preview.path.length > 2, 'path survives in the preview');

  // The projection rebases the absolute outline commands to the visual origin
  // and carries that origin in left/top — the spotlight's translate(left, top)
  // and its rect fallback both land on the stroke's page location.
  ok(preview.left > 290 && preview.left < 310, `left ≈ stroke min x (saw ${preview.left})`);
  ok(preview.top > 390 && preview.top < 410, `top ≈ stroke min y (saw ${preview.top})`);
  const coords = preview.path.flatMap((cmd) => {
    const vals = [];
    for (let i = 1; i + 1 < cmd.length; i += 2) vals.push(cmd[i], cmd[i + 1]);
    return vals;
  });
  ok(Math.min(...coords) >= 0 && Math.min(...coords) < 1, 'path commands are rebased to the origin');
  ok(preview.width > 100 && preview.height > 60, `bounds sized like the stroke (saw ${preview.width}x${preview.height})`);

  // Heavy duplicate geometry must not ride along (it blows the payload cap
  // that protects preview rows and adds nothing to the spotlight).
  equal(preview.polygons, undefined, 'polygons dropped from the preview');
  equal(preview.paperCenterline, undefined, 'paperCenterline dropped from the preview');
});

test('non-ink annotations pass through the projection untouched', () => {
  const rect = {
    type: 'rect', left: 10, top: 20, width: 30, height: 40, scaleX: 1, scaleY: 1,
    strokeWidth: 2, data: { id: 'rect-1', type: 'rect' },
  };
  equal(projectAnnotationForHistoryPreview(rect), rect, 'same reference back');
  // Legacy stroked ink (pre-a3380bbf saves) keeps its fabric-native shape too.
  const legacyInk = {
    type: 'path', left: 50, top: 60, width: 80, height: 40, strokeWidth: 4,
    path: [['M', 0, 0], ['L', 80, 40]], pathOffset: { x: 40, y: 20 },
  };
  equal(projectAnnotationForHistoryPreview(legacyInk), legacyInk, 'legacy ink untouched');
});

test('viewerShared routes history previews through the projection', () => {
  const source = readFileSync(resolve('src/viewerShared.js'), 'utf8');
  match(source, /projectAnnotationForHistoryPreview/,
    'summarizeHistoryActionForLog must project previews (outline-ink spotlight)');
});

test('trim path keeps outline-ink previews path-shaped end to end', () => {
  // A long stroke: enough outline vertices that the RAW object would blow the
  // 4000-char preview clamp, while the rounded projection fits.
  const annotation = makeOutlineInk({
    points: Array.from({ length: 60 }, (_, i) => ({
      x: 120 + i * 7 + Math.sin(i / 3) * 40,
      y: 500 + i * 4 + Math.cos(i / 5) * 30,
    })),
  });
  ok(JSON.stringify(annotation).length > 4000, 'raw outline object exceeds the preview clamp');
  const preview = projectAnnotationForHistoryPreview(annotation);
  const row = buildHistoryEventRowFromDebugEvent({
    type: 'local_annotation_history_added',
    checkpointId: 7,
    actionType: 'delete',
    rawActionType: 'fabric:delete',
    annotationType: 'path',
    pageNumber: 1,
    annotationId: 'ink-1',
    previewAnnotation: preview,
    restoreAction: { type: 'fabric:create', pageNumber: 1, annotationId: 'ink-1', annotation },
    filler: 'x'.repeat(20000), // force the trim path
  }, { documentId: 'doc-1', user });
  equal(row.payload.truncated, true, 'payload should have been trimmed');
  const trimmed = row.payload.previewAnnotation;
  ok(trimmed, 'preview survives trimming');
  ok(Array.isArray(trimmed.path), 'preview stays path-shaped after trimming');
  ok(trimmed.left > 0 && trimmed.top > 0, 'geometry envelope keeps the page location');
  deepEqual(row.payload.restoreAction.annotation.polygons, annotation.polygons,
    'restoreAction keeps full outline geometry for restore fidelity');
});

test('trash-row deletes carry spotlight geometry for outline ink', () => {
  const annotation = makeOutlineInk();
  const row = buildAnnotationDeleteHistoryRow({
    deleteAction: {
      type: 'fabric:delete', pageNumber: 1, annotationId: 'ink-1', annotation, index: 0,
    },
    documentId: 'doc-1',
    userId: 'user-1',
    actorName: 'Isaiah Calvo',
    deletedAt: '2026-07-12T00:00:00.000Z',
  });
  const preview = row.payload.previewAnnotation;
  ok(preview, 'annotation_deleted rows carry a previewAnnotation now');
  ok(Array.isArray(preview.path), 'preview is path-shaped');
  ok(preview.left > 290 && preview.top > 390, 'preview carries the page location');
  equal(preview.polygons, undefined, 'no duplicate geometry in the trash-row preview');
  deepEqual(row.payload.restoreAction.annotation, annotation, 'restore fidelity untouched');
});

test('clamp drops duplicate outline geometry before sacrificing the path', () => {
  // Defense in depth for previews that still carry duplicate outline geometry:
  // polygons/paperCenterline go first, the path only goes if the preview is
  // still oversized without them.
  const inflated = {
    type: 'path', left: 5, top: 6, width: 100, height: 100,
    path: Array.from({ length: 80 }, (_, i) => ['L', i, i]),
    polygons: Array.from({ length: 400 }, (_, i) => [[i, i], [i + 1, i], [i, i + 1]]),
    paperCenterline: Array.from({ length: 300 }, (_, i) => ({ x: i, y: i })),
  };
  const row = buildHistoryEventRowFromDebugEvent({
    type: 'local_annotation_history_added',
    checkpointId: 8,
    actionType: 'delete',
    rawActionType: 'fabric:delete',
    annotationType: 'path',
    pageNumber: 1,
    annotationId: 'ink-1',
    previewAnnotation: inflated,
    filler: 'x'.repeat(20000),
  }, { documentId: 'doc-1', user });
  equal(row.payload.truncated, true);
  const trimmed = row.payload.previewAnnotation;
  ok(trimmed, 'preview survives');
  equal(trimmed.polygons, undefined, 'polygons dropped by the clamp');
  equal(trimmed.paperCenterline, undefined, 'paperCenterline dropped by the clamp');
  ok(Array.isArray(trimmed.path), 'path kept once the duplicates are gone');
});
