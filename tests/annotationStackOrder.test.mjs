// w52 (2026-09-28) — one stacking order per page for every mark type.
//
// Owner: "When I right-click on callouts, I can't change their Z-order ...
// annotations are annotations." These tests pin, end to end at the pure
// layers:
//   * the store keeps a reorder (reload, second screen) — for shapes AND a
//     callout — and an untouched document reads exactly as before;
//   * a stale page capture never puts back an order another screen changed,
//     and a reorder never overwrites a collaborator's field edit;
//   * a callout re-projection keeps the callout's slot (no jump to the top);
//   * the canvas painter, the PDF export plan and the print flattener all
//     draw callouts in their slot among the other marks.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  createViewerCaptureState,
  docToByPage,
  recordViewerDelivery,
  syncByPageToDoc,
} from '../src/services/annotationDocStore.js';
import {
  compareStackEntries,
  planStackOrderWrites,
  viewerChangedStackOrder,
} from '../src/services/annotationStackOrder.js';
import {
  applyCalloutListToByPage,
  deriveCalloutsFromByPage,
} from '../src/utils/calloutAnnotationBridge.js';
import { paintAnnotationCanvas } from '../src/utils/annotationCanvasPainter.js';
import { buildPdfExportAnnotationPlan } from '../src/utils/pdfAnnotationsPdfLib.js';

const PAGE = { width: 612, height: 792 };
const rect = (id, extra = {}) => ({
  type: 'rect', left: 10, top: 10, width: 50, height: 50,
  stroke: '#ff0000', strokeWidth: 2, fill: 'transparent', id,
  data: { id, type: 'shape' },
  ...extra,
});
const callout = (id) => ({
  id,
  pageNumber: 1,
  arrowTip: { x: 0.5, y: 0.25 },
  knee: { x: 0.3, y: 0.5 },
  textBoxPosition: { x: 0.1, y: 0.6 },
  textBoxWidth: 0.2,
  textBoxHeight: 0.1,
  text: `text ${id}`,
  style: { fontFamily: 'Arial', fontSize: 12, borderColor: '#00ff00', lineThickness: 2 },
});
const ids = (byPage, page = 1) => (byPage?.[page]?.objects || []).map((o) => o?.data?.id);
const cloneDoc = (doc) => {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
};
const moveTo = (objects, fromId, toIndex) => {
  const list = objects.slice();
  const from = list.findIndex((o) => o?.data?.id === fromId);
  const [moved] = list.splice(from, 1);
  list.splice(toIndex, 0, moved);
  return list;
};

// ---------------------------------------------------------------------------
// Pure planner
// ---------------------------------------------------------------------------

test('planner: an order that already reads back writes nothing', () => {
  assert.equal(planStackOrderWrites([
    { key: 'a', z: null, arrival: 0 },
    { key: 'b', z: null, arrival: 1 },
  ]).size, 0);
  assert.equal(planStackOrderWrites([
    { key: 'c', z: null, arrival: 1 }, // no z (pre-w52) = below every z
    { key: 'a', z: 1, arrival: 5 },
    { key: 'b', z: 2, arrival: 0 },
  ]).size, 0);
});

test('planner: marks without z get one once, in their place; only the mover moves', () => {
  const writes = planStackOrderWrites([
    { key: 'c', z: null, arrival: 2 },
    { key: 'a', z: null, arrival: 0 },
    { key: 'b', z: null, arrival: 1 },
  ]);
  assert.deepEqual([...writes], [['c', 0], ['a', 1], ['b', 2]]);
  // Old marks without z + a newer mark with z: send the new one to the back.
  const mixed = planStackOrderWrites([
    { key: 'n', z: 1, arrival: 9 },
    { key: 'a', z: null, arrival: 0 },
    { key: 'b', z: null, arrival: 1 },
  ]);
  const read = ['n', 'a', 'b'].map((key) => ({ key, z: mixed.get(key) ?? { n: 1 }[key] ?? null, arrival: 0 }));
  assert.deepEqual(read.sort(compareStackEntries).map((entry) => entry.key), ['n', 'a', 'b']);
});

