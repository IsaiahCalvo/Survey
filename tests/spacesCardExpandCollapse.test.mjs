import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-spaces-card-expand-collapse.spec.mjs
// Unique leftover after Spaces region-row Go to page: space-card
// Expand/Collapse (aria-label Expand/Collapse / onToggleExpand).
// Distinct from Turn on/off and leftover-18 Space CSV / PDF Pages.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('SpacesPanel Expand/Collapse is a local Set toggle, not Turn on/off or export', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  const buttonStart = panel.indexOf('className="space-card-expand-button"');
  assert.ok(buttonStart > 0, 'space-card-expand-button');
  const button = panel.slice(buttonStart, panel.indexOf('className="space-name-fit"', buttonStart));
  assert.match(button, /onToggleExpand\(space\.id\)/);
  assert.match(button, /aria-label=\{isExpanded \? 'Collapse' : 'Expand'\}/);
  assert.match(button, /e\.stopPropagation\(\)/);
  assert.doesNotMatch(button, /onToggleSpace/);
  assert.doesNotMatch(button, /Turn on space/);
  assert.doesNotMatch(button, /onExportSpaceCSV/);
  assert.doesNotMatch(button, /onExportSpacePDF/);
  assert.doesNotMatch(button, /__e2eSpaces/);

  const innerStart = panel.indexOf('{isExpanded && (', buttonStart);
  assert.ok(innerStart > buttonStart, 'inner block gated on isExpanded');
  const inner = panel.slice(innerStart, panel.indexOf('onSpaceCreate,', innerStart));
  assert.match(inner, /space-add-pages-input/);
  assert.match(inner, /space-region-row/);

  const toggle = panel.slice(
    panel.indexOf('const handleToggleExpand = useCallback'),
    panel.indexOf('const handleExitSpace = useCallback'),
  );
  assert.match(toggle, /setExpandedSpaces\(prev => \{/);
  assert.match(toggle, /if \(next\.has\(spaceId\)\)/);
  assert.match(toggle, /next\.delete\(spaceId\)/);
  assert.match(toggle, /next\.add\(spaceId\)/);
  assert.doesNotMatch(toggle, /addHistoryCheckpoint/);
  assert.doesNotMatch(toggle, /onToggleSpace/);
  assert.doesNotMatch(toggle, /onExportSpaceCSV/);
  assert.doesNotMatch(toggle, /__e2eSpaces/);
  assert.doesNotMatch(toggle, /file\.id/);
});

test('new spaces auto-expand; Turn on/off and export stay separate handlers', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  const auto = panel.slice(
    panel.indexOf('const newlyAddedIds = spaces'),
    panel.indexOf('previousSpaceIdsRef.current = currentIds'),
  );
  assert.match(auto, /setExpandedSpaces\(prev => \{/);
  assert.match(auto, /newlyAddedIds\.forEach\(id => next\.add\(id\)\)/);

  const spaceToggle = panel.slice(
    panel.indexOf('const handleToggleSpace = useCallback'),
    panel.indexOf('const handlePageInputChange = useCallback'),
  );
  assert.match(spaceToggle, /onSetActiveSpace\(spaceId\)/);
  assert.match(spaceToggle, /onExitSpaceMode\(\)/);
  assert.doesNotMatch(spaceToggle, /setExpandedSpaces/);

  assert.match(panel, /onExportSpaceCSV\?\.\(spacesExportTarget\.id\)/);
  assert.match(panel, /onExportSpacePDF\?\.\(spacesExportTarget\.id\)/);
  assert.doesNotMatch(
    panel.slice(
      panel.indexOf('const handleToggleExpand = useCallback'),
      panel.indexOf('const handleExitSpace = useCallback'),
    ),
    /onExportSpace/,
  );
});

test('expand chrome is distinct from region-row Go to page and leftover-18 export labels', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  const leading = panel.slice(
    panel.indexOf('className="space-card-leading-controls"'),
    panel.indexOf('className="space-name-fit"'),
  );
  assert.match(leading, /space-card-expand-button/);
  assert.match(leading, /aria-label=\{isExpanded \? 'Collapse' : 'Expand'\}/);
  assert.doesNotMatch(leading, /Go to page/);
  assert.doesNotMatch(leading, /region-page-pill/);
  assert.doesNotMatch(leading, /Export Space/);
  assert.doesNotMatch(leading, /PDF Pages/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /addHistoryCheckpoint\('space:create'/);
  const expandHandler = panel.slice(
    panel.indexOf('const handleToggleExpand = useCallback'),
    panel.indexOf('const handleExitSpace = useCallback'),
  );
  assert.doesNotMatch(expandHandler, /addHistoryCheckpoint\('space:update'/);
  assert.doesNotMatch(expandHandler, /addHistoryCheckpoint\('space:create'/);
});
