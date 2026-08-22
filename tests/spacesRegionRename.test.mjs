import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-spaces-region-rename.spec.mjs
// Unique leftover after Spaces Edit region areas: region-row
// Click to rename / commitRegionRename. Not space-name rename.
// Not Edit region areas as the GAP.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('SpacesPanel region-row Click to rename commits on Enter and cancels on Escape', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  const start = panel.indexOf('const commitRegionRename = useCallback');
  assert.ok(start > 0, 'commitRegionRename');
  const commit = panel.slice(start, panel.indexOf('const cancelRegionRename', start));
  assert.match(commit, /const labelToSave = editingRegionValue\.trim\(\);/);
  assert.match(commit, /onRenameRegion\?\.\(space\.id, pageId, labelToSave\)/);

  const cancel = panel.slice(
    panel.indexOf('const cancelRegionRename = useCallback'),
    panel.indexOf('const handleRegionEditClick'),
  );
  assert.match(cancel, /setEditingRegionId\(null\)/);
  assert.match(cancel, /setEditingRegionValue\(''\)/);

  const rowStart = panel.indexOf('{isEditingRegion ? (');
  assert.ok(rowStart > 0, 'isEditingRegion toggle');
  const row = panel.slice(rowStart, panel.indexOf('className="region-action-controls"', rowStart));
  assert.match(row, /aria-label="Click to rename"/);
  assert.match(row, /handleRegionEditClick\(page\.pageId, regionLabel\)/);
  assert.match(row, /if \(e\.key === 'Enter'\) \{\s*e\.preventDefault\(\);\s*commitRegionRename\(page\.pageId\);/s);
  assert.match(row, /\} else if \(e\.key === 'Escape'\) \{\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*cancelRegionRename\(\);/s);
  assert.match(row, /className="region-name-inline"/);
  assert.match(row, /className="region-name-display"/);
  assert.doesNotMatch(row, /aria-label=\{`Rename \$\{space\.name/);
});

test('handleSpaceRenamePage falls back on empty, rejects duplicates, and checkpoints', () => {
  const viewer = read('src/PDFViewer.jsx');
  const start = viewer.indexOf('const handleSpaceRenamePage = useCallback');
  assert.ok(start > 0, 'handleSpaceRenamePage');
  const block = viewer.slice(start, viewer.indexOf('const handleSpaceClearRegions', start));
  assert.match(block, /const candidateLabel = trimmedLabel\.length > 0 \? trimmedLabel : defaultLabel;/);
  assert.match(block, /defaultLabel = `Region \$\{pageId\}`/);
  assert.match(block, /hasNameConflict\(assignedPages, candidateLabel/);
  assert.match(block, /A region with this name already exists in this space/);
  assert.match(block, /addHistoryCheckpoint\('space:update'/);
  assert.match(block, /updateKeys: \['assignedPages'\]/);
  assert.match(block, /if \(!currentPage \|\| getExistingLabel\(currentPage\) === candidateLabel\)/);
  assert.doesNotMatch(block, /__e2eSpaces/);
  assert.doesNotMatch(block, /file\.id/);
});

test('region-row rename is distinct from space-name rename chrome', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  assert.match(panel, /aria-label=\{`Rename \$\{space\.name \|\| 'Space'\}`\}/);
  assert.match(panel, /className="space-name-inline"/);
  assert.match(panel, /const commitSpaceName = useCallback/);
  const regionBtn = panel.slice(
    panel.indexOf('className="region-name-display"'),
    panel.indexOf('className="region-action-controls"'),
  );
  assert.match(regionBtn, /aria-label="Click to rename"/);
  assert.doesNotMatch(regionBtn, /commitSpaceName/);
});
