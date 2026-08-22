import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-spaces-create-space.spec.mjs
// Unique leftover after Spaces space-name rename: Create space
// (aria-label="Create space" / handleCreateSpace / handleSpaceCreate).
// Distinct from space-name rename, space-card Delete, leftover-18
// Space CSV / PDF Pages.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('SpacesPanel handleCreateSpace mints via onSpaceCreate without a precomputed name', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  const start = panel.indexOf('const handleCreateSpace = useCallback');
  assert.ok(start > 0, 'handleCreateSpace');
  const create = panel.slice(start, panel.indexOf('const handleRenameSpace = useCallback', start));
  assert.match(create, /if \(!requireSpaceManagement\(\)\) return;/);
  assert.match(create, /onSpaceCreate\(\{\s*assignedPages: \[\]\s*\}\)/s);
  assert.match(create, /Double-click \/ stacked-390 burst-gating also lives in handleSpaceCreate/);
  assert.doesNotMatch(create, /const name = `Space \$\{spaces\.length \+ 1\}`/);
  assert.doesNotMatch(create, /commitSpaceName/);
  assert.doesNotMatch(create, /window\.confirm/);
  assert.doesNotMatch(create, /onExportSpaceCSV/);
  assert.doesNotMatch(create, /__e2eSpaces/);
  assert.doesNotMatch(create, /file\.id/);

  const button = panel.slice(
    panel.indexOf('onClick={handleCreateSpace}'),
    panel.indexOf('<Icon name="plus" size={14} />') + 40,
  );
  assert.match(button, /onClick=\{handleCreateSpace\}/);
  assert.match(button, /aria-label=\{canManageSpaces \? 'Create space' : 'Upgrade to Pro to create spaces'\}/);
  assert.doesNotMatch(button, /space-card-delete-button/);
  assert.doesNotMatch(button, /onExportSpaceCSV/);
});

test('handleSpaceCreate burst-gates before space:create checkpoint and mints from live prev', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const spaceCreateBurstRef = useRef\(0\);/);
  const start = viewer.indexOf('const handleSpaceCreate = useCallback((space) => {');
  assert.ok(start > 0, 'handleSpaceCreate');
  const block = viewer.slice(start, viewer.indexOf('const handleSpaceUpdate = useCallback', start));
  assert.match(block, /if \(!requireSpaceManagement\(\)\) return;/);
  assert.match(block, /if \(now - spaceCreateBurstRef\.current < 320\) return;/);
  const gateAt = block.indexOf('if (now - spaceCreateBurstRef.current < 320) return;');
  const checkpointAt = block.indexOf("addHistoryCheckpoint('space:create'");
  assert.ok(gateAt > 0 && checkpointAt > gateAt, 'burst gate precedes checkpoint');
  assert.match(block, /let generatedName = `Space \$\{counter\}`/);
  assert.match(block, /while \(hasNameConflict\(prev, generatedName/);
  assert.match(block, /id: space\?\.id \|\| crypto\.randomUUID\(\)/);
  assert.doesNotMatch(block, /MAX_SPACE/);
  assert.doesNotMatch(block, /maxSpaces/);
  assert.doesNotMatch(block, /__e2eSpaces/);
  assert.doesNotMatch(block, /file\.id/);
  assert.doesNotMatch(block, /onExportSpaceCSV/);
  assert.doesNotMatch(block, /window\.confirm/);
});

test('Create space chrome is distinct from rename / card Delete / leftover-18 export', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  assert.match(panel, /aria-label=\{canManageSpaces \? 'Create space' : 'Upgrade to Pro to create spaces'\}/);
  assert.match(panel, /aria-label=\{`Rename \$\{space\.name \|\| 'Space'\}`\}/);
  assert.match(panel, /className="space-card-delete-button"/);
  assert.match(panel, /onExportSpaceCSV\?\.\(spacesExportTarget\.id\)/);
  assert.match(panel, /onExportSpacePDF\?\.\(spacesExportTarget\.id\)/);

  const create = panel.slice(
    panel.indexOf('const handleCreateSpace = useCallback'),
    panel.indexOf('const handleRenameSpace = useCallback'),
  );
  assert.doesNotMatch(create, /onSpaceUpdate/);
  assert.doesNotMatch(create, /onSpaceDelete/);
  assert.doesNotMatch(create, /onExportSpaceCSV/);
  assert.doesNotMatch(create, /commitSpaceName/);

  const viewer = read('src/PDFViewer.jsx');
  assert.doesNotMatch(viewer, /MAX_SPACES\s*=/);
  assert.doesNotMatch(viewer, /const MAX_SPACE/);
});
