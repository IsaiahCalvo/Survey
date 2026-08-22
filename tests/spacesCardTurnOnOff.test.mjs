import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-spaces-card-turn-on-off.spec.mjs
// Unique leftover after Spaces card Expand/Collapse: space-card
// Turn on/off (aria-label Turn on/off space / onToggleSpace).
// Distinct from Expand/Collapse and leftover-18 Space CSV / PDF Pages.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('SpacesPanel Turn on/off is handleToggleSpace, not Expand or leftover-18 export', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  const toggleStart = panel.indexOf('className="space-toggle-control"');
  assert.ok(toggleStart > 0, 'space-toggle-control');
  const toggle = panel.slice(toggleStart, panel.indexOf('className="space-card-delete-button"', toggleStart));
  assert.match(toggle, /onToggleSpace\?\.\(space\.id, !isActive\)/);
  assert.match(toggle, /aria-label=\{isActive \? 'Turn off space' : 'Turn on space'\}/);
  assert.match(toggle, /e\.stopPropagation\(\)/);
  assert.doesNotMatch(toggle, /onToggleExpand/);
  assert.doesNotMatch(toggle, /Expand/);
  assert.doesNotMatch(toggle, /Collapse/);
  assert.doesNotMatch(toggle, /onExportSpaceCSV/);
  assert.doesNotMatch(toggle, /onExportSpacePDF/);
  assert.doesNotMatch(toggle, /__e2eSpaces/);

  const handler = panel.slice(
    panel.indexOf('const handleToggleSpace = useCallback'),
    panel.indexOf('const handlePageInputChange = useCallback'),
  );
  assert.match(handler, /onSetActiveSpace\(spaceId\)/);
  assert.match(handler, /onExitSpaceMode\(\)/);
  assert.match(handler, /if \(shouldActivate\)/);
  assert.match(handler, /if \(activeSpaceId === spaceId && onExitSpaceMode\)/);
  assert.doesNotMatch(handler, /setExpandedSpaces/);
  assert.doesNotMatch(handler, /addHistoryCheckpoint/);
  assert.doesNotMatch(handler, /onExportSpaceCSV/);
  assert.doesNotMatch(handler, /onExportSpacePDF/);
  assert.doesNotMatch(handler, /__e2eSpaces/);
  assert.doesNotMatch(handler, /file\.id/);
});

test('PDFViewer activate is single-id, region-gated, and not a history checkpoint', () => {
  const viewer = read('src/PDFViewer.jsx');
  const activate = viewer.slice(
    viewer.indexOf('const handleSetActiveSpace = useCallback'),
    viewer.indexOf('const handleExitSpaceMode = useCallback'),
  );
  assert.match(activate, /spaceHasActivatableRegions\(space\)/);
  assert.match(activate, /This space has no regions yet\. Add a region before activating it\./);
  assert.match(activate, /setActiveSpaceId\(spaceId\)/);
  assert.doesNotMatch(activate, /addHistoryCheckpoint/);
  assert.doesNotMatch(activate, /__e2eSpaces/);
  assert.doesNotMatch(activate, /file\.id/);

  const exit = viewer.slice(
    viewer.indexOf('const handleExitSpaceMode = useCallback'),
    viewer.indexOf('const handleToggleRegionOverlay = useCallback'),
  );
  assert.match(exit, /setActiveSpaceId\(null\)/);
  assert.doesNotMatch(exit, /addHistoryCheckpoint/);

  const pages = viewer.slice(
    viewer.indexOf('const shouldShowPage = useCallback'),
    viewer.indexOf('useEffect(() => {\n    if (!usePdfjsRenderer || !pdfjsLiveStableOverlayEnabled'),
  );
  assert.match(pages, /if \(!activeSpaceId\) \{\s*return true;/s);
  assert.match(pages, /return activeSpacePages\.includes\(pageNumber\)/);

  const overlay = viewer.slice(
    viewer.indexOf('const isRegionOverlayEnabled = useCallback'),
    viewer.indexOf('const isRegionOverlayToggleEnabled = useCallback'),
  );
  assert.match(overlay, /if \(!activeSpaceId \|\| activeSpaceId !== spaceId\)/);

  const orphans = read('src/utils/spaceRegionOrphans.js');
  assert.match(orphans, /export function spaceHasActivatableRegions/);
  assert.match(orphans, /page\.regions\.length > 0/);
});

test('Turn on/off chrome is distinct from Expand/Collapse and leftover-18 export labels', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  const header = panel.slice(
    panel.indexOf('className="space-card-header-controls"'),
    panel.indexOf('className="space-card-delete-button"'),
  );
  assert.match(header, /space-toggle-control/);
  assert.match(header, /Turn off space/);
  assert.match(header, /Turn on space/);
  assert.doesNotMatch(header, /space-card-expand-button/);
  assert.doesNotMatch(header, /Export Space/);
  assert.doesNotMatch(header, /PDF Pages/);
  assert.doesNotMatch(header, /CSV/);

  assert.match(panel, /onExportSpaceCSV\?\.\(spacesExportTarget\.id\)/);
  assert.match(panel, /onExportSpacePDF\?\.\(spacesExportTarget\.id\)/);
  const expandHandler = panel.slice(
    panel.indexOf('const handleToggleExpand = useCallback'),
    panel.indexOf('const handleExitSpace = useCallback'),
  );
  assert.doesNotMatch(expandHandler, /onSetActiveSpace/);
  assert.doesNotMatch(expandHandler, /onExitSpaceMode/);
});