test('planner: once numbered, a move writes only the mark that moved', () => {
  const writes = planStackOrderWrites([
    { key: 'a', z: 1 },
    { key: 'c', z: 3 },
    { key: 'b', z: 2 },
    { key: 'd', z: 4 },
  ]);
  assert.equal(writes.size, 1);
  const [[key, z]] = [...writes];
  // Either b moves between c and d, or c moves between a and b — one write.
  assert.ok((key === 'b' && z > 3 && z < 4) || (key === 'c' && z > 1 && z < 2));
});

test('planner: to front / to back without neighbours on that side', () => {
  const front = planStackOrderWrites([{ key: 'b', z: 2 }, { key: 'c', z: 3 }, { key: 'a', z: 1 }]);
  assert.deepEqual([...front], [['a', 4]]);
  const back = planStackOrderWrites([{ key: 'c', z: 3 }, { key: 'a', z: 1 }, { key: 'b', z: 2 }]);
  assert.deepEqual([...back], [['c', 0]]);
});

test('planner: exhausted gaps fall back to numbering the page', () => {
  const writes = planStackOrderWrites([
    { key: 'a', z: 1 },
    { key: 'c', z: 1 + 1e-12 },
    { key: 'b', z: 1 + 5e-13 },
  ]);
  const zOf = Object.fromEntries(
    [['a', 1], ['c', 1 + 1e-12], ['b', 1 + 5e-13]].map(([k, z]) => [k, writes.get(k) ?? z]),
  );
  const order = ['a', 'b', 'c'].sort((x, y) => compareStackEntries(
    { key: x, z: zOf[x], arrival: 0 }, { key: y, z: zOf[y], arrival: 0 },
  ));
  assert.deepEqual(order, ['a', 'c', 'b']);
});

test('viewer intent: an order equal to a baseline (new marks on top) is not a reorder', () => {
  const created = new Set(['n']);
  assert.equal(viewerChangedStackOrder(['a', 'b', 'n'], [['a', 'b']], created), false);
  assert.equal(viewerChangedStackOrder(['n', 'a', 'b'], [['a', 'b']], created), true, 'a mark created below others');
  assert.equal(viewerChangedStackOrder(['n', 'a', 'b'], [['a', 'b']]), false, "another screen's mark shown below is not this screen's reorder");
  assert.equal(viewerChangedStackOrder(['b', 'a'], [['a', 'b']]), true);
  assert.equal(viewerChangedStackOrder(['b', 'a'], [['a', 'b'], ['b', 'a']]), false);
  assert.equal(viewerChangedStackOrder(['a'], [['a', 'b']]), false, 'a delete is not a reorder');
});

// ---------------------------------------------------------------------------
// Store: persistence, reload, second screen
// ---------------------------------------------------------------------------

test('a document written before w52 reads in its old order; new marks land on top everywhere', async () => {
  const { writeAnnotationMark } = await import('../src/services/annotationMarkStore.js');
  const doc = new Y.Doc();
  // Pre-w52 marks: no z.
  doc.transact(() => {
    for (const id of ['a', 'b', 'c']) writeAnnotationMark(doc, id, 1, rect(id));
  });
  assert.deepEqual(ids(docToByPage(doc)), ['a', 'b', 'c']);
  // A new mark carries z in the same update that creates it and reads on top
  // on every screen and after a reload.
  const updates = [];
  doc.on('update', (update) => updates.push(update));
  syncByPageToDoc(doc, { 1: { objects: [...docToByPage(doc)[1].objects, rect('d')] } });
  assert.equal(updates.length, 1, 'one update for the new mark, z included');
  assert.equal(doc.getMap('marks').get('d').get('z'), 1);
  assert.deepEqual(ids(docToByPage(cloneDoc(doc))), ['a', 'b', 'c', 'd']);
  syncByPageToDoc(doc, { 1: { objects: [...docToByPage(doc)[1].objects, rect('e')] } });
  assert.deepEqual(ids(docToByPage(cloneDoc(doc))), ['a', 'b', 'c', 'd', 'e']);
});

