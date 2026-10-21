// The legacy backfill yields to the main thread between batches. Rows are
// read before the loop, so an edit or delete another writer makes while it
// is yielding must not be reverted (or a deleted mark resurrected) by a
// later batch importing the stale row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { runBackfill } from '../src/lib/collab/crdtBackfill.js';
import { applyFabricCommit, applyFabricDelete } from '../src/lib/collab/crdtAnnotationBridge.js';

const USER = '11111111-1111-4111-8111-111111111111';

function legacyRow(i, left = i) {
  return {
    annotation_id: `mark-${i}`,
    annotation_type: 'square',
    page_number: 1,
    user_id: USER,
    created_at: '2026-01-01T00:00:00Z',
    annotation_data: {
      pageNumber: 1,
      fabricObject: { type: 'rect', left, top: 10, width: 20, height: 20, stroke: '#d22', strokeWidth: 2, data: { id: `mark-${i}` } },
    },
  };
}

const userOrigin = { source: 'local', userId: USER };

test('edits and deletes made while the backfill yields survive later batches', async () => {
  const ydoc = new Y.Doc();
  const yMap = ydoc.getMap('annotations');
  const rows = Array.from({ length: 80 }, (_, i) => legacyRow(i));
  const args = { ydoc, supabase: {}, documentId: 'doc-1', userId: USER, sessionId: 's', clientID: ydoc.clientID, existingHydrateRows: rows };

  await runBackfill(args);
  assert.equal(yMap.size, 80);
  // The recovery re-import below works from older legacy copies of the rows.
  const staleRows = Array.from({ length: 80 }, (_, i) => legacyRow(i, i + 500));

  // Second run (as the recovery path does, it re-imports every row): change mark-70 and
  // delete mark-75 on the first yield, before their batch is reached.
  let fired = false;
  const afterFirstBatch = () => {
    if (fired) return;
    fired = true;
    yMap.unobserveDeep(afterFirstBatch);
    setTimeout(edit, 0); // runs while the backfill yields after batch 1
  };
  const edit = () => {
    applyFabricCommit(ydoc, yMap, { ...rows[70].annotation_data.fabricObject, stroke: '#00f' }, userOrigin, { userId: USER });
    applyFabricDelete(ydoc, yMap, 'mark-75', userOrigin);
  };
  yMap.observeDeep(afterFirstBatch);
  // Forget the done marker so the import loop runs again over every row.
  for (const key of [...ydoc.getMap('meta').keys()]) ydoc.getMap('meta').delete(key);
  await runBackfill({ ...args, existingHydrateRows: staleRows });

  assert.equal(yMap.get('mark-0').get('fabric').get('left'), 500, 'untouched rows are still imported');
  assert.equal(yMap.get('mark-70').get('fabric').get('stroke'), '#00f', 'edit made during the import is kept');
  assert.equal(yMap.has('mark-75'), false, 'mark deleted during the import is not brought back');
  assert.equal(yMap.size, 79);
});

// A chainable Supabase stand-in: the documents row reads as not yet cut over,
// and the cutover_completed_at write is recorded.
function fakeSupabase(writes) {
  const chain = (table) => {
    const q = {
      select: () => q, eq: () => q, in: () => q, order: () => q, range: () => q, limit: () => q,
      maybeSingle: async () => ({ data: { id: 'doc-2', cutover_completed_at: null }, error: null }),
      single: async () => ({ data: { id: 'doc-2', cutover_completed_at: null }, error: null }),
      update: (values) => { writes.push({ table, values }); return q; },
      then: (resolve) => resolve({ data: [], error: null, count: 0 }),
    };
    return q;
  };
  return { from: chain };
}

test('a mark deleted while the backfill yields does not block the cutover seal', async () => {
  const ydoc = new Y.Doc();
  const yMap = ydoc.getMap('annotations');
  const rows = Array.from({ length: 60 }, (_, i) => legacyRow(i));
  const writes = [];
  let deleted = false;
  const deleteAfterFirstBatch = () => {
    if (deleted || !yMap.has('mark-3')) return;
    deleted = true;
    yMap.unobserveDeep(deleteAfterFirstBatch);
    setTimeout(() => applyFabricDelete(ydoc, yMap, 'mark-3', userOrigin), 0);
  };
  yMap.observeDeep(deleteAfterFirstBatch);
  await runBackfill({
    ydoc, supabase: fakeSupabase(writes), documentId: 'doc-2', userId: USER, sessionId: 's',
    clientID: ydoc.clientID, existingHydrateRows: rows, markCutoverComplete: true,
  });
  assert.equal(yMap.has('mark-3'), false);
  assert.equal(yMap.size, 59);
  assert.ok(writes.some((w) => w.table === 'documents' && w.values.cutover_completed_at), 'cutover sealed');
});
