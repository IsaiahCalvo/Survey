// Per-field sync (2026-09-24) — every mark is a nested Y.Map, so two people
// changing DIFFERENT fields of the same mark both keep their change. These
// tests drive two or three Y.Docs the way the viewer does (a "screen" that is
// captured into the store after every change, and repainted from the store on
// every remote update) and check the merged result on every screen and in
// every document. Design: docs/ANNOTATION-FIELD-SYNC.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { PDFDocument, PDFName } from 'pdf-lib';

import {
  ANNOTATION_STORE_VERSION,
  ANNOTATION_STORE_VERSION_META_KEY,
  convertLegacyAnnotationEntries,
  countLegacyAnnotationEntries,
  createViewerCaptureState,
  docToByPage,
  encodeSnapshot,
  getAnnotationsMap,
  getMetaValue,
  hydrateDoc,
  preserveTransientPagePresentationState,
  readAnnotationObject,
  recordViewerDelivery,
  syncByPageToDoc,
} from '../src/services/annotationDocStore.js';
import { isYMap } from '../src/services/annotationMarkStore.js';
import { openAnnotationDoc, __test } from '../src/services/annotationDocSync.js';
import {
  applyAnnotationHistoryAction,
  buildAnnotationHistoryAction,
  invertAnnotationHistoryAction,
} from '../src/utils/annotationLocalHistory.js';
import { applyReconcileSwaps } from '../src/utils/annotationReconcile.js';
import { mergeDraggedMarksOntoPage } from '../src/utils/dragCommitMerge.js';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';

const { bytesToPgHex, pgHexToBytes } = __test;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const rect = (id, extra = {}) => ({
  type: 'rect',
  left: 10,
  top: 20,
  width: 100,
  height: 50,
  fill: 'transparent',
  stroke: '#ff0000',
  strokeWidth: 2,
  opacity: 1,
  meta: { authorId: 'user-a' },
  data: { id, type: 'shape', authorId: 'user-a' },
  ...extra,
});

const textBox = (id) => ({
  type: 'textbox',
  text: 'hello',
  left: 40,
  top: 60,
  width: 200,
  height: 40,
  fontSize: 14,
  fill: '#111111',
  meta: { authorId: 'user-a' },
  data: { id, type: 'text', authorId: 'user-a' },
});

const polyline = (id) => ({
  type: 'polyline',
  left: 5,
  top: 5,
  width: 100,
  height: 10,
  points: [{ x: 0, y: 0 }, { x: 50, y: 10 }, { x: 100, y: 0 }],
  pathOffset: { x: 50, y: 5 },
  stroke: '#0000ff',
  strokeWidth: 2,
  fill: 'transparent',
  meta: { authorId: 'user-a' },
  data: { id, type: 'shape', authorId: 'user-a' },
});

const callout = (id) => ({
  type: 'group',
  left: 0,
  top: 0,
  objects: [{ type: 'line', data: { calloutPart: 'line1' } }],
  meta: { authorId: 'user-a' },
  data: {
    id,
    type: 'callout',
    authorId: 'user-a',
    legacyCallout: {
      id,
      pageNumber: 1,
      text: 'note',
      arrowTip: { x: 0.1, y: 0.1 },
      knee: { x: 0.2, y: 0.2 },
      textBoxPosition: { x: 0.3, y: 0.3 },
      textBoxWidth: 0.2,
      textBoxHeight: 0.1,
      style: { fontColor: '#111111', fontSize: 12, borderColor: '#ff0000', lineThickness: 2 },
    },
  },
});

const textMarkup = (id) => ({
  type: 'rect',
  left: 10,
  top: 10,
  width: 80,
  height: 12,
  fill: '#ffff00',
  opacity: 0.4,
  meta: { authorId: 'user-a' },
  data: {
    id,
    type: 'text-markup',
    authorId: 'user-a',
    quads: [[10, 10, 90, 10, 10, 22, 90, 22]],
    selectedText: 'abc',
    textRange: { start: 0, end: 3 },
  },
});

// ---------------------------------------------------------------------------
// A peer = one Y.Doc + the screen that shows it, wired like useAnnotationDoc:
// every screen change is captured into the store (viewer capture state), and
// every remote update repaints the screen from a fresh read.
// ---------------------------------------------------------------------------

