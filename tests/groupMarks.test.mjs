// Nightly 'group-marks' (Drawboard PDF Pro push 2026-11-12, row B13): Group /
// Ungroup in the mark menu; a click on any member picks the whole group.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURE_FLAGS } from '../src/featureFlags.js';
import { remapPastedGroupIds, stripGroupId } from '../src/utils/annotationGroups.js';
import { buildFamilyClipboard, makePastedMarkOwn, planFamilyPaste } from '../src/utils/familyClipboard.js';

const MENU = readFileSync(new URL('../src/hooks/useAnnotationContextMenu.jsx', import.meta.url), 'utf8');
const VIEWER = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

const rect = (id, left, groupId) => ({
  type: 'rect', left, top: 10, width: 20, height: 10, scaleX: 1, scaleY: 1, angle: 0,
  stroke: '#f00', fill: 'transparent', data: { id, ...(groupId ? { groupId } : {}) },
});

test('group-marks is a Nightly beta flag with an off-by-default row', () => {
  assert.equal(FEATURE_FLAGS['group-marks']?.stage, 'beta');
  const mig = readFileSync(new URL('../supabase/migrations/20261113002000_group_marks_flag.sql', import.meta.url), 'utf8');
  assert.match(mig, /'group-marks', 'off'/);
});

test('copies of a group form their own group; a lone member drops its id', () => {
  const marks = [rect('a', 0, 'g1'), rect('b', 30, 'g1'), rect('c', 60, 'g2'), rect('d', 90)];
  const callouts = [{ id: 'k', groupId: 'g1' }];
  let n = 0;
  remapPastedGroupIds(marks, callouts, () => `fresh-${++n}`);
  assert.equal(marks[0].data.groupId, 'fresh-1');
  assert.equal(marks[1].data.groupId, 'fresh-1');
  assert.equal(callouts[0].groupId, 'fresh-1', 'a callout copied with its group stays in it');
  assert.equal('groupId' in marks[2].data, false, 'g2 came across with one member: no group');
  assert.equal('groupId' in marks[3].data, false);
});

test('planFamilyPaste never joins the copies to the source group', () => {
  const objects = [rect('a', 0, 'g1'), rect('b', 30, 'g1')];
  const clip = buildFamilyClipboard({ pageNumber: 1, objects, indices: [0, 1] });
  const plan = planFamilyPaste(clip, { objects, dx: 5, dy: 5, newId: () => crypto.randomUUID(), pageNumber: 1 });
  const pasted = plan.objects.slice(2);
  assert.equal(pasted.length, 2);
  assert.ok(pasted[0].data.groupId, 'the copies are grouped');
  assert.equal(pasted[0].data.groupId, pasted[1].data.groupId);
  assert.notEqual(pasted[0].data.groupId, 'g1');
  assert.equal(objects[0].data.groupId, 'g1', 'the originals keep their group');
});

test('a mark pasted on its own leaves its group behind', () => {
  const mark = makePastedMarkOwn(rect('a', 0, 'g1'), 'me');
  assert.equal('groupId' in mark.data, false);
  assert.equal(stripGroupId({ groupId: 'x', id: 'c' }).groupId, undefined);
});

test('the mark menu offers Group / Ungroup only with the flag and the viewer handlers', () => {
  assert.match(MENU, /const groupMarksOn = isFeatureOn\('group-marks'\)\s*&& typeof groupSelection === 'function' && typeof ungroupSelection === 'function';/);
  assert.match(MENU, /if \(!groupMarksOn\) return \[\];/);
  // A picked group offers Ungroup instead of Group; one mark greys Group.
  assert.match(MENU, /if \(state\.oneGroup\) return \[item\('Ungroup', 'ungroup', run\(ungroupSelection\)\)\];/);
  assert.match(MENU, /item\('Group', 'group', run\(groupSelection\), state\.canGroup\)/);
  // Survey Markers are never grouped.
  assert.match(MENU, /canGroup: !hasMarkers && list\.length >= 2/);
  // Single-mark, callout and multi-pick menus all carry the rows.
  assert.match(MENU, /\.\.\.groupMenuItems\(\[calloutObj\], \{ calloutIds: \[ctx\.calloutId\] \}\),/);
  assert.match(MENU, /\.\.\.groupMenuItems\(\[menuObj\], \{ indices: \[ctx\.annotationIndex\] \}\),/);
  assert.match(MENU, /\.\.\.groupRows,\s*\.\.\.lockMenuItems\(groupMembers, familySelection\),/);
  // Callout objects go by id, never stamped as ordinary marks.
  assert.match(MENU, /indices: sortedAsc\.filter\(\(idx\) => groupPage\?\.objects\?\.\[idx\]\?\.data\?\.type !== 'callout'\)/);
  // A picked group counts as one mark, so Align greys out (Drawboard).
  assert.match(MENU, /const movable = groupMarksOn && pickedGroupState\.oneGroup\s*\? 1/);
  assert.match(VIEWER, /groupSelection: handleGroupSelected,\s*ungroupSelection: handleUngroupSelected,/);
  // A group of only callouts ungroups even when the page has no marks JSON.
  assert.match(VIEWER, /const page = annotationsByPageRef\.current\?\.\[pageNumber\] \|\| \{ objects: \[\] \};/);
});
