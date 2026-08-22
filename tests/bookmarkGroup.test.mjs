import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for desktop V-07 leftover: New bookmark group /
// Create group / Add bookmark to group. Live proof:
// debug/scenarios/e2e-bookmark-group.spec.mjs
// Distinct from V-07 item create + dnd-kit, mobile up/down, leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('desktop New bookmark group opens the create modal; empty name / empty list / invalid child fail-closed', () => {
  const panel = read('src/sidebar/BookmarksPanel.jsx');
  assert.match(panel, /New bookmark group/);
  assert.match(panel, /const handleCreateFolder = useCallback\(\(\) => \{/);
  assert.match(panel, /setShowBookmarkGroupModal\(true\)/);
  assert.match(panel, /Create bookmark group/);
  assert.match(panel, /Please enter a name for the bookmark group/);
  assert.match(panel, /Please add at least one bookmark to the group/);
  assert.match(panel, /Please ensure all new bookmarks have both a name and a valid page number within the PDF page range\./);
  assert.match(panel, /type: 'folder'/);
  assert.match(panel, /aria-label="Add bookmark to group"/);
  assert.match(panel, /aria-label=\{\(isCollapsed \|\| isVisuallyCollapsed\) \? 'Expand group' : 'Collapse group'\}/);
  assert.match(panel, /handleAddChildBookmark/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.doesNotMatch(mobile, /New bookmark group/);
  assert.doesNotMatch(mobile, /Create bookmark group/);
});

test('Create group and Add-to-group expand the folder so children are visible', () => {
  const panel = read('src/sidebar/BookmarksPanel.jsx');
  assert.match(panel, /const expandFolderOnly = useCallback\(\(folderId, sourceTree = bookmarkTree\) => \{/);
  // handleAddChildBookmark already expanded. Create / Add-to-group now match.
  assert.match(panel, /expandFolderOnly\(folderId\);/);
  assert.match(panel, /expandFolderOnly\(targetGroupId\);/);
  assert.match(panel, /collapsed: item\.type === 'folder' && children\.length \? !expandedFolders\.has\(item\.id\) : undefined/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers create/expand, empty/cancel, existing join, 390 absent, hub, file.id', () => {
  const spec = read('debug/scenarios/e2e-bookmark-group.spec.mjs');
  assert.match(spec, /testPdf=spike-120-pages\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop bookmark group intended \+ break \+ edge/);
  assert.match(spec, /390 bookmark group chrome is absent/);
  assert.match(spec, /desktop Add menu must list New bookmark group/);
  assert.match(spec, /Please enter a name for the bookmark group/);
  assert.match(spec, /Please add at least one bookmark to the group/);
  assert.match(spec, /create must expand so the child is visible/);
  assert.match(spec, /Collapse group/);
  assert.match(spec, /child bookmark must jump to page 3/);
  assert.match(spec, /Add bookmark to group/);
  assert.match(spec, /Existing-list accessible name/);
  assert.match(spec, /390 New bookmark group must be 0/);
  assert.match(spec, /hubPreview New bookmark group must be 0/);
  assert.match(spec, /0 0 612 792/);
  assert.match(spec, /Do not stamp/);
  assert.match(spec, /file\.id/);
});
