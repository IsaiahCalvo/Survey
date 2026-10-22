// w61 (2026-09-28): the selection follows the marks by id when the page list
// changes under it. Before, a selection whose positions were still in range
// was kept as positions, so another screen's delete of an earlier mark slid
// it onto the neighbouring mark and the next Delete removed a mark nobody
// picked (live: scripts/verify-two-tab-delete.mjs --selection-shift).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  indexRemapper, rebasePageCopy, remapDragState, remapSelectedIndices, remapVisualTransform,
  resolveMenuTargets, sameMenuTargets, stampMenuTargetIds,
} from '../src/utils/selectionRemap.js';

const mark = (id) => ({ type: 'rect', left: 0, top: 0, width: 10, height: 10, data: { id, type: 'shape' } });
const legacy = (n) => ({ type: 'rect', left: n, top: 0, width: 10, height: 10 });
const ids = (objects, selected) => [...selected].sort((a, b) => a - b).map((i) => objects[i]?.data?.id ?? `#${i}`);

test('another screen deletes an earlier mark: the selection stays on the picked mark', () => {
  const before = [mark('m0'), mark('m1'), mark('m2')];
  const after = [before[1], before[2]];
  const next = remapSelectedIndices(new Set([1]), before, after);
  assert.deepEqual(ids(after, next), ['m1'], 'still m1, never m2');
});

test('another screen adds or restacks marks: every selected mark stays selected, nothing else joins', () => {
  const before = [mark('a'), mark('b'), mark('c'), mark('d')];
  const inserted = [mark('x'), ...before];
  assert.deepEqual(ids(inserted, remapSelectedIndices(new Set([1, 3]), before, inserted)), ['b', 'd']);
  const restacked = [before[3], before[2], before[1], before[0]];
  assert.deepEqual(ids(restacked, remapSelectedIndices(new Set([0, 2]), before, restacked)).sort(), ['a', 'c']);
});

test('a selected mark that is gone drops out; the rest of the selection stays', () => {
  const before = [mark('a'), mark('b'), mark('c')];
  const after = [before[0], before[2]];
  assert.deepEqual(ids(after, remapSelectedIndices(new Set([1, 2]), before, after)), ['c']);
  assert.equal(remapSelectedIndices(new Set([1]), before, after).size, 0);
});

test('an edit that replaces the object with a new copy keeps the same Set (no re-render)', () => {
  const before = [mark('a'), mark('b')];
  const after = [before[0], { ...before[1], left: 5 }];
  const selected = new Set([1]);
  assert.equal(remapSelectedIndices(selected, before, after), selected);
});

test('a selection set before its list arrived (paste selecting the new mark) is trusted', () => {
  const before = [mark('a')];
  const after = [mark('a'), mark('pasted')];
  assert.deepEqual(ids(after, remapSelectedIndices(new Set([1]), before, after)), ['pasted']);
});

test('legacy id-less marks keep their position while it still holds an id-less mark', () => {
  const before = [legacy(1), legacy(2)];
  const after = [legacy(1), legacy(2)];
  const selected = new Set([1]);
  assert.equal(remapSelectedIndices(selected, before, after), selected);
  const shifted = [mark('new'), legacy(2)];
  assert.equal(remapSelectedIndices(new Set([0]), before, shifted).size, 0, 'never lands on a mark with an id');
  assert.equal(remapSelectedIndices(new Set([5]), before, after).size, 0, 'out of range drops');
});

test('stacked duplicates with one id are handed out in order', () => {
  const before = [mark('d'), mark('d'), mark('z')];
  const after = [mark('z'), before[0], before[1]];
  assert.deepEqual([...remapSelectedIndices(new Set([0, 1]), before, after)].sort(), [1, 2]);
});

test('the delete that follows removes exactly the picked mark', () => {
  // B's page after A deleted m0; B's Delete builds the page minus the
  // selected positions (useSVGInteraction deleteSelected).
  const before = [mark('m0'), mark('m1'), mark('m2')];
  const after = [before[1], before[2]];
  const selected = remapSelectedIndices(new Set([1]), before, after);
  const objects = after.filter((_, index) => !selected.has(index));
  assert.deepEqual(objects.map((o) => o.data.id), ['m2']);
});