test('two screens adding marks at once agree on the order (no map-arrival tie)', () => {
  const docA = new Y.Doc();
  syncByPageToDoc(docA, { 1: { objects: [rect('a')] } });
  const docB = cloneDoc(docA);
  syncByPageToDoc(docA, { 1: { objects: [...docToByPage(docA)[1].objects, rect('x')] } });
  syncByPageToDoc(docB, { 1: { objects: [...docToByPage(docB)[1].objects, rect('y')] } });
  Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  assert.deepEqual(ids(docToByPage(docA)), ids(docToByPage(docB)));
  assert.deepEqual(ids(docToByPage(cloneDoc(docA))), ids(docToByPage(docA)));
  assert.equal(ids(docToByPage(docA))[0], 'a');
});

test('a mark moved to another page lands on top there, on every screen', () => {
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [rect('a'), rect('m')] }, 2: { objects: [rect('p'), rect('q')] } });
  let byPage = docToByPage(doc);
  syncByPageToDoc(doc, { 1: { objects: moveTo(byPage[1].objects, 'm', 0) }, 2: byPage[2] }); // m gets a low z
  byPage = docToByPage(doc);
  const moved = byPage[1].objects.find((o) => o.data.id === 'm');
  syncByPageToDoc(doc, {
    1: { objects: byPage[1].objects.filter((o) => o.data.id !== 'm') },
    2: { objects: [...byPage[2].objects, moved] },
  });
  assert.deepEqual(ids(docToByPage(cloneDoc(doc)), 2), ['p', 'q', 'm']);
});

test('a later reorder on a busy page writes only a couple of keys', () => {
  const doc = new Y.Doc();
  const objects = Array.from({ length: 300 }, (_, i) => rect(`k${i}`));
  syncByPageToDoc(doc, { 1: { objects } });
  let page = docToByPage(doc)[1];
  // delete one, draw one, send the new one backward one step
  const edited = [...page.objects.filter((o) => o.data.id !== 'k10'), rect('new')];
  syncByPageToDoc(doc, { 1: { ...page, objects: edited } });
  page = docToByPage(doc)[1];
  const result = syncByPageToDoc(doc, { 1: { ...page, objects: moveTo(page.objects, 'new', 298) } });
  assert.ok((result.reordered || 0) <= 2, `reordered ${result.reordered}`);
  assert.equal(ids(docToByPage(cloneDoc(doc)))[298], 'new');
});

test('a reorder survives a reload and reaches a second screen', () => {
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [rect('a'), rect('b'), rect('c')] } });
  const other = cloneDoc(doc);
  doc.on('update', (update) => Y.applyUpdate(other, update));
  const page = docToByPage(doc)[1];
  syncByPageToDoc(doc, { 1: { ...page, objects: moveTo(page.objects, 'c', 0) } });
  assert.deepEqual(ids(docToByPage(doc)), ['c', 'a', 'b']);
  assert.deepEqual(ids(docToByPage(cloneDoc(doc))), ['c', 'a', 'b'], 'reload');
  assert.deepEqual(ids(docToByPage(other)), ['c', 'a', 'b'], 'second screen');
  // A new mark after a reorder still lands on top.
  syncByPageToDoc(doc, { 1: { objects: [...docToByPage(doc)[1].objects, rect('d')] } });
  assert.deepEqual(ids(docToByPage(cloneDoc(doc))), ['c', 'a', 'b', 'd']);
});

test('a later reorder writes one key for the moved mark only', () => {
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [rect('a'), rect('b'), rect('c'), rect('d')] } });
  let page = docToByPage(doc)[1];
  syncByPageToDoc(doc, { 1: { ...page, objects: moveTo(page.objects, 'd', 0) } }); // numbers the page
  page = docToByPage(doc)[1];
  const updates = [];
  doc.on('update', (update) => updates.push(update));
  const result = syncByPageToDoc(doc, { 1: { ...page, objects: moveTo(page.objects, 'a', 3) } });
  assert.equal(result.reordered, 1);
  assert.equal(updates.length, 1);
  assert.deepEqual(ids(docToByPage(cloneDoc(doc))), ['d', 'b', 'c', 'a']);
});

