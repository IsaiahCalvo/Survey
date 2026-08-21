import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import {
  SPACES_MAP,
  SPACES_META_KEY,
  docToSpaces,
  getMetaValue,
  migrateSpacesMetaToMap,
  setMetaValue,
  syncSpacesToDoc,
} from '../src/services/annotationDocStore.js';

test('P1-50: keyed map merges concurrent edits to different spaces', () => {
  const left = new Y.Doc();
  const right = new Y.Doc();
  Y.applyUpdate(right, Y.encodeStateAsUpdate(left));

  syncSpacesToDoc(left, [{ id: 's1', name: 'Alpha', assignedPages: [] }]);
  syncSpacesToDoc(right, [{ id: 's2', name: 'Beta', assignedPages: [] }]);

  Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
  Y.applyUpdate(left, Y.encodeStateAsUpdate(right));

  const merged = docToSpaces(left).map((space) => space.id).sort();
  assert.deepEqual(merged, ['s1', 's2']);
  assert.equal(left.getMap(SPACES_MAP).size, 2);
});

test('P1-50: legacy whole-array META migrates into the keyed map', () => {
  const doc = new Y.Doc();
  setMetaValue(doc, SPACES_META_KEY, [
    { id: 'legacy', name: 'Old', assignedPages: [{ pageId: 1, regions: [] }] },
  ]);
  assert.equal(doc.getMap(SPACES_MAP).size, 0);
  assert.equal(migrateSpacesMetaToMap(doc), true);
  assert.equal(docToSpaces(doc)[0].id, 'legacy');
  assert.equal(migrateSpacesMetaToMap(doc), false);
});

test('P1-50: empty map still reads the legacy META snapshot', () => {
  const doc = new Y.Doc();
  setMetaValue(doc, SPACES_META_KEY, [{ id: 'meta-only', name: 'Compat' }]);
  assert.deepEqual(docToSpaces(doc).map((space) => space.id), ['meta-only']);
  assert.equal(getMetaValue(doc, SPACES_META_KEY)[0].id, 'meta-only');
});

test('P1-50: sync writes a compat META snapshot', () => {
  const doc = new Y.Doc();
  syncSpacesToDoc(doc, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  const snapshot = getMetaValue(doc, SPACES_META_KEY);
  assert.equal(snapshot.length, 2);
  assert.deepEqual(snapshot.map((space) => space.id), ['a', 'b']);
});
