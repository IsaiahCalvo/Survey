import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-spaces-edit-region-areas.spec.mjs
// Unique leftover after notes Photo/Video: Spaces Edit region areas +
// overlay on/off + last space. Not Create/rename/add-pages as the GAP.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('SpacesPanel exposes Edit region, overlay toggle, and last-space chrome', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  assert.match(panel, /aria-label=\{isActiveRegionEdit \? 'Exit region edit' : 'Edit region areas on the page'\}/);
  assert.match(panel, /onRequestRegionEdit\?\.\(space\.id, page\.pageId\)/);
  assert.match(panel, /onCancelRegionEdit\?\.\(space\.id, page\.pageId\)/);
  assert.match(panel, /Hide overlay for this region/);
  assert.match(panel, /Show overlay for this region/);
  assert.match(panel, /Enable space to toggle overlay/);
  assert.match(panel, /Define regions first to enable overlay/);
  assert.match(panel, /onToggleRegionOverlay\(space\.id, page\.pageId\)/);
  assert.match(panel, /role="switch"/);
  assert.match(panel, /data-region-overlay-toggle="true"/);
  assert.match(panel, /aria-label=\{isActive \? 'Turn off space' : 'Turn on space'\}/);
  assert.match(panel, /className="space-card-delete-button"/);
  assert.match(panel, /No spaces yet/);
});

test('RegionSelectionTool Confirm / Cancel / Escape end the session without inventing persist', () => {
  const rst = read('src/RegionSelectionTool.jsx');
  assert.match(rst, /const handleConfirm = useCallback/);
  assert.match(rst, /onRegionComplete\(payload\)/);
  assert.match(rst, /const handleCancel = useCallback/);
  assert.match(rst, /if \(onCancel\) \{\s*onCancel\(\);/s);
  assert.match(rst, /if \(key === 'escape' && !inEditableTarget\)/);
  assert.match(rst, /handleCancel\(\);/);
  assert.match(rst, /MIN_REGION_SIZE = 5/);
  assert.match(rst, /currentRect\.width > MIN_REGION_SIZE && currentRect\.height > MIN_REGION_SIZE/);
  assert.doesNotMatch(rst, /__e2eSpaces/);
  assert.doesNotMatch(rst, /file\.id/);
});

test('PDFViewer overlay on/off and last-space activate require a drawn region', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const regionOverlayDisabledKey = useMemo/);
  assert.match(viewer, /regionOverlayDisabledKey,/);

  const toggle = viewer.slice(
    viewer.indexOf('const handleToggleRegionOverlay'),
    viewer.indexOf('const isRegionOverlayEnabled'),
  );
  assert.match(toggle, /setRegionOverlayDisabled/);
  assert.match(toggle, /const key = `\$\{spaceId\}-\$\{pageId\}`/);

  const enabled = viewer.slice(
    viewer.indexOf('const isRegionOverlayEnabled'),
    viewer.indexOf('const isRegionOverlayToggleEnabled'),
  );
  assert.match(enabled, /if \(!activeSpaceId \|\| activeSpaceId !== spaceId\)/);
  assert.match(enabled, /hasValidRegionAreas\(page\)/);

  const activate = viewer.slice(
    viewer.indexOf('const handleSetActiveSpace'),
    viewer.indexOf('const handleExitSpaceMode'),
  );
  assert.match(activate, /This space has no regions yet\. Add a region before activating it\./);
  assert.match(activate, /spaceHasActivatableRegions\(space\)/);

  const complete = viewer.slice(
    viewer.indexOf('const handleRegionComplete'),
    viewer.indexOf('// KAL-313 (2026-06-11): region trash journaling'),
  );
  assert.match(complete, /handleSpaceUpdate\(activeSpaceId, \{ assignedPages: updatedPages \}\)/);
  assert.match(complete, /finishRegionEditSession\(\)/);
  assert.match(complete, /wholePageIncluded: false/);

  const update = viewer.slice(
    viewer.indexOf('const handleSpaceUpdate'),
    viewer.indexOf('If assignedPages are being updated'),
  );
  assert.match(update, /addHistoryCheckpoint\('space:update'/);

  const overlay = read('src/SpaceRegionOverlay.jsx');
  assert.match(overlay, /data-space-region-overlay-root=\{pageNumber\}/);
  assert.match(overlay, /data-space-region-overlay-svg=\{pageNumber\}/);
  assert.match(overlay, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
});
