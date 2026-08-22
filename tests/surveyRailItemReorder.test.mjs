import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { isLegacyAnnotationHistoryMeta } from '../src/utils/historyHelpers.js';
import { moveItemById } from '../src/reorder/flatReorderUtils.js';
import { compareSurveyMarkersForOrder } from '../src/utils/surveyMarkerOrdering.js';

// Survey-rail item reorder leftover after category reorder.
// Live proof: debug/scenarios/e2e-survey-rail-item-reorder.spec.mjs
// Not category reorder, not item Delete as the GAP, not Copy-to-space.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('expanded-category items wire SortableRearrangeList to reorderSurveyMarkersInCategory on desktop only', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const itemList = rail.slice(
    rail.indexOf('onReorder={(activeId, overId) => reorderSurveyMarkersInCategory(categorySurveyMarkers, activeId, overId)}'),
    rail.indexOf('title="Drag to rearrange"') + 80,
  );
  assert.match(rail, /onReorder=\{\(activeId, overId\) => reorderSurveyMarkersInCategory\(categorySurveyMarkers, activeId, overId\)\}/);
  assert.match(itemList, /title="Drag to rearrange"/);
  assert.match(itemList, /<DragRearrangeHandle/);
  assert.match(read('src/reorder/DragRearrangeHandle.jsx'), /data-drag-rearrange-handle/);

  const itemHandleBlock = rail.slice(
    rail.indexOf('marker rows lose the'),
    rail.indexOf('title="Drag to rearrange"') + 40,
  );
  assert.match(itemHandleBlock, /\{mobileMode \? null : isMarkerSelectable \? \(/);
  assert.match(itemHandleBlock, /<DragRearrangeHandle/);
  assert.doesNotMatch(itemHandleBlock, /Move up/);
  assert.doesNotMatch(itemHandleBlock, /Move down/);
  assert.doesNotMatch(itemHandleBlock, /data-handle=\{`vertex-\$\{/);
  assert.doesNotMatch(itemHandleBlock, /data-counter-nubbin-handle/);
});

test('item reorder writes surveyMarkerOrder, checkpoints, and same-id is a no-op', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const block = rail.slice(
    rail.indexOf('const reorderSurveyMarkersInCategory = useCallback((orderedMarkers, activeId, overId) => {'),
    rail.indexOf('}, [addHistoryCheckpoint, setSurveyMarkers]);'),
  );
  assert.match(block, /if \(!Array\.isArray\(orderedMarkers\) \|\| !overId \|\| activeId === overId\) return;/);
  assert.match(block, /const reorderedMarkers = moveItemById\(orderedMarkers, activeId, overId\);/);
  assert.match(block, /if \(reorderedMarkers === orderedMarkers\) return;/);
  assert.match(block, /addHistoryCheckpoint\('survey-marker:reorder'/);
  assert.match(block, /surveyMarkerOrder: nextOrder/);
  assert.match(block, /const nextOrder = index \+ 1;/);
  assert.doesNotMatch(block, /data-handle=\{`vertex-\$\{/);
  assert.doesNotMatch(block, /data-counter-nubbin-handle/);
  assert.equal(
    isLegacyAnnotationHistoryMeta({ reason: 'survey-marker:reorder' }),
    true,
    'reorder undo reason stays eligible like rename/entity',
  );

  const placed = [
    { id: 'item-a', name: 'item-a', surveyMarkerOrder: 1 },
    { id: 'item-b', name: 'item-b', surveyMarkerOrder: 2 },
  ];
  assert.deepEqual(
    moveItemById(placed, 'item-a', 'item-b').map(({ name }) => name),
    ['item-b', 'item-a'],
  );
  assert.equal(
    moveItemById(placed, 'item-a', 'item-a'),
    placed,
    'self-drop is a no-op',
  );
  assert.equal(
    compareSurveyMarkersForOrder(
      { id: 'item-a', surveyMarkerOrder: 2 },
      { id: 'item-b', surveyMarkerOrder: 1 },
    ) > 0,
    true,
    'custom order 2 sorts after 1',
  );
});

test('DEV item-order seam reads live surveyMarkers, not a static seed', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  assert.match(rail, /window\.__e2eSurveyItemOrder/);
  assert.match(rail, /surveyMarkerOrder: marker\.surveyMarkerOrder/);
  assert.match(rail, /compareSurveyMarkersForOrder/);
  assert.doesNotMatch(rail, /setCopyModeActive\(true\)/);
});
