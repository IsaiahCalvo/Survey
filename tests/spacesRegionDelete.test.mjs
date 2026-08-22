import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-spaces-region-delete.spec.mjs
// Unique leftover after Spaces region-row Hide/Show: region-row Delete
// (region-delete-button / onRemovePage). Distinct from last-space card
// delete (space-card-delete-button + window.confirm).

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('SpacesPanel region-row Delete is distinct from space-card Delete and has no confirm', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  const rowStart = panel.indexOf('className="region-action-controls"');
  assert.ok(rowStart > 0, 'region-action-controls');
  const row = panel.slice(rowStart, panel.indexOf('</ul>', rowStart));
  assert.match(row, /className="region-delete-button"/);
  assert.match(row, /aria-label="Delete"/);
  assert.match(row, /onClick=\{\(\) => onRemovePage\(space\.id, page\.pageId\)\}/);
  assert.doesNotMatch(row, /window\.confirm/);
  assert.doesNotMatch(row, /Delete this space\?/);
  assert.doesNotMatch(row, /space-card-delete-button/);
  assert.doesNotMatch(row, /__e2eSpaces/);

  const card = panel.slice(
    panel.indexOf('className="space-card-delete-button"'),
    panel.indexOf('className="space-add-pages-row"'),
  );
  assert.match(card, /aria-label="Delete"/);
  assert.match(card, /onDelete\(space\.id\)/);

  const remove = panel.slice(
    panel.indexOf('const handleRemovePage = useCallback'),
    panel.indexOf('const handleRenameRegion = useCallback'),
  );
  assert.match(remove, /if \(!requireSpaceManagement\(\)\) return;/);
  assert.match(remove, /onSpaceRemovePage\(spaceId, pageId\)/);
});

test('handleSpaceRemovePage checkpoints space:update only when the page exists', () => {
  const viewer = read('src/PDFViewer.jsx');
  const start = viewer.indexOf('const handleSpaceRemovePage = useCallback');
  assert.ok(start > 0, 'handleSpaceRemovePage');
  const block = viewer.slice(start, viewer.indexOf('const handleSpaceRenamePage', start));
  assert.match(block, /const livePage = liveSpace\?\.assignedPages\?\.find\(\(p\) => p\.pageId === pageId\)/);
  assert.match(block, /if \(!livePage\) return;/);
  assert.match(block, /addHistoryCheckpoint\('space:update'/);
  assert.match(block, /updateKeys: \['assignedPages'\]/);
  assert.match(block, /cascadeDeleteScopedAppState\(\{/);
  assert.match(block, /reason: 'space-page-delete'/);
  assert.match(block, /filteredPages = \(space\.assignedPages \|\| \[\]\)\.filter\(p => p\.pageId !== pageId\)/);
  assert.match(block, /if \(!target \|\| \(target\.assignedPages \|\| \[\]\)\.length === 0\) \{\s*setActiveSpaceId\(null\);/s);
  assert.match(block, /buildRegionDeleteHistoryRow\(/);
  assert.match(block, /recordAndNotifyDocumentHistoryEvent\(/);
  assert.match(block, /const documentId = pdfFile\?\.id \|\| null;/);
  assert.doesNotMatch(block, /window\.confirm/);
  assert.doesNotMatch(block, /__e2eSpaces/);
});

test('space-card Delete still confirms; region-row Delete does not share that path', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  assert.match(
    panel,
    /if \(window\.confirm\('Delete this space\? This will not delete the pages, only the space assignment\.'\)\)/,
  );
  const confirmAt = panel.indexOf("Delete this space? This will not delete the pages, only the space assignment.");
  const regionDeleteAt = panel.indexOf('className="region-delete-button"');
  assert.ok(confirmAt > 0 && regionDeleteAt > 0);
  assert.ok(
    Math.abs(confirmAt - regionDeleteAt) > 200,
    'region-row Delete must not sit on the space-card confirm string',
  );
});
