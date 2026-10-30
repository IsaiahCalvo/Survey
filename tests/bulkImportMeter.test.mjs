// 2026-10-28 (first-open speed): the capture stores a PDF's own markup a
// share at a time (src/utils/bulkImportMeter.js) instead of ~3,000 marks in
// one task. These pin what a share holds back, that nothing else is ever
// held, and that a read of the store never takes held marks off the screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BULK_IMPORT_MAX_MARKS,
  BULK_IMPORT_MIN_MARKS,
  bulkImportSliceSize,
  heldImportMarksGone,
  keepHeldImportMarks,
  meterBulkImport,
  nextImportTurn,
} from '../src/utils/bulkImportMeter.js';

const mark = (id) => ({ type: 'path', id, data: { id } });
const ids = (page) => (page?.objects || []).map((object) => object.data.id);

test('a share keeps the first marks of the import in page order and holds the rest', () => {
  const byPage = {
    1: { objects: [mark('mine-1'), mark('imp-1'), mark('imp-2')] },
    2: { objects: [mark('imp-3'), mark('mine-2'), mark('imp-4')] },
    3: { objects: [mark('mine-3')] },
  };
  const bulkKeys = new Set(['imp-1', 'imp-2', 'imp-3', 'imp-4']);
  const { byPage: share, held } = meterBulkImport(byPage, bulkKeys, 3);
  assert.deepEqual(ids(share[1]), ['mine-1', 'imp-1', 'imp-2']);
  assert.deepEqual(ids(share[2]), ['imp-3', 'mine-2'], 'the user\'s own marks always go in');
  assert.equal(share[1], byPage[1], 'an untouched page is the same object');
  assert.equal(share[3], byPage[3]);
  assert.deepEqual([...held], ['imp-4']);
  assert.deepEqual(ids(byPage[2]), ['imp-3', 'mine-2', 'imp-4'], 'the screen\'s pages are not changed');
});

test('nothing is held when the share covers the import, or when there is no import', () => {
  const byPage = { 1: { objects: [mark('imp-1'), mark('mine-1')] } };
  const all = meterBulkImport(byPage, new Set(['imp-1']), 5);
  assert.equal(all.byPage, byPage);
  assert.equal(all.held.size, 0);
  const none = meterBulkImport(byPage, null, 0);
  assert.equal(none.byPage, byPage);
  assert.equal(none.held.size, 0);
  const unlimited = meterBulkImport(byPage, new Set(['imp-1']), Infinity);
  assert.equal(unlimited.byPage, byPage, 'an erase stores every mark at once');
});

test('marks the store already has (another screen imported them) are never held', () => {
  const byPage = { 1: { objects: [mark('imp-1'), mark('imp-2'), mark('imp-3')] } };
  const stored = new Set(['imp-1', 'imp-2']);
  const { byPage: share, held } = meterBulkImport(byPage, new Set(['imp-1', 'imp-2', 'imp-3']), 1, {
    isStored: (key) => stored.has(key),
  });
  assert.deepEqual(ids(share[1]), ['imp-1', 'imp-2', 'imp-3']);
  assert.equal(held.size, 0);
});

test('a read of the store keeps the held marks on screen, once', () => {
  const previous = {
    1: { objects: [mark('mine-1'), mark('imp-1'), mark('imp-2')] },
    2: { objects: [mark('imp-3')] },
  };
  const fromStore = { 1: { objects: [mark('mine-1'), mark('imp-1'), mark('theirs-1')] } };
  const held = new Set(['imp-2', 'imp-3']);
  const next = keepHeldImportMarks(previous, fromStore, held);
  assert.deepEqual(ids(next[1]), ['mine-1', 'imp-1', 'theirs-1', 'imp-2']);
  assert.deepEqual(ids(next[2]), ['imp-3']);
  assert.deepEqual(ids(keepHeldImportMarks(next, next, held)[1]), ids(next[1]), 'never doubled');
  assert.equal(keepHeldImportMarks(previous, fromStore, new Set()), fromStore);
});

