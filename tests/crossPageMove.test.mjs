// Owner after Test 46 (2026-10-06): "I should be able to take an annotation
// and move it onto the next page ... once 100% of it is off the edge, it snaps
// onto the next page, and you can do that back and forth."
// Pins the crossing rule (src/utils/crossPageMove.js), the one-step save
// (PDFViewer handleMoveMarksToPage) and the wiring in the drag hook.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  boxOverlapsPage,
  buildCrossPageMovePlan,
  canMarkCrossPages,
  canSelectionCrossPages,
  clampBoxInsidePage,
  crossPageGhostFor,
  crossPageGhostKind,
  resolveCrossPageDrop,
  resolveCrossPageStep,
  setCrossPageGhost,
  translateMovedMark,
  unionBox,
} from '../src/utils/crossPageMove.js';
import {
  applyAnnotationHistoryAction,
  buildAnnotationHistoryAction,
  invertAnnotationHistoryAction,
} from '../src/utils/annotationLocalHistory.js';

// Two pages stacked like the viewer at 50 %: page 1 (612 x 792) at client
// (100, 0), a 10 px gap, page 2 below. 1 page unit = 0.5 px.
// Page matrix = client -> page units: x' = 2 (x - left), y' = 2 (y - top).
const S = 0.5;
const pageAt = (pageNumber, left, top, width = 612, height = 792) => ({
  pageNumber, width, height, matrix: [1 / S, 0, 0, 1 / S, -left / S, -top / S],
  client: { left, top, right: left + width * S, bottom: top + height * S },
});
const P1 = pageAt(1, 100, 0);
const P2 = pageAt(2, 100, 396 + 10);
const PAGES = [P1, P2];
const size = { width: 100, height: 60 };

test('the mark follows the pointer off its page and stays on it until it is 100 % off', () => {
  // grabbed at its top-left corner (offset 0,0)
  const grabOffset = { x: 0, y: 0 };
  // pointer near page 1's bottom: the box hangs over the edge, still page 1
  let step = resolveCrossPageStep({ pages: PAGES, hostPage: 1, pointer: { x: 200, y: 380 }, grabOffset, size });
  assert.equal(step.hostPage, 1);
  assert.equal(step.jumped, false);
  assert.equal(step.box.top, 760); // not clamped — 28 units below the edge (clipped by the page)
  // fully off page 1 but the pointer is in the gap -> stays on page 1 (invisible)
  step = resolveCrossPageStep({ pages: PAGES, hostPage: 1, pointer: { x: 200, y: 401 }, grabOffset, size });
  assert.equal(step.hostPage, 1);
  assert.equal(boxOverlapsPage(step.box, 612, 792), false);
});

test('once fully off and the pointer is over the next page it jumps there, same offset from the pointer', () => {
  const grabOffset = { x: 30, y: 20 }; // grabbed inside the box
  // pointer 30 px into page 2: on page 1 the box top would be 2*(436) - 20 = 852 > 792 -> fully off
  const step = resolveCrossPageStep({ pages: PAGES, hostPage: 1, pointer: { x: 200, y: 436 }, grabOffset, size });
  assert.equal(step.hostPage, 2);
  assert.equal(step.jumped, true);
  // page-2 pointer = (200, 60); box = pointer - offset
  assert.deepEqual(step.box, { left: 170, top: 40, width: 100, height: 60 });
});

test('a box still partly on its page never jumps, even with the pointer over the next page', () => {
  const grabOffset = { x: 0, y: 59 }; // grabbed at the bottom edge
  const step = resolveCrossPageStep({ pages: PAGES, hostPage: 1, pointer: { x: 200, y: 410 }, grabOffset, size });
  // page-1 box top = 820 - 59 = 761 -> still overlaps 0..792
  assert.equal(step.hostPage, 1);
});

test('back and forth: from page 2 it returns to page 1 the same way', () => {
  const grabOffset = { x: 0, y: 59 };
  // pointer high on page 1: on page 2 the box bottom = 2*(390-406) - 59 + 60 = -31 -> fully above page 2
  const step = resolveCrossPageStep({ pages: PAGES, hostPage: 2, pointer: { x: 200, y: 390 }, grabOffset, size });
  assert.equal(step.hostPage, 1);
  assert.equal(step.box.top, 780 - 59);
});

