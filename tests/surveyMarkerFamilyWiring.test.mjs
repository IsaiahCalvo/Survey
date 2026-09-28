// w53 (2026-09-28) — Survey Markers join the annotation family on the canvas.
// Source assertions (the repo's pattern for JSX / hooks that need a DOM):
// each shared path hands markers to the shared rule in surveyMarkerFamily.js
// instead of skipping them. The pure rules are pinned in
// tests/surveyMarkerFamily.test.mjs; the browser run is in the w53 report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const hook = read('../src/hooks/useSVGInteraction.js');
const layer = read('../src/components/SVGAnnotationLayer.jsx');
const viewer = read('../src/PDFViewer.jsx');
const menu = read('../src/hooks/useAnnotationContextMenu.jsx');
const dispatch = read('../src/utils/contextMenuDiagnostics.js');

test('marquee and lasso pick Survey Markers with the same modifiers as marks', () => {
  assert.match(hook, /resolveSurveyMarkerMarqueeHits\(getSurveyMarkerMembers\?\.\(\) \|\| \[\], marqueeRect, direction\)/);
  assert.match(hook, /updateSelectedMarkers\(marqueeMarkerHits, mq\.altHeld \? 'subtract' : \(mq\.shiftHeld \? 'add' : 'replace'\)\)/);
  assert.match(hook, /resolveSurveyMarkerLassoHits\(getSurveyMarkerMembers\?\.\(\) \|\| \[\], polygon, mode\)/);
});

test('group move and nudge carry the selected markers in the same save', () => {
  // markers move by the same delta, held on the page as one group
  assert.match(hook, /surveyMarkerFamily: \{ move: \{ ids: groupMarkerIds, dx: markerDelta\.dx, dy: markerDelta\.dy \} \}/);
  assert.match(hook, /const markerDelta = clampMarkerGroupDelta\(groupMarkerIds, dx, dy\);/);
  // a Delete of marks carries the selected markers in the same save
  assert.match(hook, /surveyMarkerFamily: \{ deletes: markerIdsToDelete \}/);
  assert.match(hook, /surveyMarkerFamily: \{ move: \{ ids: markerIds, dx: burst\.dx, dy: burst\.dy \} \}/);
  assert.match(hook, /groupMarkerIds: getGroupMarkerIds\(\)/);
  // a drag that starts on a selected marker moves the whole family
  assert.match(layer, /startFamilyGroupMove\(e\);/);
});

test('the viewer writes marker changes to their own store as one undo step', () => {
  const entry = viewer.slice(viewer.indexOf('const handleSaveAnnotations = useCallback'), viewer.indexOf('const handleSaveAnnotations = useCallback') + 1400);
  assert.match(entry, /saveContext\.surveyMarkerFamily/);
  assert.match(entry, /commitSurveyMarkerFamilyPatchRef\.current\?\.\(surveyMarkerFamily\)/);
  assert.match(viewer, /\{ type: 'fabric:document-batch', actions: \[ownerScopedAction, familyCompanion\] \}/);
  assert.match(viewer, /collectSurveyMarkerHistoryActions\(scopedAction\)/);
});

test('markers draw in their place in the one stack, not in a loop on top', () => {
  assert.match(layer, /markerIdsByGap\(/);
  assert.doesNotMatch(layer, /<g className="survey-markers"/);
});

test('right-click on a marker opens the normal menu (not swallowed)', () => {
  assert.doesNotMatch(dispatch, /suppressed — on survey marker/);
  assert.match(dispatch, /kind: 'surveyMarker', surveyMarkerId/);
  assert.match(menu, /ctx\.kind === 'surveyMarker' && ctx\.surveyMarkerId/);
  assert.match(menu, /handleReorderFamily\(ctx\.pageNumber, \{ markerIds: \[ctx\.surveyMarkerId\], direction \}\)/);
});

test('mark restacks on a page with markers go through the family planner', () => {
  const reorder = viewer.slice(viewer.indexOf('const handleReorderAnnotation = useCallback'), viewer.indexOf('const handleReorderAnnotation = useCallback') + 3600);
  assert.match(reorder, /handleReorderFamily\(pageNumber, isCallout/);
});

test('one clipboard: Cmd+C / X / D for any selection, Cmd+V pastes it, menus have Duplicate', () => {
  assert.match(layer, /onCopyFamily\(pageNumber, selection, key === 'x' \? 'cut' : 'copy'\)/);
  assert.match(layer, /onDuplicateFamily\(pageNumber, selection\)/);
  assert.match(viewer, /if \(familyClipboardRef\.current && pasteFamilyAtRef\.current\) \{/);
  assert.match(viewer, /surveyMarkerFamily: \{ creates: plan\.markers \}/);
  assert.match(viewer, /surveyMarkerFamily: \{ deletes: markers\.map\(\(m\) => m\.id\) \}/);
  assert.match(menu, /duplicateItem\(\{ markerIds: \[ctx\.surveyMarkerId\] \}\)/);
  assert.match(menu, /duplicateItem\(\{ calloutIds: \[ctx\.calloutId\] \}\)/);
  assert.match(menu, /duplicateItem\(\{ indices: \[ctx\.annotationIndex\] \}\)/);
  assert.match(menu, /duplicateItem\(familySelection\)/);
  // a single copy clears the family clipboard (one logical clipboard)
  const single = viewer.slice(viewer.indexOf('const handleCopyAnnotation = useCallback'), viewer.indexOf('const handleCopyAnnotation = useCallback') + 900);
  assert.match(single, /setFamilyClipboard\(null\);/);
});
