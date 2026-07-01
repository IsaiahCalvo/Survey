import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateSidebarData } from '../sidebarPersistence.js';

test('migrateSidebarData: empty/undefined input yields safe defaults', () => {
  for (const input of [undefined, null, {}, 'nope', 42]) {
    const out = migrateSidebarData(input);
    assert.deepEqual(out.pageNames, {});
    assert.deepEqual(out.bookmarks, []);
    assert.equal(out.hasImportedPdfBookmarks, false);
    assert.deepEqual(out.spaces, []);
    assert.deepEqual(out.pageTransformations, {});
  }
});

test('migrateSidebarData: pageNames + pageTransformations pass through', () => {
  const out = migrateSidebarData({ pageNames: { 1: 'Cover' }, pageTransformations: { 2: 'rotate(90deg)' } });
  assert.deepEqual(out.pageNames, { 1: 'Cover' });
  assert.deepEqual(out.pageTransformations, { 2: 'rotate(90deg)' });
});

test('migrateSidebarData: a pdf-source bookmark is converted to a user bookmark', () => {
  const out = migrateSidebarData({ bookmarks: [{ id: 'b1', title: 'X', source: 'pdf', pageIds: [1] }] });
  assert.equal(out.bookmarks.length, 1);
  assert.equal(out.bookmarks[0].source, 'user');
  assert.equal(out.bookmarks[0].isFromPDF, false);
  assert.ok(Array.isArray(out.bookmarks[0].pageIds));
  assert.equal(out.hasImportedPdfBookmarks, true);
});

test('migrateSidebarData: isFromPDF=true bookmark also converts + flags import', () => {
  const out = migrateSidebarData({ bookmarks: [{ id: 'b2', isFromPDF: true, pageIds: [2] }] });
  assert.equal(out.bookmarks[0].source, 'user');
  assert.equal(out.bookmarks[0].isFromPDF, false);
  assert.equal(out.hasImportedPdfBookmarks, true);
});

test('migrateSidebarData: a plain user bookmark stays as-is (no import flag)', () => {
  const out = migrateSidebarData({ bookmarks: [{ id: 'u1', title: 'Mine', source: 'user', pageIds: [3] }] });
  assert.equal(out.bookmarks[0].source, 'user');
  assert.ok(Array.isArray(out.bookmarks[0].pageIds));
  assert.equal(out.hasImportedPdfBookmarks, false);
});

test('migrateSidebarData: import flag detected via pdf-ish id / outlinePath / dest', () => {
  assert.equal(migrateSidebarData({ bookmarks: [{ id: 'pdf:1' }] }).hasImportedPdfBookmarks, true);
  assert.equal(migrateSidebarData({ bookmarks: [{ id: 'pdf-outline-3' }] }).hasImportedPdfBookmarks, true);
  assert.equal(migrateSidebarData({ bookmarks: [{ id: 'x', sourceId: 'pdfjs:9' }] }).hasImportedPdfBookmarks, true);
  assert.equal(migrateSidebarData({ bookmarks: [{ id: 'x', outlinePath: [0, 1] }] }).hasImportedPdfBookmarks, true);
  assert.equal(migrateSidebarData({ bookmarks: [{ id: 'x', dest: 'somewhere' }] }).hasImportedPdfBookmarks, true);
  assert.equal(migrateSidebarData({ bookmarks: [{ id: 'plain' }] }).hasImportedPdfBookmarks, false);
});

test('migrateSidebarData: spaces preserve structure and normalize each page regions to arrays', () => {
  const out = migrateSidebarData({
    spaces: [{
      id: 's1', name: 'Space 1',
      assignedPages: [{ pageNumber: 1, regions: [] }, { pageNumber: 2, regions: [{ id: 'r1', areas: [] }] }]
    }]
  });
  assert.equal(out.spaces.length, 1);
  assert.equal(out.spaces[0].id, 's1');
  assert.equal(out.spaces[0].name, 'Space 1');
  assert.equal(out.spaces[0].assignedPages.length, 2);
  for (const p of out.spaces[0].assignedPages) assert.ok(Array.isArray(p.regions));
});

test('migrateSidebarData: does not mutate the input blob', () => {
  const input = { bookmarks: [{ id: 'b', source: 'pdf' }] };
  migrateSidebarData(input);
  assert.equal(input.bookmarks[0].source, 'pdf', 'original bookmark untouched');
});