function makePeer(name, seedUpdate = null) {
  const doc = new Y.Doc();
  if (seedUpdate) Y.applyUpdate(doc, seedUpdate, 'seed');
  const viewer = createViewerCaptureState();
  const peer = {
    name,
    doc,
    viewer,
    screen: {},
    outbox: [],
    history: [],
    lastCapture: null,
  };
  doc.on('update', (update, origin) => {
    if (origin !== 'remote' && origin !== 'seed') peer.outbox.push(update);
  });
  peer.read = () => {
    const byPage = docToByPage(doc);
    recordViewerDelivery(viewer, byPage);
    return byPage;
  };
  peer.capture = () => {
    for (let round = 0; round < 4; round += 1) {
      const result = syncByPageToDoc(doc, peer.screen, { viewer });
      peer.lastCapture = result;
      let next = peer.screen;
      if (result.identityChanged && result.normalizedByPage) next = result.normalizedByPage;
      next = applyReconcileSwaps(next, result.reconcile);
      if (next === peer.screen) return result;
      peer.screen = next;
    }
    return peer.lastCapture;
  };
  // The screen paints the document (open, or a remote update landed).
  peer.repaint = () => {
    peer.screen = preserveTransientPagePresentationState(peer.screen, peer.read());
    return peer.capture();
  };
  // A local edit of one mark, derived from the screen as it is now.
  peer.edit = (id, change, { record = true } = {}) => {
    const pageKey = Object.keys(peer.screen).find((key) => (
      (peer.screen[key]?.objects || []).some((object) => object?.data?.id === id)
    ));
    if (pageKey == null) return false;
    const before = peer.screen[pageKey];
    const objects = before.objects.map((object) => (
      object?.data?.id === id ? change(object) : object
    ));
    const after = { ...before, objects };
    if (record) {
      const action = buildAnnotationHistoryAction({ pageNumber: Number(pageKey), previousPage: before, nextPage: after });
      if (action) peer.history.push(action);
    }
    peer.screen = { ...peer.screen, [pageKey]: after };
    peer.capture();
    return true;
  };
  peer.remove = (id) => {
    const pageKey = Object.keys(peer.screen).find((key) => (
      (peer.screen[key]?.objects || []).some((object) => object?.data?.id === id)
    ));
    if (pageKey == null) return false;
    const before = peer.screen[pageKey];
    const after = { ...before, objects: before.objects.filter((object) => object?.data?.id !== id) };
    const action = buildAnnotationHistoryAction({ pageNumber: Number(pageKey), previousPage: before, nextPage: after });
    if (action) peer.history.push(action);
    peer.screen = { ...peer.screen, [pageKey]: after };
    peer.capture();
    return true;
  };
  peer.undo = () => {
    const action = peer.history.pop();
    if (!action) return false;
    peer.redoStack = peer.redoStack || [];
    peer.redoStack.push(action);
    peer.screen = applyAnnotationHistoryAction(peer.screen, invertAnnotationHistoryAction(action));
    peer.capture();
    return true;
  };
  peer.redo = () => {
    const action = peer.redoStack?.pop();
    if (!action) return false;
    peer.history.push(action);
    peer.screen = applyAnnotationHistoryAction(peer.screen, action);
    peer.capture();
    return true;
  };
  peer.find = (id) => {
    for (const page of Object.values(peer.screen)) {
      const found = (page?.objects || []).find((object) => object?.data?.id === id);
      if (found) return found;
    }
    return null;
  };
  peer.stored = (id) => readAnnotationObject(doc, id) || null;
  return peer;
}

// Deliver every peer's pending updates to every other peer (any order the
// network picks), then let each screen repaint. `repaint: false` leaves the
// screens behind (a remote update applied but not painted yet).
function flush(peers, { repaint = true } = {}) {
  let moved = true;
  while (moved) {
    moved = false;
    for (const from of peers) {
      const updates = from.outbox.splice(0);
      if (updates.length === 0) continue;
      moved = true;
      for (const to of peers) {
        if (to === from) continue;
        for (const update of updates) Y.applyUpdate(to.doc, update, 'remote');
      }
    }
  }
  if (repaint) for (const peer of peers) peer.repaint();
}

function setup(objects, names = ['A', 'B']) {
  const seed = new Y.Doc();
  syncByPageToDoc(seed, { 1: { objects } });
  const update = Y.encodeStateAsUpdate(seed);
  const peers = names.map((name) => makePeer(name, update));
  for (const peer of peers) peer.repaint();
  return peers;
}

function assertConverged(peers, id) {
  const [first, ...rest] = peers;
  const reference = JSON.stringify(first.stored(id));
  for (const peer of rest) {
    assert.equal(JSON.stringify(peer.stored(id)), reference, `${peer.name} document equals ${first.name}'s`);
  }
  for (const peer of peers) {
    assert.deepEqual(
      JSON.parse(JSON.stringify(peer.find(id))),
      JSON.parse(reference),
      `${peer.name}'s screen shows the document`,
    );
  }
  return JSON.parse(reference);
}

// ---------------------------------------------------------------------------
// Storage layout
// ---------------------------------------------------------------------------

