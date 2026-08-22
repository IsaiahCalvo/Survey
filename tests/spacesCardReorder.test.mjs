import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { arrayMove } from '@dnd-kit/sortable';
import { isLegacyAnnotationHistoryMeta } from '../src/utils/historyHelpers.js';

// Live proof: debug/scenarios/e2e-spaces-card-reorder.spec.mjs
// Unique leftover after Spaces region-row Delete: space-card reorder
// (Drag to rearrange / onReorderSpaces). Distinct from survey-rail
// category/item reorder and from region-row Delete.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('SpacesPanel space cards wire SortableRearrangeList to onReorderSpaces', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  const listStart = panel.indexOf('{/* Spaces List */}');
  assert.ok(listStart > 0, 'Spaces List');
  const list = panel.slice(listStart, panel.indexOf('export default SpacesPanel'));
  assert.match(list, /<SortableRearrangeList/);
  assert.match(list, /onReorder=\{handleSpaceReorder\}/);
  assert.match(list, /disabled=\{!canManageSpaces \|\| !onReorderSpaces\}/);
  assert.doesNotMatch(list, /Move up/);
  assert.doesNotMatch(list, /Move down/);
  assert.doesNotMatch(list, /__e2eSpaces/);
  assert.doesNotMatch(list, /handleReorderSurveyCategories/);
  assert.doesNotMatch(list, /reorderSurveyMarkersInCategory/);

  const card = panel.slice(
    panel.indexOf('className="space-card-leading-controls"'),
    panel.indexOf('className="space-card-expand-button"'),
  );
  assert.match(card, /<DragRearrangeHandle/);
  assert.match(card, /data-space-drag-handle/);
  assert.match(card, /title="Drag to rearrange"/);
  assert.match(card, /aria-label="Drag to rearrange"/);

  const reorder = panel.slice(
    panel.indexOf('const handleSpaceReorder = useCallback'),
    panel.indexOf('const handleSpaceDragStart = useCallback'),
  );
  assert.match(reorder, /if \(!requireSpaceManagement\(\)\) return;/);
  assert.match(reorder, /if \(activeId === overId\) return;/);
  assert.match(reorder, /onReorderSpaces\(fromIndex, toIndex\)/);

  assert.match(read('src/reorder/DragRearrangeHandle.jsx'), /data-drag-rearrange-handle/);
});

test('handleReorderSpaces checkpoints space:update only on a real move', () => {
  const viewer = read('src/PDFViewer.jsx');
  const start = viewer.indexOf('const handleReorderSpaces = useCallback((fromIndex, toIndex) => {');
  assert.ok(start > 0, 'handleReorderSpaces');
  const block = viewer.slice(start, viewer.indexOf('// Helper function to get user initials'));
  assert.match(block, /if \(!requireSpaceManagement\(\)\) return;/);
  assert.match(block, /const live = spacesRef\.current \|\| \[\];/);
  assert.match(block, /fromIndex === toIndex/);
  assert.match(block, /addHistoryCheckpoint\('space:update'/);
  assert.match(block, /updateKeys: \['order'\]/);
  assert.match(block, /const reordered = arrayMove\(prev, fromIndex, toIndex\)/);
  assert.doesNotMatch(block, /addHistoryCheckpoint\('space:create'/);
  assert.doesNotMatch(block, /addHistoryCheckpoint\('space:delete'/);
  assert.doesNotMatch(block, /__e2eSpaces/);
  assert.doesNotMatch(block, /file\.id/);

  const wallsFirst = [{ name: 'Space 1' }, { name: 'Space 2' }];
  assert.deepEqual(
    arrayMove(wallsFirst, 0, 1).map(({ name }) => name),
    ['Space 2', 'Space 1'],
  );
  assert.deepEqual(
    arrayMove(wallsFirst, 0, 0).map(({ name }) => name),
    ['Space 1', 'Space 2'],
    'self-drop keeps the same order',
  );
  assert.equal(
    isLegacyAnnotationHistoryMeta({ reason: 'space:update' }),
    true,
    'space:update undo reason stays eligible; reorder does not invent a new reason',
  );
});

test('space-card reorder stays distinct from survey-rail reorder and region-row Delete', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  const card = panel.slice(
    panel.indexOf('className="space-card-leading-controls"'),
    panel.indexOf('className="space-card-expand-button"'),
  );
  assert.match(card, /data-space-drag-handle/);
  assert.match(card, /aria-label="Drag to rearrange"/);
  assert.doesNotMatch(card, /region-delete-button/);
  assert.doesNotMatch(card, /space-card-delete-button/);

  const rail = read('src/SurveySpacesRail.jsx');
  assert.match(rail, /title="Drag to rearrange"/);
  assert.match(rail, /handleReorderSurveyCategories/);
  assert.doesNotMatch(
    rail.slice(
      rail.indexOf('title="Drag to rearrange"'),
      rail.indexOf('title="Drag to rearrange"') + 200,
    ),
    /onReorderSpaces/,
  );
});