test('pages of different size: the mark keeps its page-unit size and lands inside the smaller page', () => {
  const small = pageAt(2, 100, 406, 300, 400); // a small page below page 1
  const grabOffset = { x: 90, y: 10 };
  const step = resolveCrossPageStep({ pages: [P1, small], hostPage: 1, pointer: { x: 245, y: 420 }, grabOffset, size: { width: 200, height: 60 } });
  assert.equal(step.hostPage, 2);
  assert.equal(step.box.width, 200); // never stretched
  // pointer on the small page = (290, 28) -> box left 200 hangs 100 off its right edge
  const drop = resolveCrossPageDrop({ pages: [P1, small], originPage: 1, hostPage: 2, box: step.box });
  assert.equal(drop.pageNumber, 2);
  assert.deepEqual(drop.box, { left: 100, top: 18, width: 200, height: 60 });
  // a mark bigger than the page is centred on it
  assert.deepEqual(clampBoxInsidePage({ left: 0, top: 0, width: 500, height: 60 }, 300, 400), { left: -100, top: 0, width: 500, height: 60 });
});

test('let go in the gap / off the document / on its own page -> it stays on its page (in-page rule)', () => {
  assert.equal(resolveCrossPageDrop({ pages: PAGES, originPage: 1, hostPage: 1, box: { left: 0, top: 900, width: 10, height: 10 } }), null);
  assert.equal(resolveCrossPageDrop({ pages: PAGES, originPage: 1, hostPage: 3, box: { left: 0, top: 0, width: 10, height: 10 } }), null);
  // pointer far outside every page: no jump at all
  const step = resolveCrossPageStep({ pages: PAGES, hostPage: 1, pointer: { x: 5, y: 2000 }, grabOffset: { x: 0, y: 0 }, size });
  assert.equal(step.hostPage, 1);
});

test('what may cross: ordinary marks yes; Survey / Spaces-linked, callouts, counters, text highlights, imported, locked, id-less no', () => {
  assert.equal(canMarkCrossPages({ type: 'rect', id: 'r1', data: { id: 'r1' } }), true);
  assert.equal(canMarkCrossPages({ type: 'path', id: 'p1', path: [['M', 0, 0]] }), true);
  assert.equal(canMarkCrossPages({ type: 'rect' }), false); // no id
  assert.equal(canMarkCrossPages({ type: 'rect', id: 'a', regionId: 'reg-1' }), false);
  assert.equal(canMarkCrossPages({ type: 'rect', id: 'a', moduleId: 'm-1' }), false);
  assert.equal(canMarkCrossPages({ type: 'group', id: 'a', data: { type: 'callout' } }), false);
  assert.equal(canMarkCrossPages({ type: 'circle', id: 'a', data: { type: 'counter' } }), false);
  assert.equal(canMarkCrossPages({ type: 'rect', id: 'a', data: { type: 'text-markup' } }), false);
  assert.equal(canMarkCrossPages({ type: 'rect', id: 'a', pdfAnnotationId: '12R' }), false);
  assert.equal(canMarkCrossPages({ type: 'rect', id: 'a', data: { lockedBy: 'user-1' } }), false);
  // a selection crosses only whole: no callouts / markers riding along, nothing left behind
  const marks = [{ type: 'rect', id: 'a' }, { type: 'line', id: 'b' }];
  assert.equal(canSelectionCrossPages(marks, { selectedCount: 2 }), true);
  assert.equal(canSelectionCrossPages(marks, { selectedCount: 3 }), false);
  assert.equal(canSelectionCrossPages(marks, { markerCount: 1 }), false);
  assert.equal(canSelectionCrossPages(marks, { calloutCount: 1 }), false);
});

test('the moved mark is translated like an in-page move (left/top, curved-line midpoint)', () => {
  const line = { type: 'line', id: 'l', left: 10, top: 20, data: { midpoint: { x: 50, y: 60 } } };
  const moved = translateMovedMark(line, { left: 10, top: 20 }, 5, -400);
  assert.equal(moved.left, 15);
  assert.equal(moved.top, -380);
  assert.deepEqual(moved.data.midpoint, { x: 55, y: -340 });
  assert.equal(line.left, 10); // input untouched
  assert.deepEqual(unionBox([{ left: 0, top: 0, width: 10, height: 10 }, { left: 20, top: 5, width: 5, height: 20 }]), { left: 0, top: 0, width: 25, height: 25 });
});