test('marks are stored as nested per-field maps; nested bags are maps, arrays and linked groups are single values', () => {
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [callout('c1'), polyline('p1'), textMarkup('t1')] } });
  const map = getAnnotationsMap(doc);
  const c1 = map.get('c1');
  assert.ok(isYMap(c1), 'a mark is a Y.Map');
  assert.equal(c1.get('p'), 1);
  const object = c1.get('o');
  assert.ok(isYMap(object.get('data')), 'data is a nested map');
  assert.ok(isYMap(object.get('data').get('legacyCallout').get('style')), 'callout style is a nested map');
  assert.ok(Array.isArray(object.get('objects')), 'a callout\'s drawn parts stay one array value');

  const p1 = map.get('p1').get('o');
  assert.equal(p1.has('points'), false, 'point geometry is not stored key by key');
  assert.deepEqual(
    Object.keys(p1.get('#pointGeometry')).sort(),
    ['height', 'left', 'pathOffset', 'points', 'top', 'width'],
    'a polyline\'s geometry is ONE stored value',
  );
  const t1 = map.get('t1').get('o');
  assert.ok(t1.get('#textMarkup')['data.quads'], 'a text markup\'s range + box is one stored value');
  assert.equal(isYMap(t1.get('data')) && t1.get('data').has('quads'), false);

  // Round trip is lossless.
  const byPage = docToByPage(doc);
  assert.deepEqual(byPage[1].objects.map((o) => o.data.id), ['c1', 'p1', 't1']);
  assert.deepEqual(JSON.parse(JSON.stringify(byPage[1].objects[1].points)), polyline('p1').points);
  assert.deepEqual(byPage[1].objects[2].data.textRange, { start: 0, end: 3 });
});

test('re-capturing identical state writes nothing; one field change writes one key', () => {
  const [A] = setup([rect('r1')], ['A']);
  let updates = 0;
  let bytes = 0;
  A.doc.on('update', (update) => { updates += 1; bytes += update.length; });
  A.capture();
  A.screen = { ...A.screen, 1: { ...A.screen[1], objects: [...A.screen[1].objects] } };
  A.capture();
  assert.equal(updates, 0, 'no update for an unchanged screen');
  A.edit('r1', (object) => ({ ...object, stroke: '#00ff00' }));
  assert.equal(updates, 1);
  assert.ok(bytes < 60, `a one-field edit is a small update (${bytes} bytes)`);
});

// ---------------------------------------------------------------------------
// Concurrent edits to different fields of the same mark
// ---------------------------------------------------------------------------

test('colour vs size: both changes survive on every screen', () => {
  const [A, B] = setup([rect('r1')]);
  A.edit('r1', (o) => ({ ...o, stroke: '#00aa00' }));
  B.edit('r1', (o) => ({ ...o, width: 240, height: 90 }));
  flush([A, B]);
  const merged = assertConverged([A, B], 'r1');
  assert.equal(merged.stroke, '#00aa00');
  assert.equal(merged.width, 240);
  assert.equal(merged.height, 90);
});

test('three peers: colour, size and opacity from three people all survive', () => {
  const [A, B, C] = setup([rect('r1')], ['A', 'B', 'C']);
  A.edit('r1', (o) => ({ ...o, stroke: '#123456' }));
  B.edit('r1', (o) => ({ ...o, width: 321 }));
  C.edit('r1', (o) => ({ ...o, opacity: 0.25 }));
  flush([A, B, C]);
  const merged = assertConverged([A, B, C], 'r1');
  assert.deepEqual([merged.stroke, merged.width, merged.opacity], ['#123456', 321, 0.25]);
});

test('text vs box height: both survive', () => {
  const [A, B] = setup([textBox('t1')]);
  A.edit('t1', (o) => ({ ...o, text: 'hello world' }));
  B.edit('t1', (o) => ({ ...o, height: 120 }));
  flush([A, B]);
  const merged = assertConverged([A, B], 't1');
  assert.equal(merged.text, 'hello world');
  assert.equal(merged.height, 120);
});

test('style vs geometry: a polyline recolour and a corner drag both survive, geometry stays whole', () => {
  const [A, B] = setup([polyline('p1')]);
  A.edit('p1', (o) => ({ ...o, stroke: '#ff00ff', strokeWidth: 5 }));
  B.edit('p1', (o) => ({
    ...o,
    points: [{ x: 0, y: 0 }, { x: 50, y: 60 }, { x: 100, y: 0 }],
    height: 60,
    pathOffset: { x: 50, y: 30 },
  }));
  flush([A, B]);
  const merged = assertConverged([A, B], 'p1');
  assert.equal(merged.stroke, '#ff00ff');
  assert.equal(merged.strokeWidth, 5);
  assert.deepEqual(merged.points[1], { x: 50, y: 60 });
  assert.equal(merged.height, 60);
  assert.deepEqual(merged.pathOffset, { x: 50, y: 30 });
});

