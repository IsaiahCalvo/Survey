// w53 (2026-09-28) — one clipboard for a mixed selection + Duplicate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFamilyClipboard,
  orderPastedFamily,
  planFamilyPaste,
} from '../src/utils/familyClipboard.js';
import { buildFamilyStack, markIdOf } from '../src/utils/surveyMarkerFamily.js';

const rect = (id, left, top, extra = {}) => ({
  type: 'rect', left, top, width: 20, height: 10, scaleX: 1, scaleY: 1, angle: 0,
  stroke: '#f00', fill: 'transparent', data: { id }, ...extra,
});
const calloutObject = (id) => ({ type: 'group', left: 0, top: 0, data: { id, type: 'callout' } });
const callout = (id) => ({
  id,
  pageNumber: 1,
  arrowTip: { x: 0.1, y: 0.1 },
  knee: { x: 0.15, y: 0.1 },
  textBoxPosition: { x: 0.2, y: 0.05 },
  textBoxWidth: 0.1,
  textBoxHeight: 0.05,
  meta: { authorId: 'someone' },
});
const marker = (id, x) => ({
  id,
  record: {
    pageNumber: 1,
    bounds: { x, y: 300, width: 40, height: 20, angle: 0 },
    moduleId: 'mod-a',
    categoryId: 'cat-1',
    name: 'Door 1',
    entityColor: '#00f',
    excelSync: { rowId: 'ROW-1' },
    excelRowIndex: 4,
    checklistResponses: { q1: 'yes' },
    userId: 'someone',
  },
  categoryName: 'Doors',
});

const A = rect('a', 100, 100);
const B = rect('b', 200, 100);
const C = calloutObject('c1');
const objects = [A, C, B];

test('the clipboard holds marks, callouts and markers in their stacking order', () => {
  const clip = buildFamilyClipboard({
    pageNumber: 1,
    objects,
    indices: [0, 2],
    callouts: [callout('c1')],
    markers: [marker('m1', 50)],
    pageMarkers: [{ id: 'm1', stack: { after: 'c1', before: 'b', order: 0 } }],
  });
  assert.deepEqual(clip.items.map((item) => item.kind), ['mark', 'callout', 'marker', 'mark']);
  assert.deepEqual(clip.origin, { left: 50, top: 792 * 0.05 });
  // No Excel identity or answers travel with a copied Survey Marker.
  const entry = clip.items[2].entry;
  assert.equal(entry.excelSync, undefined);
  assert.equal(entry.excelRowIndex, undefined);
  assert.equal(entry.checklistResponses, undefined);
  assert.equal(entry.categoryId, 'cat-1');
});

test('a paste makes every item new, moved, scoped and in the copied order on top', () => {
  const clip = buildFamilyClipboard({
    pageNumber: 1,
    objects,
    indices: [0, 2],
    callouts: [callout('c1')],
    markers: [marker('m1', 50)],
    pageMarkers: [{ id: 'm1', stack: { after: 'c1', before: 'b', order: 0 } }],
  });
  let n = 0;
  const plan = planFamilyPaste(clip, {
    objects,
    dx: 16,
    dy: 16,
    scope: { selectedModuleId: 'mod-b', stampRegionId: false, activeRegionId: null },
    newId: () => `new-${(n += 1)}`,
    authorId: 'me',
    userId: 'me',
    pageNumber: 1,
    resolveMarker: () => ({ moduleId: 'mod-b', categoryId: 'cat-9', name: 'Door 7', regionId: null }),
  });
  assert.equal(plan.objects.length, 5);
  const [pastedA, pastedB] = plan.objects.slice(3);
  assert.notEqual(markIdOf(pastedA), 'a');
  assert.equal(pastedA.left, 116);
  assert.equal(pastedA.moduleId, 'mod-b');
  assert.equal(plan.callouts.length, 1);
  assert.match(plan.callouts[0].id, /^callout-new-/);
  assert.equal(plan.callouts[0].textBoxPosition.x, 0.2 + 16 / 612);
  assert.equal(plan.callouts[0].moduleId, 'mod-b');
  assert.equal(plan.callouts[0].meta.authorId, 'me', 'a pasted callout is the paster\'s own');
  assert.equal(pastedA.meta.authorId, 'me', 'a pasted mark is the paster\'s own');
  const [m] = plan.markers;
  assert.match(m.id, /^surveyMarker-new-/);
  assert.deepEqual(m.bounds, { x: 66, y: 316, width: 40, height: 20, angle: 0 });
  assert.equal(m.moduleId, 'mod-b');
  assert.equal(m.categoryId, 'cat-9');
  assert.equal(m.name, 'Door 7');
  assert.deepEqual(m.checklistResponses, {});
  assert.equal(m.excelSync, undefined);
  assert.equal(m.userId, 'me');
  assert.equal(m.entityColor, '#00f');

  // The viewer projected the callout on top; orderPastedFamily puts the
  // pasted items back in the copied order (A', C', m', B') above the page.
  const projectedCallout = calloutObject(plan.callouts[0].id);
  const page = [...plan.objects, projectedCallout];
  const ordered = orderPastedFamily(page, plan.pastedOrder, plan.markers);
  assert.deepEqual(ordered.map(markIdOf), ['a', 'c1', 'b', markIdOf(pastedA), plan.callouts[0].id, markIdOf(pastedB)]);
  const drawn = buildFamilyStack(ordered, plan.markers.map((r) => ({ id: r.id, stack: r.stack })))
    .map((e) => (e.kind === 'mark' ? markIdOf(ordered[e.index]) : e.id));
  assert.deepEqual(drawn.slice(3), [markIdOf(pastedA), plan.callouts[0].id, m.id, markIdOf(pastedB)]);
});

test('a marker with nowhere to land is skipped, the rest still paste', () => {
  const clip = buildFamilyClipboard({ pageNumber: 1, objects, indices: [0], markers: [marker('m1', 50)] });
  const plan = planFamilyPaste(clip, { objects, dx: 0, dy: 0, newId: () => 'x', pageNumber: 1, resolveMarker: () => null });
  assert.equal(plan.markers.length, 0);
  assert.equal(plan.skippedMarkers, 1);
  assert.equal(plan.objects.length, 4);
});

test('an empty selection makes no clipboard', () => {
  assert.equal(buildFamilyClipboard({ pageNumber: 1, objects, indices: [1] }), null);
});

test('a callout keeps its place in the group on a page of another size, and loses import provenance', () => {
  const imported = { ...callout('c1'), isPdfImported: true, pdfAnnotationId: '12R' };
  const clip = buildFamilyClipboard({ pageNumber: 1, objects, callouts: [imported], pageWidth: 612, pageHeight: 792 });
  const plan = planFamilyPaste(clip, {
    objects: [], dx: 0, dy: 0, pageWidth: 1224, pageHeight: 1584, newId: () => 'n', pageNumber: 2,
  });
  const [c] = plan.callouts;
  assert.equal(c.textBoxPosition.x, (0.2 * 612) / 1224, 'same page-unit spot on the bigger page');
  assert.equal(c.textBoxWidth, (0.1 * 612) / 1224);
  assert.equal(c.isPdfImported, undefined);
  assert.equal(c.pdfAnnotationId, undefined);
});
