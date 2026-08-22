import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-spaces-space-name-rename.spec.mjs
// Unique leftover after Spaces Add pages: space-name rename
// (Rename ${space.name} / commitSpaceName). Distinct from region-row
// Click to rename and from leftover-18 Space CSV / PDF Pages / Create /
// space-card Delete.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('SpacesPanel commitSpaceName falls back on empty and restores Escape / reject', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  const start = panel.indexOf('const commitSpaceName = useCallback');
  assert.ok(start > 0, 'commitSpaceName');
  const commit = panel.slice(start, panel.indexOf('return (', start));
  assert.match(commit, /const fallbackName = space\.name\?\.trim\(\) \|\| 'Space';/);
  assert.match(commit, /const nextName = \(input\.value \|\| ''\)\.trim\(\) \|\| fallbackName;/);
  assert.match(commit, /if \(nextName !== space\.name\)/);
  assert.match(commit, /const ok = onRenameSpace\?\.\(space\.id, nextName\);/);
  assert.match(commit, /if \(ok === false\)/);
  assert.match(commit, /input\.value = fallbackName;/);
  assert.doesNotMatch(commit, /commitRegionRename/);
  assert.doesNotMatch(commit, /__e2eSpaces/);
  assert.doesNotMatch(commit, /file\.id/);

  const field = panel.slice(
    panel.indexOf('className="space-name-fit"'),
    panel.indexOf('className="space-card-header-controls"'),
  );
  assert.match(field, /className="space-name-inline"/);
  assert.match(field, /aria-label=\{`Rename \$\{space\.name \|\| 'Space'\}`\}/);
  assert.match(field, /onBlur=\{\(e\) => \{\s*tip\('Click to rename', 'below'\)\.onBlur\(e\);\s*commitSpaceName\(e\.currentTarget\);/s);
  assert.match(field, /if \(e\.key === 'Enter'\) \{\s*e\.currentTarget\.blur\(\);/);
  assert.match(field, /\} else if \(e\.key === 'Escape'\) \{\s*e\.currentTarget\.value = space\.name \|\| '';/s);
  assert.doesNotMatch(field, /aria-label="Click to rename"/);
  assert.doesNotMatch(field, /commitRegionRename/);
  assert.doesNotMatch(field, /onExportSpaceCSV/);
  assert.doesNotMatch(field, /space-card-delete-button/);
});

test('handleSpaceUpdate name path pre-checks empty / duplicate / same before checkpoint', () => {
  const viewer = read('src/PDFViewer.jsx');
  const start = viewer.indexOf('const handleSpaceUpdate = useCallback');
  assert.ok(start > 0, 'handleSpaceUpdate');
  const block = viewer.slice(start, viewer.indexOf('const handleSpaceAssignPages = useCallback', start));
  assert.match(block, /const liveSpaces = spacesRef\.current \|\| \[\];/);
  assert.match(block, /if \(!liveSpace\) return false;/);
  assert.match(block, /Space name cannot be empty\./);
  assert.match(block, /hasNameConflict\(liveSpaces, trimmedName, \{ getName: \(space\) => space\?\.name, ignoreId: id \}\)/);
  assert.match(block, /A space with this name already exists\. Please choose a different name\./);
  assert.match(block, /if \(liveSpace\.name === trimmedName\) \{\s*return;/s);
  const checkpointAt = block.indexOf("addHistoryCheckpoint('space:update'");
  const conflictAt = block.indexOf('hasNameConflict(liveSpaces, trimmedName');
  assert.ok(conflictAt > 0 && checkpointAt > conflictAt, 'name conflict check precedes checkpoint');
  assert.match(block, /updateKeys: Object\.keys\(nextUpdates\)/);
  assert.doesNotMatch(block, /__e2eSpaces/);
  assert.doesNotMatch(block, /file\.id/);
});

test('space-name rename chrome is distinct from region-row rename / Create / leftover-18', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  assert.match(panel, /aria-label=\{`Rename \$\{space\.name \|\| 'Space'\}`\}/);
  assert.match(panel, /const commitSpaceName = useCallback/);
  assert.match(panel, /const handleRenameSpace = useCallback/);
  assert.match(panel, /aria-label="Click to rename"/);
  assert.match(panel, /aria-label=\{canManageSpaces \? 'Create space' : 'Upgrade to Pro to create spaces'\}/);
  assert.match(panel, /className="space-card-delete-button"/);
  assert.match(panel, /onExportSpaceCSV\?\.\(spacesExportTarget\.id\)/);
  assert.match(panel, /onExportSpacePDF\?\.\(spacesExportTarget\.id\)/);

  const rename = panel.slice(
    panel.indexOf('const handleRenameSpace = useCallback'),
    panel.indexOf('const handleDelete = useCallback'),
  );
  assert.match(rename, /return onSpaceUpdate\(spaceId, \{ name \}\);/);
  assert.doesNotMatch(rename, /onExportSpaceCSV/);
  assert.doesNotMatch(rename, /handleCreateSpace/);
  assert.doesNotMatch(rename, /window\.confirm/);
});