test('two concurrent corner drags never mix one person\'s points with the other\'s box', () => {
  const [A, B] = setup([polyline('p1')]);
  A.edit('p1', (o) => ({ ...o, points: [{ x: 0, y: 0 }, { x: 50, y: 80 }, { x: 100, y: 0 }], height: 80, pathOffset: { x: 50, y: 40 } }));
  B.edit('p1', (o) => ({ ...o, points: [{ x: -40, y: 0 }, { x: 50, y: 10 }, { x: 100, y: 0 }], left: -35, width: 140, pathOffset: { x: 30, y: 5 } }));
  flush([A, B]);
  const merged = assertConverged([A, B], 'p1');
  const fromA = merged.height === 80 && merged.pathOffset.y === 40 && merged.points[1].y === 80 && merged.left === 5;
  const fromB = merged.width === 140 && merged.pathOffset.x === 30 && merged.points[0].x === -40 && merged.height === 10;
  assert.ok(fromA !== fromB, `geometry is exactly one person's (${JSON.stringify(merged)})`);
});

test('callout style fields: text colour and font size from two people both survive', () => {
  const [A, B] = setup([callout('c1')]);
  A.edit('c1', (o) => ({
    ...o,
    data: { ...o.data, legacyCallout: { ...o.data.legacyCallout, style: { ...o.data.legacyCallout.style, fontColor: '#00ff00' } } },
  }));
  B.edit('c1', (o) => ({
    ...o,
    data: { ...o.data, legacyCallout: { ...o.data.legacyCallout, style: { ...o.data.legacyCallout.style, fontSize: 20 } }, },
  }));
  flush([A, B]);
  const merged = assertConverged([A, B], 'c1');
  assert.equal(merged.data.legacyCallout.style.fontColor, '#00ff00');
  assert.equal(merged.data.legacyCallout.style.fontSize, 20);
  assert.equal(merged.data.legacyCallout.style.borderColor, '#ff0000');
});

test('text markup: a recolour and a range change both survive; the range and its box stay together', () => {
  const [A, B] = setup([textMarkup('m1')]);
  A.edit('m1', (o) => ({ ...o, fill: '#00ff00' }));
  B.edit('m1', (o) => ({
    ...o,
    width: 160,
    data: { ...o.data, quads: [[10, 10, 170, 10, 10, 22, 170, 22]], selectedText: 'abcdef', textRange: { start: 0, end: 6 } },
  }));
  flush([A, B]);
  const merged = assertConverged([A, B], 'm1');
  assert.equal(merged.fill, '#00ff00');
  assert.equal(merged.width, 160);
  assert.equal(merged.data.selectedText, 'abcdef');
  assert.deepEqual(merged.data.textRange, { start: 0, end: 6 });
});

test('same field: last writer wins, the same value on every screen', () => {
  const [A, B] = setup([rect('r1')]);
  A.edit('r1', (o) => ({ ...o, stroke: '#aa0000' }));
  B.edit('r1', (o) => ({ ...o, stroke: '#0000aa' }));
  flush([A, B]);
  const merged = assertConverged([A, B], 'r1');
  assert.ok(['#aa0000', '#0000aa'].includes(merged.stroke));
});

// ---------------------------------------------------------------------------
// Deletes and Undo
// ---------------------------------------------------------------------------

test('delete vs concurrent update: the delete wins everywhere', () => {
  const [A, B] = setup([rect('r1'), rect('r2')]);
  A.remove('r1');
  B.edit('r1', (o) => ({ ...o, stroke: '#00ff00' }));
  flush([A, B]);
  assert.equal(A.stored('r1'), null);
  assert.equal(B.stored('r1'), null);
  assert.equal(A.find('r1'), null);
  assert.equal(B.find('r1'), null);
  assert.ok(A.find('r2') && B.find('r2'), 'other marks untouched');
});

test('an edit made on a screen that has not painted a remote delete does not bring the mark back', () => {
  const [A, B] = setup([rect('r1')]);
  A.remove('r1');
  flush([A, B], { repaint: false });
  // B still shows r1 and edits it before the delete is painted.
  B.edit('r1', (o) => ({ ...o, stroke: '#00ff00' }));
  assert.equal(B.stored('r1'), null, 'no resurrection in B\'s document');
  assert.equal(B.find('r1'), null, 'B\'s screen drops the mark (reconcile)');
  flush([A, B]);
  assert.equal(A.stored('r1'), null);
});

test('delete then Undo brings the mark back for everyone; the other person\'s Undo of an update to it is a no-op while it is deleted', () => {
  const [A, B] = setup([rect('r1')]);
  B.edit('r1', (o) => ({ ...o, width: 300 }));
  flush([A, B]);
  A.remove('r1');
  flush([A, B]);
  assert.equal(B.find('r1'), null);
  // B's Undo of its size change finds no mark: nothing is written.
  let bUpdates = 0;
  B.doc.on('update', () => { bUpdates += 1; });
  B.undo();
  assert.equal(bUpdates, 0);
  assert.equal(B.stored('r1'), null);
  // A's Undo of its delete brings the mark back (with B's size, as A deleted it).
  A.undo();
  flush([A, B]);
  const restored = assertConverged([A, B], 'r1');
  assert.equal(restored.width, 300);
});