test('the SVG interaction hook routes every list change through the remap', () => {
  const source = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
  assert.match(source, /import \{[^}]*\bremapSelectedIndices\b[^}]*\} from '\.\.\/utils\/selectionRemap\.js';/);
  assert.match(source, /const moved = remapDragState\(ds, mapIndex\)/, 'a live drag follows its marks too');
  assert.match(source, /remapSelectedIndices\(selectedIds, anchor\.objects, objects\)/);
  assert.doesNotMatch(source, /if \(i > maxIdx \|\| i < 0\) return new Set\(\);/, 'the position-only rule is gone');
});

test('right-click menu: a mark that slid in the list is still the one acted on; a gone one is skipped', () => {
  const before = [mark('m0'), mark('m1'), mark('m2')];
  const menu = stampMenuTargetIds({ kind: 'annotation', pageNumber: 1, annotationIndex: 1, groupIndices: null }, before);
  assert.equal(menu.annotationTargetId, 'm1');
  const after = [before[1], before[2]]; // another screen deleted m0
  const ctx = resolveMenuTargets(menu, after);
  assert.equal(after[ctx.annotationIndex].data.id, 'm1', 'Delete from the menu removes m1, never m2');
  const gone = resolveMenuTargets(menu, [before[0], before[2]]);
  assert.equal(gone.annotationIndex, -1, 'm1 deleted meanwhile: nothing is acted on');
  assert.equal(gone.targetsGone, true, 'its mark items grey out');
  assert.equal(ctx.targetsGone, false);
  assert.equal(resolveMenuTargets(menu, before).annotationIndex, 1, 'unchanged list: same position');
});

test('right-click menu on a group: members are found by id; gone members drop out', () => {
  const before = [mark('a'), mark('b'), mark('c'), mark('d')];
  const menu = stampMenuTargetIds({ kind: 'group', pageNumber: 1, annotationIndex: null, groupIndices: [1, 3] }, before);
  const after = [mark('x'), before[0], before[1], before[3]]; // c deleted, x added in front
  const ctx = resolveMenuTargets(menu, after);
  assert.deepEqual(ctx.groupIndices.map((i) => after[i].data.id), ['b', 'd']);
  const shrunk = resolveMenuTargets(menu, [before[0], before[2], before[3]]); // b gone
  assert.deepEqual(shrunk.groupIndices.map((i) => [before[0], before[2], before[3]][i].data.id), ['d']);
});

test('right-click menu: id-less legacy targets and menus without targets are left as they were', () => {
  const plain = { kind: 'page', pageNumber: 1, annotationIndex: null, groupIndices: null };
  assert.equal(resolveMenuTargets(stampMenuTargetIds(plain, [mark('a')]), [mark('a')]).annotationIndex, null);
  const legacyMenu = stampMenuTargetIds({ kind: 'annotation', pageNumber: 1, annotationIndex: 0 }, [legacy(1)]);
  assert.equal(resolveMenuTargets(legacyMenu, [legacy(1)]), legacyMenu);
});

