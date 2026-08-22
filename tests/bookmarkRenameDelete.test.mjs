import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describeBookmarkDeleteConfirm,
  prepareAtomicBookmarkEdit,
} from '../src/sidebar/bookmarkEditUtils.js';

// Source contracts for desktop V-07 leftover: Edit-mode rename + delete
// (group + leaf). Live proof: debug/scenarios/e2e-bookmark-rename-delete.spec.mjs
// Distinct from V-07 create / dnd-kit / New bookmark group, 390 up/down,
// leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('desktop Edit-mode rename + delete controls are named; group clash is type-aware', () => {
  const panel = read('src/sidebar/BookmarksPanel.jsx');
  assert.match(panel, /aria-label=\{isFolder \? `Rename group \$\{item\.name\}` : `Rename bookmark \$\{item\.name\}`\}/);
  assert.match(panel, /aria-label=\{`Bookmark page \$\{item\.name\}`\}/);
  assert.match(panel, /aria-label=\{isFolder \? `Delete group \$\{item\.name\}` : `Delete bookmark \$\{item\.name\}`\}/);
  assert.match(panel, /\{isEditMode \? 'Done' : 'Edit'\}/);
  assert.match(panel, /describeBookmarkDeleteConfirm\(\{ bookmarks, id \}\)/);
  assert.match(panel, /window\.confirm\(message\)/);
  assert.match(panel, /const commitName = \(\) => \{/);
  assert.match(panel, /prepareAtomicBookmarkEdit\(\{/);

  const utils = read('src/sidebar/bookmarkEditUtils.js');
  assert.match(utils, /const kind = bookmark\?\.type === 'folder' \? 'bookmark group' : 'bookmark'/);
  assert.match(utils, /A \$\{kind\} with this name already exists/);

  const folders = [
    { id: 'g1', name: 'Zone A', type: 'folder' },
    { id: 'g2', name: 'Zone B', type: 'folder' },
    { id: 'b1', name: 'Zone A', type: 'bookmark', pageIds: [1] },
  ];
  const clash = prepareAtomicBookmarkEdit({
    bookmarks: folders,
    bookmark: folders[0],
    name: 'Zone B',
    page: '1',
    numPages: 4,
  });
  const share = prepareAtomicBookmarkEdit({
    bookmarks: folders,
    bookmark: folders[1],
    name: 'Zone A',
    page: '1',
    numPages: 4,
  });
  const leafShare = prepareAtomicBookmarkEdit({
    bookmarks: folders,
    bookmark: folders[2],
    name: 'Zone B',
    page: '2',
    numPages: 4,
  });
  assert.equal(clash.ok, false);
  assert.match(clash.error, /bookmark group with this name already exists/);
  // Same-type only: a folder may keep a name a bookmark already uses.
  assert.equal(share.ok, false);
  assert.equal(leafShare.ok, true);
  assert.equal(leafShare.updates.name, 'Zone B');
});

test('group delete confirm counts nested items; empty group and leaf stay distinct', () => {
  const tree = [
    { id: 'g1', name: 'Zone A', type: 'folder', parentId: null },
    { id: 'b1', name: 'Door', type: 'bookmark', parentId: 'g1' },
    { id: 'g2', name: 'Empty', type: 'folder', parentId: null },
    { id: 'lone', name: 'Site', type: 'bookmark', parentId: null },
  ];
  assert.equal(
    describeBookmarkDeleteConfirm({ bookmarks: tree, id: 'g1' }),
    'Delete group "Zone A" and 1 nested item?',
  );
  assert.equal(
    describeBookmarkDeleteConfirm({ bookmarks: tree, id: 'g2' }),
    'Delete group "Empty"?',
  );
  assert.equal(
    describeBookmarkDeleteConfirm({ bookmarks: tree, id: 'lone' }),
    'Delete bookmark "Site"?',
  );

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const handleBookmarkDelete = useCallback\(\(id\) => \{/);
  assert.match(viewer, /addHistoryCheckpoint\(\s*'bookmark:delete'/);
  assert.match(viewer, /applyBookmarkHistorySlice\(getHistorySnapshot\(\), plan\.previous\)/);
  assert.match(viewer, /A \$\{targetBookmark\.type === 'folder' \? 'bookmark group' : 'bookmark'\} with this name already exists/);
});

test('live spec covers rename/delete, clash, cancel, undo, 390 group delete, hub, file.id', () => {
  const spec = read('debug/scenarios/e2e-bookmark-rename-delete.spec.mjs');
  assert.match(spec, /testPdf=spike-120-pages\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop bookmark rename \+ delete intended \+ break \+ edge/);
  assert.match(spec, /390 bookmark group rename is absent; group delete is live/);
  assert.match(spec, /A bookmark group with this name already exists/);
  assert.match(spec, /A bookmark with this name already exists/);
  assert.match(spec, /Delete group "\$\{groupA2\}" and 1 nested item\?/);
  assert.match(spec, /Delete group "\$\{groupB\}"\?/);
  assert.match(spec, /Delete bookmark "\$\{solo\}"\?/);
  assert.match(spec, /Control\+z/);
  assert.match(spec, /390 desktop Edit must be 0/);
  assert.match(spec, /390 folder rename must be 0/);
  assert.match(spec, /hubPreview Edit must be 0/);
  assert.match(spec, /0 0 612 792/);
  assert.match(spec, /Do not stamp/);
  assert.match(spec, /file\.id/);

  const mobile = read('debug/scenarios/e2e-mobile-bookmarks.spec.mjs');
  assert.match(mobile, /Delete bookmark \$\{bravo\}/);
  assert.doesNotMatch(mobile, /Delete group/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});