test('the move is ONE undo step: one Undo puts the mark back on page 1, one Redo moves it again', () => {
  const rect = { type: 'rect', id: 'r1', left: 50, top: 700, width: 100, height: 60, data: { id: 'r1' } };
  const keep = { type: 'rect', id: 'k1', left: 0, top: 0, width: 5, height: 5, data: { id: 'k1' } };
  const other = { type: 'rect', id: 'o2', left: 1, top: 1, width: 5, height: 5, data: { id: 'o2' } };
  const before = { 1: { objects: [keep, rect] }, 2: { objects: [other] } };
  const movedRect = { ...rect, top: 40 };
  const plan = buildCrossPageMovePlan({ fromPage: before[1], toPage: before[2], marks: [{ id: 'r1', object: movedRect }] });
  assert.deepEqual(plan.fromPage.objects.map((o) => o.id), ['k1']);
  assert.deepEqual(plan.toPage.objects.map((o) => o.id), ['o2', 'r1']);
  assert.deepEqual(plan.toIndices, [1]);
  const action = {
    type: 'fabric:document-batch',
    actions: [
      buildAnnotationHistoryAction({ pageNumber: 1, previousPage: before[1], nextPage: plan.fromPage }),
      buildAnnotationHistoryAction({ pageNumber: 2, previousPage: before[2], nextPage: plan.toPage }),
    ],
  };
  const after = { 1: plan.fromPage, 2: plan.toPage };
  const undone = applyAnnotationHistoryAction(after, invertAnnotationHistoryAction(action));
  assert.deepEqual(undone[1].objects.map((o) => o.id), ['k1', 'r1']);
  assert.equal(undone[1].objects[1].top, 700);
  assert.deepEqual(undone[2].objects.map((o) => o.id), ['o2']);
  const redone = applyAnnotationHistoryAction(undone, action);
  assert.deepEqual(redone[1].objects.map((o) => o.id), ['k1']);
  assert.deepEqual(redone[2].objects.map((o) => o.id), ['o2', 'r1']);
  // never a duplicate: the mark is on exactly one page at every step
  for (const state of [after, undone, redone]) {
    const count = [...state[1].objects, ...state[2].objects].filter((o) => o.id === 'r1').length;
    assert.equal(count, 1);
  }
});

test('an unsafe move changes nothing (mark gone, already on the target, duplicate ids)', () => {
  const a = { type: 'rect', id: 'a' };
  assert.equal(buildCrossPageMovePlan({ fromPage: { objects: [] }, toPage: { objects: [] }, marks: [{ id: 'a', object: a }] }), null);
  assert.equal(buildCrossPageMovePlan({ fromPage: { objects: [a] }, toPage: { objects: [a] }, marks: [{ id: 'a', object: a }] }), null);
  assert.equal(buildCrossPageMovePlan({ fromPage: { objects: [a] }, toPage: { objects: [] }, marks: [{ id: 'a', object: a }, { id: 'a', object: a }] }), null);
});

test('the carried picture belongs to one page of one document', () => {
  setCrossPageGhost({ documentId: 'doc', pageNumber: 2, objects: [], dx: 0, dy: 0 });
  assert.ok(crossPageGhostFor('doc', 2));
  assert.equal(crossPageGhostFor('doc', 1), null);
  assert.equal(crossPageGhostFor('other', 2), null);
  setCrossPageGhost(null);
  assert.equal(crossPageGhostFor('doc', 2), null);
  assert.equal(crossPageGhostKind({ type: 'rect' }), 'rect');
  assert.equal(crossPageGhostKind({ type: 'Textbox' }), 'text');
});

test('wiring: the drag previews / drops through the cross-page hook, Escape cancels, the viewer saves one transaction', () => {
  const hook = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
  assert.match(hook, /if \(crossPageMove\.preview\(ds, e, annotations\?\.objects\)\) \{/);
  assert.match(hook, /const crossPageDropped = \(ds\.mode === 'move' \|\| ds\.mode === 'group-move'\) && crossPageMove\.drop\(ds, e\);/);
  assert.match(hook, /if \(cancelMoveDrag\(\) && event\?\.detail\) event\.detail\.cancelled = true;/);
  assert.match(hook, /crossPageMove\.end\(ds\);\n    \/\/ Reset drag state/);
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /const handleMoveMarksToPage = useCallback/);
  assert.match(viewer, /commitTextMarkupDocumentTransaction\(\s*\{ action, nextByPage: \{ \.\.\.pagesNow, \[from\]: plan\.fromPage, \[to\]: plan\.toPage \} \}/);
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(layer, /data-cross-page-ghost="true"/);
  assert.match(layer, /opacity: \(hideForEdit \|\| hideForCrossPage\) \? 0 : undefined/);
});