test('the context menu notes its targets when it opens and resolves them when it draws', () => {
  const source = readFileSync(new URL('../src/hooks/useAnnotationContextMenu.jsx', import.meta.url), 'utf8');
  assert.match(source, /setAnnotationContextMenu\(stampMenuTargetIds\(\{/);
  assert.match(source, /const ctx = resolveMenuTargets\(/);
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /useAnnotationContextMenu\(\{\s*getPageObjects:/);
  assert.match(viewer, /annotationsByPageNow: annotationsByPage,/);
});

test('right-click menu: stacked duplicates in a group never resolve to one position twice', () => {
  const before = [mark('d'), mark('d'), mark('z')];
  const menu = stampMenuTargetIds({ kind: 'group', pageNumber: 1, annotationIndex: null, groupIndices: [0, 1] }, before);
  const after = [mark('z'), before[0], before[1]];
  const ctx = resolveMenuTargets(menu, after);
  assert.deepEqual([...ctx.groupIndices].sort(), [1, 2]);
  const oneLeft = resolveMenuTargets(menu, [mark('z'), before[1]]);
  assert.deepEqual(oneLeft.groupIndices, [1], 'one copy gone: the other is acted on once');
});

test('right-click menu: a group whose marks are gone but which still holds Survey Markers keeps its items', () => {
  const before = [mark('a')];
  const menu = stampMenuTargetIds({ kind: 'group', pageNumber: 1, groupIndices: [0], groupMarkerIds: ['sm1'] }, before);
  assert.equal(resolveMenuTargets(menu, []).targetsGone, false);
});

test('sameMenuTargets tells a menu drawn for one list from a click against another', () => {
  const before = [mark('m0'), mark('m1'), mark('m2')];
  const menu = stampMenuTargetIds({ kind: 'annotation', pageNumber: 1, annotationIndex: 1 }, before);
  const drawn = resolveMenuTargets(menu, before);
  assert.equal(sameMenuTargets(drawn, resolveMenuTargets(menu, before)), true);
  assert.equal(sameMenuTargets(drawn, resolveMenuTargets(menu, [before[1], before[2]])), false);
});

test('menu items re-check their targets at click time and the selection remap is a layout effect', () => {
  const menuSource = readFileSync(new URL('../src/hooks/useAnnotationContextMenu.jsx', import.meta.url), 'utf8');
  assert.match(menuSource, /if \(!sameMenuTargets\(atClick, ctx\)\)/);
  assert.match(menuSource, /ctx\.targetsGone && !targetFree\(key\)/);
  const hook = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
  const at = hook.indexOf('const selectionAnchorRef');
  assert.ok(at > 0);
  assert.match(hook.slice(at, at + 200), /useLayoutEffect\(\(\) => \{/);
  assert.match(hook, /setSelectedIds\(\(prev\) => \(prev === remappedFrom \? next : prev\)\)/);
});

// Owner report 2026-10-22: a mark vanished while being moved. A live drag and
// its preview hold list positions; a list change mid-drag (another screen's
// delete, the store re-sorting after open) handed both to a neighbour.
test('a live drag and its preview follow the dragged marks when the list changes', () => {
  const before = [mark('a'), mark('b'), mark('c'), mark('d')];
  const after = [before[1], before[3], before[2]]; // a deleted, c and d swapped
  const mapIndex = indexRemapper(before, after);
  const ds = { active: true, mode: 'group-move', annotationIndex: 2, groupOriginals: { 0: { left: 1 }, 2: { left: 3 }, 3: { left: 4 } } };
  const moved = remapDragState(ds, mapIndex);
  assert.equal(after[moved.annotationIndex].data.id, 'c');
  assert.deepEqual(Object.keys(moved.groupOriginals).map((k) => after[k].data.id).sort(), ['c', 'd']);
  assert.deepEqual(moved.groupOriginals[2], { left: 3 });
  const vt = { id: 2, dx: 5, dy: 6, previewObjects: { 2: before[2] }, affectedIds: new Set([0, 2, 3]) };
  const shown = remapVisualTransform(vt, mapIndex);
  assert.equal(shown.id, 2 === moved.annotationIndex ? 2 : moved.annotationIndex);
  assert.equal(shown.previewObjects[moved.annotationIndex], before[2]);
  assert.deepEqual([...shown.affectedIds].map((i) => after[i].data.id).sort(), ['c', 'd']);
  assert.equal(shown.dx, 5);
});

test('a drag on an unchanged list keeps the same objects (no re-render churn)', () => {
  const list = [mark('a'), mark('b')];
  const copy = [...list];
  const mapIndex = indexRemapper(list, copy);
  const ds = { active: true, annotationIndex: 1 };
  const vt = { id: 1, dx: 0, dy: 0 };
  assert.equal(remapDragState(ds, mapIndex), ds);
  assert.equal(remapVisualTransform(vt, mapIndex), vt);
});

test('a group drop keeps each saved position on its own mark after an earlier delete', () => {
  const before = [mark('a'), mark('b'), mark('c')];
  const after = [before[1], before[2]]; // a deleted while b and c are dragged
  const ds = { active: true, groupOriginals: { 1: { left: 1 }, 2: { left: 2 } }, groupIds: { 1: 'b', 2: 'c' }, startObjects: { 1: before[1] } };
  const moved = remapDragState(ds, indexRemapper(before, after));
  assert.deepEqual(moved.groupIds, { 0: 'b', 1: 'c' });
  assert.deepEqual(moved.groupOriginals, { 0: { left: 1 }, 1: { left: 2 } });
  assert.deepEqual(Object.keys(moved.startObjects), ['0']);
});

test('the drag\'s page copy is laid over the new list by id', () => {
  const before = [mark('a'), mark('b'), mark('c')];
  const draggedC = { ...before[2], left: 99 };
  const copy = { objects: [before[0], before[1], draggedC] };
  const after = { objects: [before[1], before[2], mark('d')] }; // a deleted, d added
  const rebased = rebasePageCopy(copy, after);
  assert.deepEqual(rebased.objects.map((o) => o.data.id), ['b', 'c', 'd']);
  assert.equal(rebased.objects[1], draggedC, 'the counter-orbit / resize frame edits c, not its neighbour');
});