test('both people undo their own field edits at the same time: each Undo reverts only its own field', () => {
  const [A, B] = setup([rect('r1')]);
  A.edit('r1', (o) => ({ ...o, stroke: '#00aa00' }));
  B.edit('r1', (o) => ({ ...o, width: 250 }));
  flush([A, B]);
  A.undo();
  B.undo();
  flush([A, B]);
  const merged = assertConverged([A, B], 'r1');
  assert.equal(merged.stroke, '#ff0000');
  assert.equal(merged.width, 100);
});

test('Undo while the other person\'s edit to another field is still in flight keeps their edit', () => {
  const [A, B] = setup([rect('r1')]);
  A.edit('r1', (o) => ({ ...o, stroke: '#00aa00' }));
  flush([A, B]);
  B.edit('r1', (o) => ({ ...o, width: 250 })); // not delivered to A yet
  A.undo();
  flush([A, B]);
  const merged = assertConverged([A, B], 'r1');
  assert.equal(merged.stroke, '#ff0000');
  assert.equal(merged.width, 250, 'B\'s in-flight size change survives A\'s Undo');
});

test('rapid Undo/Redo while the other person keeps editing: both end states survive', () => {
  const [A, B] = setup([rect('r1')]);
  A.edit('r1', (o) => ({ ...o, stroke: '#00aa00' }));
  flush([A, B]);
  for (let round = 0; round < 6; round += 1) {
    A.undo();
    B.edit('r1', (o) => ({ ...o, width: 100 + round * 10 }));
    if (round % 2 === 0) flush([A, B]);
    A.redo();
    B.edit('r1', (o) => ({ ...o, height: 50 + round }));
    if (round % 3 === 0) flush([A, B], { repaint: false });
  }
  flush([A, B]);
  const merged = assertConverged([A, B], 'r1');
  assert.equal(merged.stroke, '#00aa00', 'A ended on Redo');
  assert.equal(merged.width, 150);
  assert.equal(merged.height, 55);
});

// ---------------------------------------------------------------------------
// Drags
// ---------------------------------------------------------------------------

test('a drag (a write every frame) keeps a collaborator\'s colour change made mid-drag', () => {
  const [A, B] = setup([rect('r1')]);
  for (let frame = 1; frame <= 10; frame += 1) {
    A.edit('r1', (o) => ({ ...o, left: 10 + frame * 5, top: 20 + frame * 3 }), { record: false });
    if (frame === 4) B.edit('r1', (o) => ({ ...o, stroke: '#00aa00' }));
    if (frame === 6) flush([A, B]); // A paints B's colour mid-drag
    if (frame === 7) B.edit('r1', (o) => ({ ...o, stroke: '#0000aa' })); // not yet on A's screen
  }
  flush([A, B]);
  const merged = assertConverged([A, B], 'r1');
  assert.equal(merged.left, 60);
  assert.equal(merged.top, 50);
  assert.equal(merged.stroke, '#0000aa', 'A\'s later frames carried the older colour but never wrote it back');
});

test('a drag whose frames are rebuilt from the drag-start object keeps a field a collaborator changes mid-drag', () => {
  const [A, B] = setup([rect('r1')]);
  const start = A.find('r1');
  const frame = (n) => {
    A.screen = {
      ...A.screen,
      1: { ...A.screen[1], objects: A.screen[1].objects.map((o) => (o.data.id === 'r1' ? { ...start, left: 10 + n } : o)) },
    };
    A.capture();
  };
  frame(1);
  frame(2);
  B.edit('r1', (o) => ({ ...o, opacity: 0.5 }));
  flush([A, B]); // A paints B's opacity between frames
  frame(3);
  frame(4);
  flush([A, B]);
  const merged = assertConverged([A, B], 'r1');
  assert.equal(merged.left, 14);
  assert.equal(merged.opacity, 0.5, 'frames built from the pre-drag object never wrote the old opacity back');
});

