import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyRemoteSidebarMeta,
  mergePageNameMaps,
  mergeSidebarWrite,
  migrateSidebarData,
} from '../sidebarPersistence.js';

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

test('sidebar migration supplies safe defaults', () => {
  for (const input of [undefined, null, {}, 'nope', 42]) {
    const output = migrateSidebarData(input);
    assert.deepEqual(output.pageNames, {});
    assert.deepEqual(output.bookmarks, []);
    assert.equal(output.hasImportedPdfBookmarks, false);
    assert.deepEqual(output.spaces, []);
    assert.deepEqual(output.pageTransformations, {});
  }
});

test('sidebar migration converts imported PDF bookmarks without mutating input', () => {
  const input = { bookmarks: [{ id: 'b1', source: 'pdf', pageIds: [1] }] };
  const output = migrateSidebarData(input);
  assert.equal(output.bookmarks[0].source, 'user');
  assert.equal(output.bookmarks[0].isFromPDF, false);
  assert.equal(output.hasImportedPdfBookmarks, true);
  assert.equal(input.bookmarks[0].source, 'pdf');
});

test('sidebar migration recognizes all imported bookmark shapes', () => {
  for (const bookmark of [
    { id: 'pdf:1' }, { id: 'pdf-outline-3' }, { sourceId: 'pdfjs:9' },
    { outlinePath: [0, 1] }, { dest: 'somewhere' },
  ]) {
    assert.equal(migrateSidebarData({ bookmarks: [bookmark] }).hasImportedPdfBookmarks, true);
  }
});

test('sidebar migration normalizes every saved page region list', () => {
  const output = migrateSidebarData({
    spaces: [{ id: 's1', assignedPages: [{ pageNumber: 1 }, { pageNumber: 2, regions: [] }] }],
  });
  for (const page of output.spaces[0].assignedPages) assert.ok(Array.isArray(page.regions));
});

test('P1-46: merge-on-write unions page names and keeps this writer\'s bookmark deletes', () => {
  const existing = {
    pageNames: { 1: 'Cover', 2: 'Stale' },
    bookmarks: [{ id: 'keep', name: 'Old', type: 'bookmark' }, { id: 'gone', name: 'Drop' }],
    spaces: [{ id: 's1', name: 'A', assignedPages: [] }],
    pageTransformations: { 1: { rotation: 90 } },
  };
  const incoming = {
    pageNames: { 2: 'Plan', 3: 'New' },
    bookmarks: [{ id: 'keep', name: 'Renamed', type: 'bookmark' }],
    spaces: [{ id: 's2', name: 'B', assignedPages: [] }],
    pageTransformations: { 2: { rotation: 180 } },
    activeSpaceId: 's2',
  };
  const merged = mergeSidebarWrite(existing, incoming);
  assert.deepEqual(merged.pageNames, { 1: 'Cover', 2: 'Plan', 3: 'New' });
  assert.deepEqual(merged.bookmarks, [{ id: 'keep', name: 'Renamed', type: 'bookmark', pageIds: [] }]);
  assert.equal(merged.spaces[0].id, 's2');
  assert.equal(merged.pageTransformations[1].rotation, 90);
  assert.equal(merged.pageTransformations[2].rotation, 180);
  assert.equal(merged.activeSpaceId, 's2');
  assert.deepEqual(mergePageNameMaps({ 1: 'A' }, { 1: 'B', 2: 'C' }), { 1: 'B', 2: 'C' });
});

test('P1-46: unset Y.Doc meta leaves local sidebar state; set meta replaces bookmarks', () => {
  const local = {
    pageNames: { 1: 'Local' },
    bookmarks: [{ id: 'a', name: 'Here' }],
  };
  const unset = applyRemoteSidebarMeta(local, {});
  assert.equal(unset.namesChanged, false);
  assert.equal(unset.bookmarksChanged, false);
  assert.deepEqual(unset.bookmarks, local.bookmarks);

  const remote = applyRemoteSidebarMeta(local, {
    pageNames: { 2: 'Remote' },
    bookmarks: [{ id: 'b', name: 'Shared' }],
  });
  assert.equal(remote.namesChanged, true);
  assert.deepEqual(remote.pageNames, { 1: 'Local', 2: 'Remote' });
  assert.equal(remote.bookmarksChanged, true);
  assert.deepEqual(remote.bookmarks, [{ id: 'b', name: 'Shared' }]);
});

test('P1-46: PDFViewer writes names/bookmarks to Y.Doc meta and merge-on-write localStorage', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /mergeSidebarWrite\(existing/);
  assert.match(viewer, /setMetaValue\(yjsDoc, PAGE_NAMES_META_KEY, pageNames\)/);
  assert.match(viewer, /setMetaValue\(yjsDoc, BOOKMARKS_META_KEY, bookmarks\)/);
  assert.match(viewer, /getMetaValue\(yjsDoc, PAGE_NAMES_META_KEY\)/);
  assert.match(viewer, /getMetaValue\(yjsDoc, BOOKMARKS_META_KEY\)/);
});
