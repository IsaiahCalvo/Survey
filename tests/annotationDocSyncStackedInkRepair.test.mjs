import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { getAnnotationsMap, writeAnnotationMark } from '../src/services/annotationDocStore.js';

// RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
// — marks are nested per-field maps in the `marks` map (store v3). Tests that
// seeded a whole { p, o } value write it through the store instead; reads and
// deletes still go to the real map.
function markWriter(doc) {
  const map = getAnnotationsMap(doc);
  return {
    set(key, entry) { writeAnnotationMark(doc, key, entry.p, entry.o); },
    has: (key) => map.has(key),
    delete: (key) => map.delete(key),
    get size() { return map.size; },
  };
}

function ink(id) {
  return {
    type: 'path',
    left: 0,
    top: 0,
    width: 4,
    height: 80,
    path: [['M', 10, 90], ['L', 11, 10], ['L', 13, 10], ['L', 12, 90], ['Z']],
    fill: '#ff0000',
    stroke: 'transparent',
    strokeWidth: 0,
    sourceWidth: 3,
    paperInkGeometry: 'v1',
    paperEraserGeometry: 'v1',
    data: { id, tool: 'pen' },
  };
}

test('handle repair publishes one clean React materialization from one local transaction', async () => {
  const doc = new Y.Doc();
  const map = markWriter(doc); // RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
  map.set('copy-a', { p: 1, o: ink('copy-a') });
  map.set('copy-b', { p: 1, o: ink('copy-b') });

  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'stacked-ink-repair-test',
    doc,
    supabase: null,
    enableLocal: false,
    enableRealtime: false,
  });

  let yjsUpdates = 0;
  let changeCallbacks = 0;
  let callbackObjectCount = null;
  doc.on('update', () => { yjsUpdates += 1; });
  handle.onChange((byPage) => {
    changeCallbacks += 1;
    callbackObjectCount = byPage[1]?.objects?.length ?? 0;
  });

  const result = handle.repairStackedInkDuplicates();

  assert.equal(result.removed, 1);
  assert.equal(yjsUpdates, 1, 'all duplicate deletes share one durable Yjs transaction');
  assert.equal(changeCallbacks, 1, 'local repair explicitly notifies the React bridge once');
  assert.equal(callbackObjectCount, 1);
  assert.equal(handle.getByPage()[1].objects.length, 1);

  map.set('copy-c', { p: 1, o: ink('copy-c') });
  yjsUpdates = 0;
  changeCallbacks = 0;
  const quietResult = handle.repairStackedInkDuplicates({ notify: false });
  assert.equal(quietResult.removed, 1);
  assert.equal(yjsUpdates, 1, 'quiet remote-merge cleanup is still durable');
  assert.equal(changeCallbacks, 0, 'remote bridge can publish the cleaned materialization itself');
  assert.equal(handle.getByPage()[1].objects.length, 1);

  await handle.destroy();
});
