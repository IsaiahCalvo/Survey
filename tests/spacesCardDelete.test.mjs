import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-spaces-card-delete.spec.mjs
// Unique leftover after Spaces Create space: space-card Delete
// (space-card-delete-button + confirm / handleDelete / onSpaceDelete).
// Distinct from region-row Delete and leftover-18 Space CSV / PDF Pages.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('SpacesPanel handleDelete confirms then calls onSpaceDelete', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  const start = panel.indexOf('const handleDelete = useCallback((spaceId) => {');
  assert.ok(start > 0, 'handleDelete');
  const block = panel.slice(start, panel.indexOf('const handleToggleExpand = useCallback', start));
  assert.match(block, /if \(!requireSpaceManagement\(\)\) return;/);
  assert.match(
    block,
    /if \(window\.confirm\('Delete this space\? This will not delete the pages, only the space assignment\.'\)\)/,
  );
  assert.match(block, /onSpaceDelete\(spaceId\)/);
  assert.doesNotMatch(block, /onRemovePage/);
  assert.doesNotMatch(block, /region-delete-button/);
  assert.doesNotMatch(block, /onExportSpaceCSV/);
  assert.doesNotMatch(block, /onExportSpacePDF/);
  assert.doesNotMatch(block, /handleCreateSpace/);
  assert.doesNotMatch(block, /__e2eSpaces/);
  assert.doesNotMatch(block, /file\.id/);

  const card = panel.slice(
    panel.lastIndexOf('onDelete(space.id)', panel.indexOf('className="space-card-delete-button"')),
    panel.indexOf('className="space-add-pages-row"'),
  );
  assert.match(card, /className="space-card-delete-button"/);
  assert.match(card, /aria-label="Delete"/);
  assert.match(card, /onDelete\(space\.id\)/);
  assert.doesNotMatch(card, /window\.confirm/);
  assert.doesNotMatch(card, /region-delete-button/);
  assert.doesNotMatch(card, /onExportSpaceCSV/);
});

test('handleSpaceDelete checkpoints space:delete then filters the card', () => {
  const viewer = read('src/PDFViewer.jsx');
  const start = viewer.indexOf('const handleSpaceDelete = useCallback((id) => {');
  assert.ok(start > 0, 'handleSpaceDelete');
  const block = viewer.slice(start, viewer.indexOf('const handleSetActiveSpace = useCallback', start));
  assert.match(block, /if \(!requireSpaceManagement\(\)\) return;/);
  const checkpointAt = block.indexOf("addHistoryCheckpoint('space:delete'");
  const filterAt = block.indexOf('setSpaces(prev => prev.filter(s => s.id !== id))');
  assert.ok(checkpointAt > 0 && filterAt > checkpointAt, 'space:delete precedes filter');
  assert.match(block, /cascadeDeleteScopedAppState\(\{\s*spaceId: id,\s*reason: 'space-delete',/);
  assert.match(block, /if \(activeSpaceId === id\) \{\s*setActiveSpaceId\(null\);/s);
  assert.match(block, /if \(selectedSpaceId === id\) \{\s*setSelectedSpaceId\(null\);/s);
  assert.match(block, /const documentId = pdfFile\?\.id \|\| null;/);
  assert.doesNotMatch(block, /window\.confirm/);
  assert.doesNotMatch(block, /onExportSpaceCSV/);
  assert.doesNotMatch(block, /__e2eSpaces/);
  assert.doesNotMatch(block, /spaceCreateBurstRef/);
});

test('space-card Delete is distinct from region-row Delete and leftover-18 export', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  assert.match(panel, /className="space-card-delete-button"/);
  assert.match(panel, /className="region-delete-button"/);
  assert.match(panel, /onExportSpaceCSV\?\.\(spacesExportTarget\.id\)/);
  assert.match(panel, /onExportSpacePDF\?\.\(spacesExportTarget\.id\)/);

  const confirmAt = panel.indexOf("Delete this space? This will not delete the pages, only the space assignment.");
  const regionDeleteAt = panel.indexOf('className="region-delete-button"');
  const handleDeleteAt = panel.indexOf('const handleDelete = useCallback((spaceId) => {');
  assert.ok(confirmAt > 0 && regionDeleteAt > 0 && handleDeleteAt > 0);
  assert.ok(
    Math.abs(confirmAt - regionDeleteAt) > 200,
    'region-row Delete must not sit on the space-card confirm string',
  );
  assert.ok(
    Math.abs(confirmAt - handleDeleteAt) < 400,
    'confirm lives on handleDelete, not the region-row path',
  );

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /onSpaceDelete: handleSpaceDelete/);
  assert.match(viewer, /addHistoryCheckpoint\('space:delete'/);
});