test('share size follows the measured cost per mark, within bounds', () => {
  assert.equal(bulkImportSliceSize(0), 40, 'first share: ~1 ms a mark');
  assert.equal(bulkImportSliceSize(0.5), 80);
  assert.equal(bulkImportSliceSize(10), BULK_IMPORT_MIN_MARKS);
  assert.equal(bulkImportSliceSize(0.0001), BULK_IMPORT_MAX_MARKS);
});

test('the next share waits for a task of its own', async () => {
  let ran = false;
  const turn = nextImportTurn().then(() => { ran = true; });
  await Promise.resolve();
  assert.equal(ran, false);
  await turn;
  assert.equal(ran, true);
});

test('the capture hands the store a share and waits for the last one before the import counts as saved', () => {
  const hook = readFileSync(new URL('../src/hooks/useAnnotationDoc.js', import.meta.url), 'utf8');
  assert.match(hook, /meterBulkImport\(\s*capturedByPage,\s*bulkKeys,\s*hasEraserMutation \|\| drain \? Infinity : bulkImportSliceSize/);
  assert.match(hook, /if \(heldImportKeysRef\.current\.size > 0\) scheduleImportTurn\(\);/);
  // whenBulkImportSaved waits for the last share before the handle's checkpoint.
  assert.match(hook, /if \(heldImportKeysRef\.current\.size > 0\) \{\s*const drained = await new Promise/);
  // Both reads of the store keep held marks on screen.
  assert.equal(hook.match(/keepHeldImportMarks\(previousByPage, nextByPage, heldImportKeysRef\.current\)/g)?.length, 2);
});

test('an erase and its undo or redo store the held marks before they read the store back', () => {
  const hook = readFileSync(new URL('../src/hooks/useAnnotationDoc.js', import.meta.url), 'utf8');
  assert.match(hook, /storeHeldImportMarks\(\);\s*const result = await ownerHandle\.commitEraseIntent\(/);
  assert.match(hook, /storeHeldImportMarks\(\);\s*const result = ownerHandle\.applyEraseHistoryTransition\(/);
  assert.match(hook, /storeHeldImportMarks\(\);\s*const result = ownerHandle\.restoreEraseDeletion\(/);
  // A drain stores every held mark, even while a slider drag holds the capture.
  assert.match(hook, /captureIntoStoreRef\.current\?\.\(byPageRef\.current, \{ drain: true \}\)/);
  assert.match(hook, /if \(!drain && capturePauseRef\?\.current\?\.until/);
});

test('a held mark the user deleted is found, so the import is stored before the delete', () => {
  const held = new Set(['imp-2', 'imp-3']);
  const screen = { 1: { objects: [mark('mine-1'), mark('imp-2')] }, 2: { objects: [mark('imp-3')] } };
  assert.equal(heldImportMarksGone(screen, held), null);
  const afterDelete = { 1: { objects: [mark('mine-1')] }, 2: { objects: [mark('imp-3')] } };
  assert.deepEqual([...heldImportMarksGone(afterDelete, held)], ['imp-2']);
  assert.equal(heldImportMarksGone(afterDelete, new Set()), null);

  const hook = readFileSync(new URL('../src/hooks/useAnnotationDoc.js', import.meta.url), 'utf8');
  // Stored first, on the screen as it is now plus the deleted marks; the
  // capture's own write then takes them out (and leaves their tombstones).
  assert.match(hook, /const gone = bulkKeys \? heldImportMarksGone\(capturedByPage, heldImportKeysRef\.current\) : null;\s*if \(gone\?\.size > 0 && heldScreenRef\.current\) \{\s*const drained = h\.applyByPage\(keepHeldImportMarks\(heldScreenRef\.current, capturedByPage, gone\), \{ bulkKeys \}\);/);
  assert.match(hook, /heldScreenRef\.current = heldImportKeysRef\.current\.size > 0 \? capturedByPage : null;/);
});
