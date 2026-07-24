import test from 'node:test';
import assert from 'node:assert/strict';

import { canEraseCanvasAnnotation } from '../src/lib/collab/permissionScope.js';
import {
  applyAnnotationHistoryAction,
  buildPreciseAnnotationHistoryAction,
  invertAnnotationHistoryAction,
} from '../src/utils/annotationLocalHistory.js';
import {
  materializeCanvasObjectIdentities,
} from '../src/utils/annotationStorageIdentity.js';

test('loaded id-less legacy ink materializes before erase and survives Undo/Redo/cold reload exactly', () => {
  const loadedInk = {
    type: 'path',
    data: { authorId: 'viewer-1', tool: 'pen' },
    path: [['M', 0, 0], ['L', 40, 0]],
    set(values) {
      Object.assign(this, values);
    },
  };
  const canvas = {
    getObjects() {
      return [loadedInk];
    },
  };

  assert.equal(
    canEraseCanvasAnnotation({
      annotation: loadedInk,
      knownSurveyMarkerIds: new Set(),
      canEraseSurveyMarker: null,
      viewerId: 'viewer-1',
      documentOwnerId: 'viewer-1',
    }),
    false,
  );

  materializeCanvasObjectIdentities(canvas, {
    idFactory: () => 'loaded-ink-canonical-id',
  });
  assert.equal(loadedInk.data.id, 'loaded-ink-canonical-id');
  assert.equal(
    canEraseCanvasAnnotation({
      annotation: loadedInk,
      knownSurveyMarkerIds: new Set(),
      canEraseSurveyMarker: null,
      viewerId: 'viewer-1',
      documentOwnerId: 'viewer-1',
    }),
    true,
  );

  const beforePage = JSON.parse(JSON.stringify({ objects: [loadedInk] }));
  assert.equal(beforePage.objects[0].data.id, 'loaded-ink-canonical-id');
  const afterInk = {
    ...beforePage.objects[0],
    paperEraserGeometry: 'v1',
    polygons: [[[[0, 0], [14, 0], [14, 4], [0, 4], [0, 0]]]],
  };
  const afterPage = { objects: [afterInk] };
  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage: beforePage,
    nextPage: afterPage,
    changedIds: ['loaded-ink-canonical-id'],
    changedStorageKeys: ['loaded-ink-canonical-id'],
  });
  const undone = applyAnnotationHistoryAction(
    { 1: afterPage },
    invertAnnotationHistoryAction(action),
  );
  const reloadedAfterUndo = JSON.parse(JSON.stringify(undone));
  const redone = applyAnnotationHistoryAction(reloadedAfterUndo, action);
  const reloadedAfterRedo = JSON.parse(JSON.stringify(redone));
  const undoneAfterReload = applyAnnotationHistoryAction(
    reloadedAfterRedo,
    invertAnnotationHistoryAction(action),
  );

  assert.equal(action?.type, 'fabric:update');
  assert.deepEqual(undone[1].objects, beforePage.objects);
  assert.deepEqual(redone[1].objects, afterPage.objects);
  assert.deepEqual(reloadedAfterRedo[1].objects, afterPage.objects);
  assert.deepEqual(undoneAfterReload[1].objects, beforePage.objects);
});
