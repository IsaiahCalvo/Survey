import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCounterSeriesDeletionUpdates } from '../src/utils/counterNumbering.js';
import {
  applyAnnotationHistoryAction,
  buildAnnotationHistoryAction,
  filterAnnotationHistoryActionByOwner,
  invertAnnotationHistoryAction,
} from '../src/utils/annotationLocalHistory.js';

test('counter series deletion plans only affected pages without mutating annotations', () => {
  const targetA = { type: 'circle', id: 'target-a', data: { type: 'counter', seriesId: 'series-target' } };
  const targetB = { type: 'circle', id: 'target-b', data: { type: 'counter', seriesId: 'series-target' } };
  const otherCounter = { type: 'circle', id: 'other-counter', data: { type: 'counter', seriesId: 'series-other' } };
  const shape = { type: 'rect', id: 'shape' };
  const annotationsByPage = {
    1: { version: '5.3.0', objects: [targetA, shape] },
    2: { version: '5.3.0', objects: [otherCounter, targetB] },
    3: { version: '5.3.0', objects: [shape] },
  };
  const originalSnapshot = structuredClone(annotationsByPage);

  const result = buildCounterSeriesDeletionUpdates(annotationsByPage, 'series-target');

  assert.equal(result.removedCount, 2);
  assert.deepEqual(result.updates, [
    { pageKey: '1', json: { version: '5.3.0', objects: [shape] }, removedCount: 1 },
    { pageKey: '2', json: { version: '5.3.0', objects: [otherCounter] }, removedCount: 1 },
  ]);
  assert.deepEqual(annotationsByPage, originalSnapshot);
  assert.notStrictEqual(result.updates[0].json, annotationsByPage[1]);
  assert.notStrictEqual(result.updates[0].json.objects, annotationsByPage[1].objects);
});

test('one document batch deletes, restores, and re-deletes a series across pages', () => {
  const first = { type: 'circle', data: { id: 'first', type: 'counter', seriesId: 'series-target' }, meta: { authorId: 'owner' } };
  const second = { type: 'circle', data: { id: 'second', type: 'counter', seriesId: 'series-target' }, meta: { authorId: 'owner' } };
  const survivor = { type: 'rect', data: { id: 'survivor' }, meta: { authorId: 'owner' } };
  const before = {
    1: { version: '5.3.0', objects: [first, survivor] },
    2: { version: '5.3.0', objects: [second] },
  };
  const plan = buildCounterSeriesDeletionUpdates(before, 'series-target');
  const action = {
    type: 'fabric:document-batch',
    actions: plan.updates.map(({ pageKey, json }) => buildAnnotationHistoryAction({
      pageNumber: Number(pageKey),
      previousPage: before[pageKey],
      nextPage: json,
    })),
  };

  const deleted = applyAnnotationHistoryAction(before, action);
  assert.deepEqual(deleted[1].objects, [survivor]);
  assert.deepEqual(deleted[2].objects, []);

  const restored = applyAnnotationHistoryAction(deleted, invertAnnotationHistoryAction(action));
  assert.deepEqual(restored, before, 'one undo restores both pages and original object order');

  const deletedAgain = applyAnnotationHistoryAction(restored, action);
  assert.deepEqual(deletedAgain, deleted, 'one redo removes the entire series again');
});

test('document batch owner filtering keeps the complete atomic action for collaborators (never a partial subset)', () => {
  const own = {
    type: 'fabric:delete',
    pageNumber: 1,
    annotation: { data: { id: 'own' }, meta: { authorId: 'viewer' } },
  };
  const foreign = {
    type: 'fabric:delete',
    pageNumber: 2,
    annotation: { data: { id: 'foreign' }, meta: { authorId: 'someone-else' } },
  };
  const action = { type: 'fabric:document-batch', actions: [own, foreign] };

  // RULED 2026-09-28 owner: open editing + lock — a collaborator's edits on anyone's marks are their own Undo step, so the whole batch is kept.
  assert.equal(
    filterAnnotationHistoryActionByOwner(action, 'viewer', 'owner'),
    action,
    'collaborator retains the complete atomic action',
  );
  // RULED 2026-09-28 owner: open editing + lock — only an unknown viewer is refused.
  assert.equal(filterAnnotationHistoryActionByOwner(action, null, 'owner'), null);
  assert.equal(
    filterAnnotationHistoryActionByOwner(action, 'owner', 'owner'),
    action,
    'document owner retains the complete atomic action',
  );
});

test('document batch never partially filters a mixed-author page batch', () => {
  const mixedPage = {
    type: 'fabric:batch',
    pageNumber: 1,
    created: [],
    updated: [],
    deleted: [
      { id: 'own', annotation: { data: { id: 'own' }, meta: { authorId: 'viewer' } } },
      { id: 'foreign', annotation: { data: { id: 'foreign' }, meta: { authorId: 'other' } } },
    ],
  };
  const mixedBatch = { type: 'fabric:document-batch', actions: [mixedPage] };
  // RULED 2026-09-28 owner: open editing + lock — the mixed batch is kept whole (was refused whole) — still never the viewer-owned subset.
  assert.equal(
    filterAnnotationHistoryActionByOwner(mixedBatch, 'viewer', 'owner'),
    mixedBatch,
    'a series delete must never retain only the viewer-owned subset on one page',
  );
  const confirmed = {
    type: 'fabric:document-batch',
    confirmedCrossAuthorDelete: true,
    actions: [mixedPage],
  };
  assert.deepEqual(
    filterAnnotationHistoryActionByOwner(confirmed, 'viewer', 'owner'),
    confirmed,
    'an explicitly confirmed cross-author series delete remains one complete undo action',
  );

  const inverse = invertAnnotationHistoryAction(confirmed);
  assert.equal(inverse.confirmedCrossAuthorDelete, true);
  assert.deepEqual(
    filterAnnotationHistoryActionByOwner(inverse, 'viewer', 'owner'),
    inverse,
    'the confirmation scope survives inversion so collaborator undo restores the full series',
  );
});