test('polygon/polyline corner drag release writes only the dragged mark\'s own change', () => {
  const [A, B] = setup([polyline('p1'), rect('r2')]);
  // A starts a corner drag: a copy of the whole page is taken.
  const dragStart = structuredClone(A.find('p1'));
  const dragPage = structuredClone(A.screen[1]);
  dragPage.objects[0] = { ...dragPage.objects[0], points: [{ x: 0, y: 0 }, { x: 50, y: 70 }, { x: 100, y: 0 }], height: 70, pathOffset: { x: 50, y: 35 } };
  // Meanwhile B recolours the polyline, recolours r2 and adds a mark.
  B.edit('p1', (o) => ({ ...o, stroke: '#ff8800' }));
  B.edit('r2', (o) => ({ ...o, stroke: '#00ff00' }));
  B.screen = { ...B.screen, 1: { ...B.screen[1], objects: [...B.screen[1].objects, rect('r3')] } };
  B.capture();
  flush([A, B]);
  // A releases: the page saved is the page NOW with only p1's drag applied.
  const merged = mergeDraggedMarksOntoPage(A.screen[1], dragPage, { 0: dragStart });
  assert.ok(merged);
  A.screen = { ...A.screen, 1: merged.annotations };
  A.capture();
  flush([A, B]);
  const p1 = assertConverged([A, B], 'p1');
  assert.equal(p1.stroke, '#ff8800', 'B\'s colour survives the release');
  assert.equal(p1.points[1].y, 70, 'A\'s corner lands');
  assert.equal(assertConverged([A, B], 'r2').stroke, '#00ff00');
  assert.ok(A.find('r3') && A.stored('r3'), 'B\'s new mark is not deleted');

  // Control: saving the drag's page copy whole (the old release) would lose them.
  const [C, D] = setup([polyline('p1'), rect('r2')]);
  const staleCopy = structuredClone(C.screen[1]);
  staleCopy.objects[0] = { ...staleCopy.objects[0], height: 70 };
  D.edit('r2', (o) => ({ ...o, stroke: '#00ff00' }));
  flush([C, D]);
  C.screen = { ...C.screen, 1: staleCopy };
  C.capture();
  flush([C, D]);
  assert.equal(C.stored('r2').stroke, '#ff0000', 'the whole-page copy puts the old colour back');
});

test('mergeDraggedMarksOntoPage finds the mark by id and skips a mark deleted during the drag', () => {
  const start = polyline('p1');
  const dragged = { ...start, height: 40 };
  const current = { objects: [rect('r0'), { ...start, stroke: '#123123' }] };
  const merged = mergeDraggedMarksOntoPage(current, { objects: [dragged] }, { 0: start });
  assert.equal(merged.indexes[0], 1);
  assert.equal(merged.annotations.objects[1].height, 40);
  assert.equal(merged.annotations.objects[1].stroke, '#123123');
  assert.equal(merged.annotations.objects[0], current.objects[0], 'other marks kept by reference');
  assert.equal(mergeDraggedMarksOntoPage({ objects: [rect('r0')] }, { objects: [dragged] }, { 0: start }), null);
});

// ---------------------------------------------------------------------------
// Reload / persistence / conversion / export
// ---------------------------------------------------------------------------

test('reload: snapshot + tail round trip reproduces the merged document', () => {
  const [A, B] = setup([rect('r1'), polyline('p1'), callout('c1')]);
  const snapshot = encodeSnapshot(A.doc);
  A.edit('r1', (o) => ({ ...o, stroke: '#00aa00' }));
  B.edit('r1', (o) => ({ ...o, width: 222 }));
  B.edit('c1', (o) => ({ ...o, data: { ...o.data, legacyCallout: { ...o.data.legacyCallout, text: 'changed' } } }));
  const tail = [...A.outbox, ...B.outbox];
  flush([A, B]);
  const reopened = hydrateDoc(snapshot, tail, new Y.Doc());
  assert.deepEqual(
    JSON.parse(JSON.stringify(docToByPage(reopened))),
    JSON.parse(JSON.stringify(docToByPage(A.doc))),
  );
  const r1 = readAnnotationObject(reopened, 'r1');
  assert.equal(r1.stroke, '#00aa00');
  assert.equal(r1.width, 222);
  assert.equal(readAnnotationObject(reopened, 'c1').data.legacyCallout.text, 'changed');
});

test('one-time conversion: a store-v1 document (whole objects) becomes per-field maps, same content', () => {
  const doc = new Y.Doc();
  const map = getAnnotationsMap(doc);
  map.set('r1', { p: 1, o: rect('r1') });
  map.set('p1', { p: 2, o: polyline('p1') });
  map.set('broken', { nope: true });
  const before = JSON.parse(JSON.stringify(docToByPage(doc)));
  assert.equal(countLegacyAnnotationEntries(doc), 3);
  const result = convertLegacyAnnotationEntries(doc);
  assert.deepEqual(result, { converted: 2, dropped: 1 });
  assert.equal(countLegacyAnnotationEntries(doc), 0);
  assert.ok(isYMap(map.get('r1')));
  assert.equal(getMetaValue(doc, ANNOTATION_STORE_VERSION_META_KEY), ANNOTATION_STORE_VERSION);
  assert.deepEqual(JSON.parse(JSON.stringify(docToByPage(doc))), before);
  let updates = 0;
  doc.on('update', () => { updates += 1; });
  assert.deepEqual(convertLegacyAnnotationEntries(doc), { converted: 0, dropped: 0 });
  assert.equal(updates, 0, 'a converted document is never rewritten');
});