test('a callout moves in the same stack: below a rect, then above it, across reload', () => {
  let byPage = { 1: { objects: [rect('r1')] } };
  byPage = applyCalloutListToByPage(byPage, [callout('c1')], { 1: PAGE });
  byPage = { 1: { ...byPage[1], objects: [...byPage[1].objects, rect('r2')] } };
  const doc = new Y.Doc();
  syncByPageToDoc(doc, byPage);
  assert.deepEqual(ids(docToByPage(doc)), ['r1', 'c1', 'r2']);
  // Send the callout to the back.
  let page = docToByPage(doc)[1];
  syncByPageToDoc(doc, { 1: { ...page, objects: moveTo(page.objects, 'c1', 0) } });
  assert.deepEqual(ids(docToByPage(cloneDoc(doc))), ['c1', 'r1', 'r2']);
  // Bring it to the front.
  page = docToByPage(doc)[1];
  syncByPageToDoc(doc, { 1: { ...page, objects: moveTo(page.objects, 'c1', 2) } });
  assert.deepEqual(ids(docToByPage(cloneDoc(doc))), ['r1', 'r2', 'c1']);
});

test('editing a callout keeps its slot (the projection replaces it in place)', () => {
  let byPage = { 1: { objects: [rect('r1')] } };
  byPage = applyCalloutListToByPage(byPage, [callout('c1'), callout('c2')], { 1: PAGE });
  byPage = { 1: { ...byPage[1], objects: [...byPage[1].objects, rect('r2')] } };
  // Stack: r1, c1, c2, r2 → move c2 to the bottom.
  byPage = { 1: { ...byPage[1], objects: moveTo(byPage[1].objects, 'c2', 0) } };
  assert.deepEqual(ids(byPage), ['c2', 'r1', 'c1', 'r2']);
  const edited = deriveCalloutsFromByPage(byPage).map((c) => (
    c.id === 'c2' ? { ...c, text: 'changed' } : c
  ));
  const next = applyCalloutListToByPage(byPage, edited, { 1: PAGE });
  assert.deepEqual(ids(next), ['c2', 'r1', 'c1', 'r2'], 'no callout jumps to the top');
  assert.equal(deriveCalloutsFromByPage(next).find((c) => c.id === 'c2').text, 'changed');
  // A new callout is added on top; a removed one leaves.
  const grown = applyCalloutListToByPage(next, [...edited.filter((c) => c.id !== 'c1'), callout('c3')], { 1: PAGE });
  assert.deepEqual(ids(grown), ['c2', 'r1', 'r2', 'c3']);
});

// ---------------------------------------------------------------------------
// Store: collaboration safety (viewer capture)
// ---------------------------------------------------------------------------

function screen(doc) {
  const viewer = createViewerCaptureState();
  const deliver = () => {
    const byPage = docToByPage(doc);
    recordViewerDelivery(viewer, byPage);
    return byPage;
  };
  const capture = (byPage) => syncByPageToDoc(doc, byPage, { viewer });
  return { viewer, deliver, capture };
}

test('a stale capture never puts back an order another screen changed', () => {
  const docA = new Y.Doc();
  syncByPageToDoc(docA, { 1: { objects: [rect('a'), rect('b'), rect('c')] } });
  const docB = cloneDoc(docA);
  const a = screen(docA);
  const b = screen(docB);
  let aPage = a.deliver();
  a.capture(aPage);
  const bPage = b.deliver();
  b.capture(bPage);
  // Bob sends c to the back; Alice receives it but her screen has not
  // re-read yet — she restyles `a` on her OLD array.
  const bReordered = { 1: { ...bPage[1], objects: moveTo(bPage[1].objects, 'c', 0) } };
  b.capture(bReordered);
  Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
  aPage = { 1: { ...aPage[1], objects: aPage[1].objects.map((o) => (o.data.id === 'a' ? { ...o, stroke: '#0000ff' } : o)) } };
  a.capture(aPage);
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  for (const doc of [docA, docB]) {
    const read = docToByPage(doc);
    assert.deepEqual(ids(read), ['c', 'a', 'b'], "Bob's reorder holds");
    assert.equal(read[1].objects.find((o) => o.data.id === 'a').stroke, '#0000ff', "Alice's restyle holds");
  }
});

