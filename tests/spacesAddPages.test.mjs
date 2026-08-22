import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-spaces-add-pages.spec.mjs
// Unique leftover after Spaces card Turn on/off: Add pages
// (aria-label="Add pages" / handleAssignPages / handleSpaceAssignPages).
// Distinct from leftover-18 Space CSV / PDF Pages and from Create /
// space-name rename / space-card Delete. Catalog completeness only
// clicked page 1 / rejected 99.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('SpacesPanel Add pages is handleAssignPages, not leftover-18 export or Create', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  const rowStart = panel.indexOf('className="space-add-pages-row"');
  assert.ok(rowStart > 0, 'space-add-pages-row');
  const row = panel.slice(rowStart, panel.indexOf('className="space-page-range-error"', rowStart) + 80);
  assert.match(row, /className="space-add-pages-input"/);
  assert.match(row, /onAssignPages\(space\.id\)/);
  assert.match(row, /aria-label="Add pages"/);
  assert.match(row, /e\.key === 'Enter'/);
  assert.doesNotMatch(row, /onExportSpaceCSV/);
  assert.doesNotMatch(row, /onExportSpacePDF/);
  assert.doesNotMatch(row, /handleCreateSpace/);
  assert.doesNotMatch(row, /commitSpaceName/);
  assert.doesNotMatch(row, /space-card-delete-button/);
  assert.doesNotMatch(row, /__e2eSpaces/);

  const handler = panel.slice(
    panel.indexOf('const handleAssignPages = useCallback'),
    panel.indexOf('React.useEffect(() => {\n    const previousIds = previousSpaceIdsRef.current'),
  );
  assert.match(handler, /parsePageRangeInput\(rawInput/);
  assert.match(handler, /if \(errors\.length > 0\)/);
  assert.match(handler, /onSpaceAssignPages\(spaceId, pages\)/);
  assert.match(handler, /Enter one or more page numbers\./);
  assert.doesNotMatch(handler, /onExportSpaceCSV/);
  assert.doesNotMatch(handler, /onExportSpacePDF/);
  assert.doesNotMatch(handler, /addHistoryCheckpoint/);
  assert.doesNotMatch(handler, /__e2eSpaces/);
  assert.doesNotMatch(handler, /file\.id/);
});

test('handleSpaceAssignPages checkpoints space:update only when new pages exist', () => {
  const viewer = read('src/PDFViewer.jsx');
  const start = viewer.indexOf('const handleSpaceAssignPages = useCallback');
  assert.ok(start > 0, 'handleSpaceAssignPages');
  const block = viewer.slice(start, viewer.indexOf('const cascadeDeleteScopedAppState', start));
  assert.match(block, /const liveSpace = \(spacesRef\.current \|\| \[\]\)\.find\(\(s\) => s\.id === spaceId\)/);
  assert.match(block, /if \(!liveSpace\) return;/);
  assert.match(block, /if \(newPageIds\.length === 0\) return;/);
  assert.match(block, /addHistoryCheckpoint\('space:update'/);
  assert.match(block, /updateKeys: \['assignedPages'\]/);
  assert.match(block, /pageIds: newPageIds/);
  assert.match(block, /label: `Region \$\{pageNumber\}`/);
  assert.match(block, /\[addHistoryCheckpoint, requireSpaceManagement\]/);
  assert.doesNotMatch(block, /onExportSpaceCSV/);
  assert.doesNotMatch(block, /onExportSpacePDF/);
  assert.doesNotMatch(block, /__e2eSpaces/);
  assert.doesNotMatch(block, /window\.confirm/);
});

test('Add pages chrome is distinct from Create / space-name rename / leftover-18 export', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  assert.match(panel, /aria-label="Add pages"/);
  assert.match(panel, /placeholder="Add pages \(e\.g\. 3, 6-9, 12\)"/);
  assert.match(panel, /aria-label=\{canManageSpaces \? 'Create space' : 'Upgrade to Pro to create spaces'\}/);
  assert.match(panel, /aria-label=\{`Rename \$\{space\.name \|\| 'Space'\}`\}/);
  assert.match(panel, /onExportSpaceCSV\?\.\(spacesExportTarget\.id\)/);
  assert.match(panel, /onExportSpacePDF\?\.\(spacesExportTarget\.id\)/);

  const parser = read('src/utils/pageRangeParser.js');
  assert.match(parser, /export const parsePageRangeInput/);
  assert.match(parser, /This page range is out of the valid range/);
  assert.match(parser, /No page numbers provided\./);
});