test('a screen on a not-yet-converted document that re-projects identical marks writes nothing', () => {
  // A viewer (no conversion rights) opens a store-v1 document; the hydrate
  // re-projects callouts as fresh, identical objects. No write may happen:
  // the server would reject a viewer's write and roll the screen back.
  const seed = new Y.Doc();
  getAnnotationsMap(seed).set('c1', { p: 1, o: callout('c1') });
  getAnnotationsMap(seed).set('r1', { p: 1, o: rect('r1') });
  const peer = makePeer('V', Y.encodeStateAsUpdate(seed));
  let writes = 0;
  peer.doc.on('update', (_update, origin) => { if (origin !== 'seed') writes += 1; });
  peer.repaint();
  peer.screen = {
    ...peer.screen,
    1: { ...peer.screen[1], objects: peer.screen[1].objects.map((o) => structuredClone(o)) },
  };
  peer.capture();
  assert.equal(writes, 0);
  assert.equal(countLegacyAnnotationEntries(peer.doc), 2, 'still unconverted');
  // A real edit converts just that mark.
  peer.edit('r1', (o) => ({ ...o, stroke: '#00ff00' }));
  assert.ok(isYMap(getAnnotationsMap(peer.doc).get('r1')));
  assert.equal(peer.stored('r1').stroke, '#00ff00');
  assert.equal(countLegacyAnnotationEntries(peer.doc), 1);
});

test('export reflects the merged state (colour from one person, size from the other)', async () => {
  const [A, B] = setup([rect('r1', { left: 20, top: 30, width: 100, height: 50 })]);
  A.edit('r1', (o) => ({ ...o, stroke: '#00ff00' }));
  B.edit('r1', (o) => ({ ...o, width: 150 }));
  flush([A, B]);
  const source = await PDFDocument.create();
  source.addPage([400, 400]);
  const sourceBytes = await source.save();
  const exportedBytes = await savePDFWithAnnotationsPdfLib(
    {
      name: 'merged.pdf',
      async arrayBuffer() {
        return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
      },
    },
    docToByPage(B.doc),
    { 1: { width: 400, height: 400 } },
    null,
    { returnBytes: true },
  );
  const exported = await PDFDocument.load(exportedBytes);
  const annots = exported.getPage(0).node.lookup(PDFName.of('Annots'));
  assert.equal(annots.size(), 1);
  const annot = annots.lookup(0);
  const rectValues = annot.lookup(PDFName.of('Rect')).asArray().map((value) => value.asNumber());
  const width = Math.abs(rectValues[2] - rectValues[0]);
  assert.ok(Math.abs(width - 150) <= 4, `exported width follows B (${width})`);
  const colour = annot.lookup(PDFName.of('C')).asArray().map((value) => value.asNumber());
  assert.deepEqual(colour.map((value) => Math.round(value * 255)), [0, 255, 0], 'exported colour follows A');
});

// ---------------------------------------------------------------------------
// Sync layer: an offline edit reaches peers that already have the document
// open once the editor is back online.
// ---------------------------------------------------------------------------