test("a reorder never overwrites a collaborator's field edit", () => {
  const docA = new Y.Doc();
  syncByPageToDoc(docA, { 1: { objects: [rect('a'), rect('b')] } });
  const docB = cloneDoc(docA);
  const a = screen(docA);
  const b = screen(docB);
  const aPage = a.deliver();
  a.capture(aPage);
  const bPage = b.deliver();
  b.capture(bPage);
  // Concurrently: Alice moves `a` right; Bob sends `a` to the front.
  a.capture({ 1: { ...aPage[1], objects: aPage[1].objects.map((o) => (o.data.id === 'a' ? { ...o, left: 300 } : o)) } });
  b.capture({ 1: { ...bPage[1], objects: moveTo(bPage[1].objects, 'a', 1) } });
  Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  for (const doc of [docA, docB]) {
    const read = docToByPage(doc);
    assert.deepEqual(ids(read), ['b', 'a']);
    assert.equal(read[1].objects.find((o) => o.data.id === 'a').left, 300);
  }
});

test('a page handed out by the store is not read as the viewer reordering it', () => {
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [rect('a'), rect('b'), rect('c')] } });
  const view = screen(doc);
  const page = view.deliver();
  const updates = [];
  doc.on('update', (update) => updates.push(update));
  view.capture(page);
  assert.equal(updates.length, 0);
});

// ---------------------------------------------------------------------------
// Painters: canvas, export, print order
// ---------------------------------------------------------------------------

function recordingContext() {
  const strokes = [];
  const target = {
    measureText: () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    getLineDash: () => [],
    createLinearGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    canvas: { width: 612, height: 792 },
  };
  return {
    strokes,
    context: new Proxy(target, {
      get(obj, prop) {
        if (prop in obj) return obj[prop];
        return () => {};
      },
      set(obj, prop, value) {
        if (prop === 'strokeStyle') strokes.push(String(value).toLowerCase());
        obj[prop] = value;
        return true;
      },
    }),
  };
}

test('canvas painter draws a callout in its slot, not always on top', () => {
  let byPage = { 1: { objects: [] } };
  byPage = applyCalloutListToByPage(byPage, [callout('c1')], { 1: PAGE });
  const objects = [...byPage[1].objects, rect('r1', { stroke: '#ff0000' })];
  const { context, strokes } = recordingContext();
  paintAnnotationCanvas(context, {
    canvasWidth: 612, canvasHeight: 792, drawScale: 1, displayScale: 1,
    pageWidth: 612, pageHeight: 792,
    objects,
    callouts: deriveCalloutsFromByPage(byPage),
  });
  const firstCallout = strokes.findIndex((s) => s.includes('0, 255, 0') || s.includes('#00ff00'));
  const firstRect = strokes.findIndex((s) => s.includes('255, 0, 0') || s.includes('#ff0000'));
  assert.ok(firstCallout >= 0 && firstRect >= 0, `both painted: ${strokes.join(' | ')}`);
  assert.ok(firstCallout < firstRect, 'callout (bottom) painted before the rect (top)');
});

test('export plan writes callouts in their slot among the page marks', () => {
  let byPage = { 1: { objects: [rect('r1')] } };
  byPage = applyCalloutListToByPage(byPage, [callout('c1')], { 1: PAGE });
  byPage = { 1: { ...byPage[1], objects: [...moveTo(byPage[1].objects, 'c1', 0), rect('r2')] } };
  const plan = buildPdfExportAnnotationPlan({
    annotationsByPage: byPage,
    callouts: deriveCalloutsFromByPage(byPage),
    pageSizes: { 1: PAGE },
  });
  assert.deepEqual(plan.items.map((item) => item.id), ['c1', 'r1', 'r2']);
});

