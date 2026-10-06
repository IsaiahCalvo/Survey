// TEST-PLAN item 55 (2026-10-06): a box-selected group of marks, callouts and
// Survey Markers dragged together is ONE undo step.
//
// Found by the automated test-plan walk (debug/scenarios/test-plan/
// part8-marks.spec.mjs): the group-drag release saved the shapes (+ markers)
// first and wrote the callouts afterwards, so the callouts became a second
// step; and on a document without the CRDT layer the legacy snapshot lane
// added a mid-gesture snapshot that held neither the callouts' start nor the
// markers. Source assertions (the repo's pattern for hooks that need a DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hook = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

test('group drag release writes the callouts before the page save, on the rendered page', () => {
  const start = hook.indexOf("} else if (ds.mode === 'group-move' && ds.groupOriginals) {");
  assert.ok(start > 0, 'group-move release branch found');
  const end = hook.indexOf("} else if (ds.mode === 'text-markup-horizontal') {", start);
  const branch = hook.slice(start, end);
  const live = branch.indexOf('onUpdateCalloutLive(cid,');
  const save = branch.indexOf("action: 'group-move',");
  const close = branch.indexOf('onUpdateCallout(cid, {})');
  assert.ok(live > 0 && save > 0 && close > 0, 'live write, save and close all present');
  assert.ok(live < save, 'callout poses are written before the page save');
  assert.ok(save < close, 'the callout step is closed after the save (a no-op when the save covered it)');
  assert.match(branch, /flushSync\(\(\) => \{\s*for \(const \[cid, orig\] of groupCalloutEntries\)/);
  // the save is built on the page that already holds the moved callouts
  assert.match(branch, /deepClone\(groupCalloutEntries\.length > 0\s*\? \(nudgeLatestRef\.current\.annotations \|\| annotations\)/);
  // exactly one live write per callout on release (no second, later write)
  assert.equal(branch.split('onUpdateCalloutLive(cid,').length - 1, 1);
});

test('a save whose local step holds the whole gesture adds no legacy snapshot', () => {
  assert.match(viewer, /const coversWholeGesture = Boolean\(surveyMarkerFamilyCompanionRef\.current\)\s*\|\| Boolean\(previewBaseline && !isEraserCommit\);/);
  // only when the local push really recorded a step
  assert.match(viewer, /localStepCoversGesture = coversWholeGesture\s*&& localAnnotationUndoRef\.current\[localAnnotationUndoRef\.current\.length - 1\] !== localTopBefore;/);
  const skip = viewer.indexOf("} else if (localStepCoversGesture) {");
  const checkpoint = viewer.indexOf("addHistoryCheckpoint('annotations:save', {");
  assert.ok(skip > 0 && checkpoint > skip, 'the skip branch comes before the legacy checkpoint');
  assert.match(viewer, /pushHistoryDebugEvent\('annotations_checkpoint_skipped_local_gesture_step'/);
});