function createCloud(documentId) {
  const rows = [];
  let snapshot = null;
  const channels = new Set();
  const broadcast = (row) => {
    for (const channel of channels) {
      if (channel.client.online) queueMicrotask(() => channel.insert?.({ new: row }));
    }
  };
  const readBuilder = (client) => {
    let gtSeq = null;
    let selected = '';
    const filters = new Map();
    const builder = {
      select(columns) { selected = columns; return builder; },
      eq(column, value) { filters.set(column, value); return builder; },
      gt(_column, value) { gtSeq = Number(value); return builder; },
      order() { return builder; },
      limit() { return builder; },
      then(resolve, reject) {
        if (!client.online) return resolve({ data: null, error: { code: 'XX000', message: 'offline' } });
        let data = rows.filter((row) => (
          [...filters].every(([column, value]) => row[column] === value)
          && (gtSeq == null || row.seq > gtSeq)
        ));
        if (selected === 'client_seq') data = data.map((row) => ({ client_seq: row.client_seq }));
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return builder;
  };
  const makeClient = (actor) => {
    const client = { online: true, actor, appendCalls: 0 };
    client.supabase = {
      async rpc(name, args) {
        if (!client.online) return { data: null, error: { code: 'XX000', message: 'offline' } };
        if (name === 'append_annotation_update') {
          client.appendCalls += 1;
          const existing = rows.find((row) => row.client_id === args.p_client_id && row.client_seq === args.p_client_seq);
          if (existing) return { data: [{ seq: existing.seq }], error: null };
          const row = {
            document_id: documentId,
            client_id: args.p_client_id,
            client_seq: args.p_client_seq,
            actor_user_id: actor,
            data: args.p_data,
            seq: rows.length + 1,
          };
          rows.push(row);
          broadcast(row);
          return { data: [{ seq: row.seq }], error: null };
        }
        if (name === 'store_annotation_snapshot') {
          snapshot = { snapshot: args.p_snapshot, at_seq: args.p_at_seq, encoding_version: args.p_encoding_version, writer_id: args.p_writer_id, writer_epoch: args.p_writer_epoch };
          return { data: true, error: null };
        }
        throw new Error(`unexpected rpc ${name}`);
      },
      from(table) {
        if (table === 'annotation_updates') return readBuilder(client);
        if (table === 'annotation_snapshots') {
          return {
            select() {
              const b = { eq() { return b; }, async maybeSingle() { return client.online ? { data: snapshot, error: null } : { data: null, error: { code: 'XX000', message: 'offline' } }; } };
              return b;
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
      channel() {
        const channel = { client, insert: null, status: null };
        channels.add(channel);
        client.channel = channel;
        return {
          on(_event, _filter, callback) { channel.insert = callback; return this; },
          subscribe(callback) { channel.status = callback; queueMicrotask(() => callback('SUBSCRIBED')); return this; },
        };
      },
      async removeChannel() { channels.delete(client.channel); },
    };
    return client;
  };
  return { rows, makeClient, get snapshot() { return snapshot; } };
}

const settle = async (ms = 30) => { await new Promise((resolve) => setTimeout(resolve, ms)); };

test('offline edit, then reconnect: peers that already have the document open receive it live', async () => {
  const documentId = 'field-sync-offline';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const bob = cloud.makeClient('user-b');
  const open = (client, clientId) => openAnnotationDoc({
    documentId,
    supabase: client.supabase,
    clientId,
    actorUserId: client.actor,
    enableLocal: false,
    enableRealtime: true,
    doc: new Y.Doc(),
    repairRetryDelayMs: 60_000,
    snapshotRetryDelayMs: 0,
    requestTimeoutMs: 2_000,
  });
  const a = await open(alice, 'alice');
  a.applyByPage({ 1: { objects: [rect('r1')] } });
  await a.drain();
  const b = await open(bob, 'bob');
  await settle();
  let bobPainted = null;
  b.onChange(() => { bobPainted = b.getByPage(); });
  assert.equal(b.getByPage()[1].objects[0].stroke, '#ff0000');

  // Alice goes offline and recolours; the WAL append and the checkpoint fail.
  alice.online = false;
  const aScreen = a.getByPage();
  a.applyByPage({ 1: { ...aScreen[1], objects: [{ ...aScreen[1].objects[0], stroke: '#00aa00' }] } });
  await a.drain();
  await settle();
  assert.equal(a.isSyncHealthy(), false);
  // Bob edits another field meanwhile (online).
  const bScreen = b.getByPage();
  b.applyByPage({ 1: { ...bScreen[1], objects: [{ ...bScreen[1].objects[0], width: 260 }] } });
  await b.drain();

  // Alice reconnects: the channel re-subscribes, the gap is repaired by a
  // checkpoint, and the edit the checkpoint covered is re-sent live.
  alice.online = true;
  alice.channel.status('SUBSCRIBED');
  for (let i = 0; i < 40 && b.getByPage()[1].objects[0].stroke !== '#00aa00'; i += 1) await settle(25);
  const bobView = b.getByPage()[1].objects[0];
  assert.equal(bobView.stroke, '#00aa00', 'Bob (already open) received Alice\'s offline edit live');
  assert.equal(bobView.width, 260, 'and keeps his own concurrent size change');
  assert.ok(bobPainted, 'Bob\'s screen was notified');
  for (let i = 0; i < 40 && a.getByPage()[1].objects[0].width !== 260; i += 1) await settle(25);
  const aliceView = a.getByPage()[1].objects[0];
  assert.equal(aliceView.width, 260);
  assert.equal(aliceView.stroke, '#00aa00');
  assert.equal(a.isSyncHealthy(), true);

  await a.destroy();
  await b.destroy();
  // A cold open replays snapshot + WAL to the same merged mark.
  const carol = cloud.makeClient('user-c');
  const c = await open(carol, 'carol');
  const coldView = c.getByPage()[1].objects[0];
  assert.equal(coldView.stroke, '#00aa00');
  assert.equal(coldView.width, 260);
  await c.destroy();
  assert.ok(cloud.rows.length >= 3);
  void bytesToPgHex; void pgHexToBytes;
});

// ---------------------------------------------------------------------------
// Write size (bytes are deterministic; wall-clock budgets live in
// tests/annotationFieldSyncPerf.test.mjs on the non-blocking perf lane).
// ---------------------------------------------------------------------------

test('a drag frame on a 5,000-mark page writes only the moved fields', () => {
  const objects = Array.from({ length: 5000 }, (_, index) => rect(`m${index}`, { left: index % 500, top: Math.floor(index / 500) * 20 }));
  const [A] = setup(objects, ['A']);
  const frameBytes = [];
  A.doc.on('update', (update) => { frameBytes.push(update.length); });
  for (let frame = 1; frame <= 5; frame += 1) {
    A.edit('m42', (o) => ({ ...o, left: 42 + frame, top: frame }), { record: false });
  }
  assert.equal(frameBytes.length, 5);
  assert.ok(Math.max(...frameBytes) < 80, `a rect drag frame writes two numbers (${Math.max(...frameBytes)} bytes)`);
});