test('print draws a callout in its slot, once transformed onto the page', async () => {
  const { PDFDocument, PDFName, PDFArray, PDFRawStream, decodePDFRawStream } = await import('pdf-lib');
  const { savePDFWithFlattenedRegularAnnotationsForPrint } = await import('../src/utils/pdfAnnotationsPdfLib.js');
  const source = await PDFDocument.create();
  source.addPage([PAGE.width, PAGE.height]);
  const sourceBytes = await source.save();
  const pdfFile = {
    name: 'stack.pdf',
    async arrayBuffer() { return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength); },
  };
  let screenByPage = { 1: { objects: [rect('r1', { stroke: '#ff0000', left: 100, top: 100, width: 300, height: 300 })] } };
  screenByPage = applyCalloutListToByPage(screenByPage, [callout('c1')], { 1: PAGE });
  const flatten = async (shown) => {
    const printable = { 1: { objects: shown[1].objects.filter((o) => o?.data?.type !== 'callout') } };
    const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(pdfFile, printable, { 1: PAGE }, {
      returnBytes: true,
      callouts: deriveCalloutsFromByPage(shown),
      screenAnnotationsByPage: shown,
    });
    const doc = await PDFDocument.load(bytes);
    const contents = doc.context.lookup(doc.getPage(0).node.get(PDFName.of('Contents')));
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
    return streams
      .filter((stream) => stream instanceof PDFRawStream)
      .map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()))
      .join('\n');
  };
  const orderOf = (text) => ({
    green: text.search(/\b0 1 0 RG\b/),
    red: text.search(/\b1 0 0 RG\b/),
    depth: (text.match(/(^|\s)q(?=\s|$)/g) || []).length - (text.match(/(^|\s)Q(?=\s|$)/g) || []).length,
  });
  const onTop = orderOf(await flatten(screenByPage));
  assert.ok(onTop.green >= 0 && onTop.red >= 0, 'both drawn');
  assert.ok(onTop.green > onTop.red, 'callout above the rect draws after it');
  const below = { 1: { ...screenByPage[1], objects: moveTo(screenByPage[1].objects, 'c1', 0) } };
  const bottom = orderOf(await flatten(below));
  assert.ok(bottom.green >= 0 && bottom.red >= 0);
  assert.ok(bottom.green < bottom.red, 'callout sent to back draws before the rect');
  assert.equal(bottom.depth, 0, 'graphics state balanced');
});

test('Undo of a delete puts the mark back in its old slot for every screen', () => {
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [rect('a'), rect('b'), rect('c')] } });
  const view = screen(doc);
  const before = view.deliver();
  view.capture(before);
  const withoutB = { 1: { ...before[1], objects: before[1].objects.filter((o) => o.data.id !== 'b') } };
  view.capture(withoutB);
  // Undo restores b between a and c.
  view.capture({ 1: { ...before[1], objects: before[1].objects.slice() } });
  assert.deepEqual(ids(docToByPage(cloneDoc(doc))), ['a', 'b', 'c']);
});

test('a reorder is one Undo step; Undo/Redo move only the named marks', async () => {
  const {
    applyAnnotationHistoryAction,
    buildAnnotationHistoryAction,
    invertAnnotationHistoryAction,
  } = await import('../src/utils/annotationLocalHistory.js');
  const before = { objects: [rect('a'), rect('b'), rect('c')] };
  const after = { objects: [rect('c'), rect('a'), rect('b')] };
  const action = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: before, nextPage: after });
  assert.equal(action?.type, 'fabric:reorder');
  // A collaborator added `d` in the middle meanwhile; Undo keeps it in place.
  const current = { 1: { objects: [rect('c'), rect('d'), rect('a'), rect('b')] } };
  const undone = applyAnnotationHistoryAction(current, invertAnnotationHistoryAction(action));
  assert.deepEqual(ids(undone), ['a', 'd', 'b', 'c']);
  const redone = applyAnnotationHistoryAction(undone, action);
  assert.deepEqual(ids(redone), ['c', 'd', 'a', 'b']);
  // Content changes still build their usual step, never a reorder.
  const edited = { objects: [rect('a', { left: 99 }), rect('b'), rect('c')] };
  assert.equal(buildAnnotationHistoryAction({ pageNumber: 1, previousPage: before, nextPage: edited }).type, 'fabric:update');
});
