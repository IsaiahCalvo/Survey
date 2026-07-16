import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateSidebarData } from '../sidebarPersistence.js';

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
