import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { prepareBookmarkCreate } from '../src/sidebar/bookmarkEditUtils.js';
import { swapBookmarkSiblingOrder } from '../src/sidebar/bookmarkReorderUtils.js';

// Mobile Bookmarks up/down are distinct chrome from desktop dnd-kit (V-07).
// Same store write (`order` swap among same-parent siblings). Not leftover-18.
// Live proof: debug/scenarios/e2e-mobile-bookmarks.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const list = [
  { id: 'a', name: 'Alpha', type: 'bookmark', parentId: null, order: 0, pageIds: [1] },
  { id: 'b', name: 'Bravo', type: 'bookmark', parentId: null, order: 1, pageIds: [1] },
  { id: 'c', name: 'Child', type: 'bookmark', parentId: 'folder', order: 0, pageIds: [2] },
];

test('mobile Bookmarks chrome is up/down buttons, not a 768 tablet shell', () => {
  const panel = read('src/sidebar/BookmarksPanel.jsx');
  assert.match(panel, /swapBookmarkSiblingOrder/);
  assert.match(panel, /aria-label="Move bookmark up"/);
  assert.match(panel, /aria-label="Move bookmark down"/);
  assert.match(panel, /className="mobile-bookmark-list"/);
  assert.match(panel, /handleMobileMoveBookmark/);

  const utils = read('src/sidebar/bookmarkReorderUtils.js');
  assert.match(utils, /export const swapBookmarkSiblingOrder/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /matchMedia\('\(max-width: 720px\)'\)/);
  assert.doesNotMatch(shell, /768px/);
  assert.doesNotMatch(shell, /isTablet|TabletPdfViewerChrome/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /hubLabels = \{ pages: 'Pages', search: 'Search', bookmarks: 'Bookmarks' \}/);

  const sidebar = read('src/PDFSidebar.jsx');
  assert.match(sidebar, /aria-label=\{tab\.label\}/);
  assert.match(sidebar, /label: 'Bookmarks'/);
});

test('swapBookmarkSiblingOrder intended / break / edge', () => {
  assert.deepEqual(swapBookmarkSiblingOrder(list, 'b', -1), [
    { id: 'b', updates: { order: 0 } },
    { id: 'a', updates: { order: 1 } },
  ]);
  assert.deepEqual(swapBookmarkSiblingOrder(list, 'a', 1), [
    { id: 'a', updates: { order: 1 } },
    { id: 'b', updates: { order: 0 } },
  ]);

  assert.deepEqual(swapBookmarkSiblingOrder(list, 'a', -1), []);
  assert.deepEqual(swapBookmarkSiblingOrder(list, 'b', 1), []);
  assert.deepEqual(swapBookmarkSiblingOrder(list, 'missing', -1), []);
  assert.deepEqual(swapBookmarkSiblingOrder(list, 'a', 0), []);
  assert.deepEqual(swapBookmarkSiblingOrder(list, 'a', 1.5), []);
  assert.deepEqual(swapBookmarkSiblingOrder(null, 'a', 1), []);

  const nested = swapBookmarkSiblingOrder(list, 'c', -1);
  assert.deepEqual(nested, []);

  const created = prepareBookmarkCreate({
    bookmarks: list,
    name: 'E2E-New',
    page: '1',
    numPages: 1,
  });
  assert.equal(created.ok, true);

  const empty = prepareBookmarkCreate({ bookmarks: list, name: '  ', page: '1', numPages: 1 });
  assert.equal(empty.ok, false);
  const clash = prepareBookmarkCreate({ bookmarks: list, name: 'Alpha', page: '1', numPages: 1 });
  assert.equal(clash.ok, false);
  const pageZero = prepareBookmarkCreate({ bookmarks: list, name: 'Zed', page: '0', numPages: 1 });
  assert.equal(pageZero.ok, false);
  const pageOverflow = prepareBookmarkCreate({ bookmarks: list, name: 'Zed', page: '99', numPages: 1 });
  assert.equal(pageOverflow.ok, false);
});
