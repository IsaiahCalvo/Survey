// w28 (2026-09-24) — marks drawn on older builds come back.
//
// Older builds stored every mark as one plain { p, o } value in the Y.Doc's
// `annotations` map. The per-field store (v3) reads only `marks`, so those
// marks stopped showing (seen on "Package 2 - Rev 4 -- IC.pdf": 12 marks on
// page 1 and 3 pen strokes on page 11). legacyMarksCarryOver.js copies them
// into `marks` once per document. These tests pin:
//   * every mark type reads back exactly as the old build read it (identity
//     normalization, counter numbering, eraser lanes), in the old paint order;
//   * the PDF's own imported markup is left to the embedded import;
//   * two screens carrying at once converge, with every mark once;
//   * a carried mark deleted later never comes back; re-opening writes nothing;
//   * a mark already in `marks` is never overwritten; the old map is untouched;
//   * through the real sync handle, no WAL row is over 256 KB and the marker
//     can never be seen without every carried mark before it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import {
  docToByPage,
  docToSurveyMarkers,
  getMetaValue,
  syncByPageToDoc,
} from '../src/services/annotationDocStore.js';
import {
  LEGACY_ANNOTATIONS_MAP,
  MARKS_MAP,
  readAnnotationEntry,
  stableStringify,
  writeAnnotationMark,
} from '../src/services/annotationMarkStore.js';
import {
  LEGACY_MARKS_CARRIED_MARKER_KEY,
  carryOverLegacyMarks,
  legacyCarryOverWaitsForEmbeddedImport,
  legacyMarksCarryOverPending,
} from '../src/services/legacyMarksCarryOver.js';
import { openAnnotationDoc, __test } from '../src/services/annotationDocSync.js';
import { WAL_UPDATE_MAX_BYTES, splitYjsUpdate } from '../src/services/annotationUpdateSplit.js';
import { EMBEDDED_IMPORT_MARKER_KEY } from '../src/utils/embeddedImportGate.js';
import {
  normalizeAnnotationIdentity,
  setAnnotationStorageKey,
} from '../src/utils/annotationStorageIdentity.js';

const { bytesToPgHex, pgHexToBytes } = __test;

// ---------------------------------------------------------------------------
// Old-format fixtures: one of every mark type the app draws, shaped like the
// objects older builds stored (Package 2's page-1 marks included: a Rect with
// a stroke contract, pen paths, counter circles, Textboxes).
// ---------------------------------------------------------------------------

const author = { authorId: 'owner-1' };
function penPath(seed, points = 30) {
  const path = [['M', 10 + seed, 20 + seed]];
  for (let index = 1; index < points; index += 1) {
    path.push(['Q', 10 + seed + index, 20 + seed + (index % 7), 11 + seed + index, 21 + seed + (index % 5)]);
  }
  return path;
}

const OLD_MARKS = [
  // key, page, object
  ['pen-1', 1, {
    type: 'path', path: penPath(1), left: 11, top: 21, width: 40, height: 8,
    stroke: '#e11d48', strokeWidth: 3, fill: null, strokeLineCap: 'round', strokeLineJoin: 'round',
    pathOffset: { x: 31, y: 25 }, scaleX: 1, scaleY: 1, angle: 0, opacity: 1,
    meta: { ...author }, data: { id: 'pen-1', tool: 'pen' },
  }],
  ['highlighter-1', 1, {
    type: 'path', path: penPath(2, 12), left: 12, top: 60, width: 30, height: 6,
    stroke: 'rgba(250, 204, 21, 1)', strokeWidth: 14, fill: null, opacity: 0.4,
    globalCompositeOperation: 'multiply', meta: { ...author },
    data: { id: 'highlighter-1', tool: 'highlighter', isHighlighter: true },
  }],
  ['rect-1', 1, {
    type: 'Rect', left: 100, top: 120, width: 80, height: 40, fill: 'transparent',
    stroke: 'rgba(255, 0, 0, 1)', strokeWidth: 2, strokeUniform: true, rx: 0, ry: 0,
    data: { id: 'rect-1', strokeRenderContract: 'drawn-centered-stroke' },
  }],
  ['ellipse-1', 1, {
    type: 'ellipse', left: 200, top: 120, rx: 30, ry: 20, width: 60, height: 40,
    fill: 'rgba(0, 0, 255, 0.2)', stroke: '#0000ff', strokeWidth: 2,
    data: { id: 'ellipse-1', tool: 'ellipse' },
  }],
  ['line-1', 1, {
    type: 'line', x1: 0, y1: 0, x2: 120, y2: 40, left: 20, top: 200, width: 120, height: 40,
    stroke: '#111111', strokeWidth: 2, data: { id: 'line-1', tool: 'line', midpoint: { x: 60, y: 22 } },
  }],
  ['arrow-1', 1, {
    type: 'line', x1: 0, y1: 40, x2: 120, y2: 0, left: 20, top: 260, width: 120, height: 40,
    stroke: '#111111', strokeWidth: 2,
    data: { id: 'arrow-1', tool: 'arrow', arrowHead: { end: 'open', start: null, size: 12 } },
  }],
  ['polyline-1', 1, {
    type: 'polyline', left: 5, top: 300, width: 100, height: 10,
    points: [{ x: 0, y: 0 }, { x: 50, y: 10 }, { x: 100, y: 0 }], pathOffset: { x: 50, y: 5 },
    stroke: '#0000ff', strokeWidth: 2, fill: null, data: { id: 'polyline-1', tool: 'polyline' },
  }],
  ['polygon-1', 1, {
    type: 'polygon', left: 5, top: 340, width: 60, height: 60,
    points: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 30, y: 60 }], pathOffset: { x: 30, y: 30 },
    stroke: '#16a34a', strokeWidth: 2, fill: 'rgba(22, 163, 74, 0.1)', data: { id: 'polygon-1', tool: 'polygon' },
  }],
  ['cloud-1', 2, {
    type: 'path', path: [['M', 0, 0], ['A', 5, 5, 0, 0, 1, 10, 0], ['A', 5, 5, 0, 0, 1, 20, 0], ['Z']],
    left: 300, top: 300, width: 20, height: 5, stroke: '#dc2626', strokeWidth: 1.5, fill: null,
    data: { id: 'cloud-1', tool: 'cloud', cloud: { version: 17, arcSize: 10, outline: [[0, 0], [20, 0], [20, 5]] } },
  }],
  ['callout-1', 2, {
    type: 'group', left: 50, top: 400, width: 220, height: 90, subTargetCheck: true,
    objects: [
      { type: 'line', x1: 0, y1: 0, x2: 40, y2: 30, stroke: '#ff0000', strokeWidth: 1 },
      { type: 'rect', left: 40, top: 30, width: 180, height: 60, fill: '#ffffff', stroke: '#ff0000' },
      { type: 'textbox', left: 44, top: 34, width: 172, text: 'Check this\nsecond line', fontSize: 12, fontFamily: 'Helvetica' },
    ],
    data: {
      id: 'callout-1', type: 'callout', annotationType: 'callout',
      legacyCallout: {
        id: 'callout-1', page: 2, text: 'Check this\nsecond line',
        box: { x: 0.1, y: 0.5, w: 0.36, h: 0.11 }, arrow: { x: 0.05, y: 0.45 }, knee: { x: 0.08, y: 0.47 },
        style: { stroke: '#ff0000', fill: '#ffffff', fontSize: 12, fontFamily: 'Helvetica', lineStyle: 'solid' },
      },
    },
  }],
  ['textbox-1', 2, {
    type: 'Textbox', text: 'Field note: verify with #drawing 4', left: 60, top: 60, width: 200, height: 40,
    fontSize: 14, fontFamily: 'Helvetica', fill: '#111111', textAlign: 'left', lineHeight: 1.16,
    styles: {}, charSpacing: 0, splitByGrapheme: false, backgroundColor: '',
    '#note': 'a field whose own name starts with #', '\\raw': 'and one with a backslash',
    data: { id: 'textbox-1', textBoxFrame: { padding: 4, border: null } },
  }],
  ['counter-1', 2, {
    type: 'circle', left: 400, top: 100, radius: 10, fill: '#ef4444', stroke: '#ffffff', strokeWidth: 1,
    data: { id: 'counter-1', type: 'counter', createdAt: 1786896696322, pointerAngle: 225, displayNumber: 1, seriesId: 'series-a', seriesStart: 1 },
  }],
  ['counter-2', 2, {
    type: 'circle', left: 430, top: 100, radius: 10, fill: '#ef4444', stroke: '#ffffff', strokeWidth: 1,
    data: { id: 'counter-2', type: 'counter', createdAt: 1786896696804, pointerAngle: 225, displayNumber: 2, seriesId: 'series-a', seriesStart: 1 },
  }],
  ['stamp-1', 3, {
    type: 'image', left: 100, top: 100, width: 120, height: 40, scaleX: 1, scaleY: 1,
    src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    data: { id: 'stamp-1', type: 'stamp', stampId: 'approved', label: 'APPROVED' },
  }],
  ['markup-1', 3, {
    type: 'rect', left: 72, top: 90, width: 140, height: 12, fill: 'rgba(250, 204, 21, 0.35)', stroke: null,
    data: {
      id: 'markup-1', type: 'text-markup', markupType: 'highlight', selectedText: 'the quick brown fox',
      quads: [[72, 90, 212, 90, 72, 102, 212, 102]],
      textRange: { start: { item: 3, offset: 0 }, end: { item: 3, offset: 19 } },
      textRangeModel: { version: 2, items: [3] },
    },
  }],
  // A mark whose storage key differs from its data.id (a legacy duplicate):
  // the key is authoritative identity, exactly as the old read treated it.
  ['legacy-sentinel-key', 3, {
    type: 'rect', left: 1, top: 1, width: 5, height: 5, stroke: '#000', data: { id: 'rect-dup-source' },
  }],
];

// The PDF file's own markup, imported by an older build: never carried (the
// embedded import owns it).
const OLD_PDF_IMPORTED = [
  ['3411R', 3, {
    type: 'path', path: [['M', 1, 1], ['L', 2, 2]], left: 675, top: 419, width: 3, height: 5,
    isPdfImported: true, pdfAnnotationId: '3411R', pdfAnnotationType: 'Ink', layer: 'pdf-annotations', id: '3411R',
    data: { id: '3411R', pdfInkRenderMode: 'filled-outline' },
  }],
  ['pdf-free-text', 3, {
    type: 'textbox', text: 'from the file', left: 5, top: 5, width: 50, height: 10,
    pdfAnnotationId: '77R', data: { id: 'pdf-free-text' },
  }],
];

function buildOldFormatDoc({ extra = [] } = {}) {
  const doc = new Y.Doc();
  doc.transact(() => {
    const old = doc.getMap(LEGACY_ANNOTATIONS_MAP);
    for (const [key, page, object] of [...OLD_MARKS, ...OLD_PDF_IMPORTED, ...extra]) {
      old.set(key, { p: page, o: JSON.parse(JSON.stringify(object)) });
    }
    old.set('unreadable', { p: null, o: 'not a mark' });
    doc.getMap('surveyMarkers').set('surveyMarker-1', {
      id: 'surveyMarker-1', pageNumber: 1, bounds: { x: 1, y: 2, width: 3, height: 4 }, moduleId: 'module-1',
    });
    doc.getMap('annoMeta').set('spaces', [{ name: 'Space 2', assignedPages: [] }]);
  }, 'hydrate');
  // Reload through bytes, like every real open (values decoded from the wire).
  const loaded = new Y.Doc();
  Y.applyUpdate(loaded, Y.encodeStateAsUpdate(doc));
  return loaded;
}

// What the old build handed the viewer for one stored entry (the head of the
// reference build's docToByPage; lanes and counters then run the same code).
function oldBuildRead(key, object) {
  const stored = JSON.parse(JSON.stringify(object));
  setAnnotationStorageKey(stored, key);
  const normalized = normalizeAnnotationIdentity(stored).object;
  return JSON.parse(JSON.stringify(normalized));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotOfLegacyMap(doc) {
  return stableStringify(doc.getMap(LEGACY_ANNOTATIONS_MAP).toJSON());
}

function carriedKeys() {
  return OLD_MARKS.map(([key]) => key);
}

// ---------------------------------------------------------------------------
// Every mark type
// ---------------------------------------------------------------------------

test('every mark type drawn on an older build is carried and reads back exactly as the old build read it', () => {
  const doc = buildOldFormatDoc();
  const legacyBefore = snapshotOfLegacyMap(doc);
  assert.equal(doc.getMap(MARKS_MAP).size, 0);
  assert.deepEqual(docToByPage(doc), {}, 'nothing shows before the carry-over');
  assert.equal(legacyMarksCarryOverPending(doc), true);

  const result = carryOverLegacyMarks(doc);
  assert.equal(result.status, 'done');
  assert.equal(result.eligible, OLD_MARKS.length);
  assert.equal(result.carried, OLD_MARKS.length);
  assert.equal(result.skippedPdf, OLD_PDF_IMPORTED.length);
  assert.equal(result.skippedInvalid, 1);
  assert.equal(result.markerWritten, true);

  for (const [key, page, object] of OLD_MARKS) {
    const entry = readAnnotationEntry(doc, key);
    assert.ok(entry, `${key} is in the new store`);
    assert.equal(entry.p, page, `${key} page`);
    assert.deepEqual(plain(entry.o), oldBuildRead(key, object), `${key} has the same fields`);
  }
  for (const [key] of OLD_PDF_IMPORTED) {
    assert.equal(doc.getMap(MARKS_MAP).has(key), false, `${key} (the PDF's own markup) is left to the embedded import`);
  }
  assert.equal(doc.getMap(MARKS_MAP).has('unreadable'), false);

  // The page lists: same marks, same paint order as the old map, counters
  // numbered the same way.
  const byPage = docToByPage(doc);
  for (const page of [1, 2, 3]) {
    const expectedKeys = OLD_MARKS.filter(([, p]) => p === page).map(([key]) => key);
    const shownKeys = byPage[page].objects.map((object) => object.data.id);
    const expectedIds = expectedKeys.map((key) => oldBuildRead(key, OLD_MARKS.find(([k]) => k === key)[2]).data.id);
    assert.deepEqual(shownKeys, expectedIds, `page ${page} order`);
  }
  const counters = byPage[2].objects.filter((object) => object.data?.type === 'counter');
  assert.deepEqual(counters.map((object) => object.data.displayNumber), [1, 2]);

  // Nothing else moved.
  assert.equal(snapshotOfLegacyMap(doc), legacyBefore, 'the old map is untouched');
  assert.deepEqual(Object.keys(docToSurveyMarkers(doc)), ['surveyMarker-1'], 'Survey Markers still read');
  assert.deepEqual(getMetaValue(doc, 'spaces'), [{ name: 'Space 2', assignedPages: [] }]);
  assert.equal(legacyMarksCarryOverPending(doc), false);
  assert.equal(getMetaValue(doc, LEGACY_MARKS_CARRIED_MARKER_KEY).carried, OLD_MARKS.length);
});

test('an old eraser lane still applies to the carried mark (a fully erased stroke stays hidden)', () => {
  const doc = buildOldFormatDoc();
  // Lanes are shared by every build and keyed by the mark's storage key.
  doc.getMap('annotationEraserOps').set('writer-old\u0000pen-1', {
    storageKey: 'pen-1', annotationId: 'pen-1', pageNumber: 1, operationId: 'erase-op-1',
    deleted: true, writerId: 'writer-old',
  });
  carryOverLegacyMarks(doc);
  const shown = docToByPage(doc)[1].objects.map((object) => object.data.id);
  assert.equal(shown.includes('pen-1'), false, 'erased on the old build, still erased');
  assert.ok(readAnnotationEntry(doc, 'pen-1'), 'the base mark is carried (the lane decides what shows)');
  assert.ok(shown.includes('highlighter-1'));
});

test('a mark stored by the short-lived per-field build (a nested map in the old map) is carried too', () => {
  const doc = buildOldFormatDoc();
  const scratch = new Y.Doc();
  writeAnnotationMark(scratch, 'v2-rect', 4, {
    type: 'rect', left: 3, top: 4, width: 5, height: 6, stroke: '#123456', data: { id: 'v2-rect' },
  });
  // Copy scratch's mark map under the old map name.
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  const source = scratch.getMap(MARKS_MAP).get('v2-rect');
  copy.transact(() => {
    const mark = new Y.Map();
    mark.set('p', 4);
    const objectMap = new Y.Map();
    source.get('o').forEach((value, key) => {
      if (value instanceof Y.Map) {
        const nested = new Y.Map();
        value.forEach((v, k) => nested.set(k, v));
        objectMap.set(key, nested);
      } else objectMap.set(key, value);
    });
    mark.set('o', objectMap);
    copy.getMap(LEGACY_ANNOTATIONS_MAP).set('v2-rect', mark);
  });
  const result = carryOverLegacyMarks(copy);
  assert.equal(result.carried, OLD_MARKS.length + 1);
  assert.deepEqual(plain(readAnnotationEntry(copy, 'v2-rect').o), {
    type: 'rect', left: 3, top: 4, width: 5, height: 6, stroke: '#123456', data: { id: 'v2-rect' },
  });
});

// ---------------------------------------------------------------------------
// Never overwrite, deletions stick, re-open writes nothing
// ---------------------------------------------------------------------------

test('a mark already in the new store is never overwritten by the carry-over', () => {
  const doc = buildOldFormatDoc();
  const newer = { ...OLD_MARKS.find(([key]) => key === 'rect-1')[2], stroke: '#00ff00', left: 500 };
  writeAnnotationMark(doc, 'rect-1', 1, newer);
  const result = carryOverLegacyMarks(doc);
  assert.equal(result.alreadyPresent, 1);
  assert.equal(result.carried, OLD_MARKS.length - 1);
  const entry = readAnnotationEntry(doc, 'rect-1');
  assert.equal(entry.o.stroke, '#00ff00');
  assert.equal(entry.o.left, 500);
});

test('a carried mark deleted afterwards never comes back (this screen, a peer, or a later open)', () => {
  const a = buildOldFormatDoc();
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  carryOverLegacyMarks(a);

  // Delete one carried mark the way the viewer does (capture without it).
  const byPage = docToByPage(a);
  const withoutRect = {
    ...byPage,
    1: { objects: byPage[1].objects.filter((object) => object.data.id !== 'rect-1') },
  };
  syncByPageToDoc(a, withoutRect);
  assert.equal(readAnnotationEntry(a, 'rect-1'), undefined);

  // Same screen runs it again (a remount): nothing.
  assert.equal(carryOverLegacyMarks(a).status, 'already');
  assert.equal(readAnnotationEntry(a, 'rect-1'), undefined);

  // A peer that receives everything, then opens and runs it: nothing.
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  assert.equal(carryOverLegacyMarks(b).status, 'already');
  assert.equal(readAnnotationEntry(b, 'rect-1'), undefined);

  // A later open from the saved state: nothing.
  const reopened = new Y.Doc();
  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(a));
  assert.equal(carryOverLegacyMarks(reopened).status, 'already');
  assert.equal(readAnnotationEntry(reopened, 'rect-1'), undefined);
  assert.equal(docToByPage(reopened)[1].objects.some((object) => object.data.id === 'rect-1'), false);
  assert.ok(readAnnotationEntry(reopened, 'pen-1'), 'the other carried marks stay');
});

test('re-opening a carried document writes nothing and shows the same marks', () => {
  const first = buildOldFormatDoc();
  carryOverLegacyMarks(first);
  const shownBefore = stableStringify(docToByPage(first));

  const reopened = new Y.Doc();
  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(first));
  const updates = [];
  reopened.on('update', (update) => updates.push(update));
  assert.equal(legacyMarksCarryOverPending(reopened), false);
  const again = carryOverLegacyMarks(reopened);
  assert.equal(again.status, 'already');
  assert.equal(updates.length, 0, 'no update at all');
  assert.equal(stableStringify(docToByPage(reopened)), shownBefore);
});

test('a document with no old user-drawn marks writes nothing and no marker', () => {
  const doc = new Y.Doc();
  doc.getMap(LEGACY_ANNOTATIONS_MAP).set('3411R', { p: 3, o: OLD_PDF_IMPORTED[0][2] });
  const updates = [];
  doc.on('update', (update) => updates.push(update));
  assert.equal(legacyMarksCarryOverPending(doc), false);
  const result = carryOverLegacyMarks(doc);
  assert.equal(result.status, 'nothing');
  assert.equal(updates.length, 0);

  const fresh = new Y.Doc();
  assert.equal(legacyMarksCarryOverPending(fresh), false, 'a document created on this build');
  assert.equal(carryOverLegacyMarks(fresh).status, 'nothing');
  assert.equal(fresh.share.has(LEGACY_ANNOTATIONS_MAP), false, 'reading does not create the old map');
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

function exchange(left, right) {
  const toRight = Y.encodeStateAsUpdate(left, Y.encodeStateVector(right));
  const toLeft = Y.encodeStateAsUpdate(right, Y.encodeStateVector(left));
  Y.applyUpdate(right, toRight, 'remote');
  Y.applyUpdate(left, toLeft, 'remote');
}

test('two screens carrying at the same moment converge: every mark once, same fields, one marker', () => {
  const base = buildOldFormatDoc();
  const a = new Y.Doc();
  const b = new Y.Doc();
  Y.applyUpdate(a, Y.encodeStateAsUpdate(base));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(base));
  assert.equal(carryOverLegacyMarks(a).carried, OLD_MARKS.length);
  assert.equal(carryOverLegacyMarks(b).carried, OLD_MARKS.length);
  exchange(a, b);

  // A third screen that gets B's writes first, then A's.
  const c = new Y.Doc();
  Y.applyUpdate(c, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(c, Y.encodeStateAsUpdate(a));

  for (const doc of [a, b, c]) {
    assert.equal(doc.getMap(MARKS_MAP).size, OLD_MARKS.length, 'no duplicates');
    for (const [key, page, object] of OLD_MARKS) {
      const entry = readAnnotationEntry(doc, key);
      assert.equal(entry.p, page);
      assert.deepEqual(plain(entry.o), oldBuildRead(key, object), `${key} converged to the old fields`);
    }
    const shown = docToByPage(doc);
    const ids = Object.values(shown).flatMap((bucket) => bucket.objects.map((object) => object.data.id));
    assert.equal(ids.length, new Set(ids).size, 'each mark shows once');
    assert.equal(ids.length, OLD_MARKS.length);
    assert.ok(getMetaValue(doc, LEGACY_MARKS_CARRIED_MARKER_KEY));
    assert.equal(carryOverLegacyMarks(doc).status, 'already');
  }
  assert.equal(stableStringify(docToByPage(a)), stableStringify(docToByPage(b)));
  assert.equal(stableStringify(docToByPage(a)), stableStringify(docToByPage(c)));
});

test('a screen that opens after another carried writes nothing, so edits made meanwhile survive', () => {
  const a = buildOldFormatDoc();
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  carryOverLegacyMarks(a);
  // A edits a carried mark, B has not opened yet.
  const rect = readAnnotationEntry(a, 'rect-1');
  writeAnnotationMark(a, 'rect-1', 1, { ...rect.o, stroke: '#0000ff' }, { base: rect.o, basePage: 1 });
  // B opens later: it gets A's rows during hydration, then runs the carry-over.
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  const updates = [];
  b.on('update', (update) => updates.push(update));
  assert.equal(carryOverLegacyMarks(b).status, 'already');
  assert.equal(updates.length, 0);
  exchange(a, b);
  assert.equal(readAnnotationEntry(a, 'rect-1').o.stroke, '#0000ff');
  assert.equal(readAnnotationEntry(b, 'rect-1').o.stroke, '#0000ff');
});

test('a carry-over interrupted before its marker resumes and never duplicates', () => {
  const a = buildOldFormatDoc();
  // Write only the first few marks, as if the tab closed mid-way (no marker).
  const marks = OLD_MARKS.slice(0, 4);
  a.transact(() => {
    for (const [key, page, object] of marks) writeAnnotationMark(a, key, page, JSON.parse(JSON.stringify(object)));
  });
  assert.equal(legacyMarksCarryOverPending(a), true);
  const result = carryOverLegacyMarks(a);
  assert.equal(result.alreadyPresent, 4);
  assert.equal(result.carried, OLD_MARKS.length - 4);
  assert.equal(a.getMap(MARKS_MAP).size, OLD_MARKS.length);
});

// ---------------------------------------------------------------------------
// When to run: after the PDF's own embedded import (paint order)
// ---------------------------------------------------------------------------

test('the carry-over waits for the embedded import so old marks stay on top of the PDF markup', () => {
  const doc = buildOldFormatDoc();
  assert.equal(legacyCarryOverWaitsForEmbeddedImport(doc), true);
  // The embedded import appends the PDF's markup, then writes its marker.
  writeAnnotationMark(doc, 'pdf-appearance:3411R:layer:0', 3, {
    type: 'path', path: [['M', 1, 1]], isPdfImported: true, pdfAnnotationId: '3411R', data: { id: 'pdf-appearance:3411R:layer:0' },
  });
  doc.getMap('annoMeta').set(EMBEDDED_IMPORT_MARKER_KEY, { at: 'now', count: 1 });
  assert.equal(legacyCarryOverWaitsForEmbeddedImport(doc), false);
  carryOverLegacyMarks(doc);
  const page3 = docToByPage(doc)[3].objects.map((object) => object.data.id);
  assert.equal(page3[0], 'pdf-appearance:3411R:layer:0', 'the PDF markup paints first (underneath)');
  assert.deepEqual(page3.slice(1), ['stamp-1', 'markup-1', 'rect-dup-source'].map((id, index) => (
    index === 2 ? oldBuildRead('legacy-sentinel-key', OLD_MARKS.find(([key]) => key === 'legacy-sentinel-key')[2]).data.id : id
  )));
});

// ---------------------------------------------------------------------------
// Through the real sync handle: WAL rows, split, marker order
// ---------------------------------------------------------------------------

function makeSupabase() {
  const log = [];
  const supabase = {
    log,
    snapshot: null,
    from(table) {
      if (table === 'annotation_updates') {
        const filters = { gtSeq: null, limit: Infinity };
        const builder = {
          select: () => builder,
          eq: () => builder,
          gt: (_column, value) => { filters.gtSeq = Number(value); return builder; },
          order: () => builder,
          limit: (value) => { filters.limit = Number(value); return builder; },
          insert: (row) => ({
            select: () => ({
              single: async () => {
                const committed = { ...row, seq: log.length + 1 };
                log.push(committed);
                return { data: { seq: committed.seq }, error: null };
              },
            }),
          }),
          maybeSingle: async () => ({ data: null }),
          then: (resolve) => {
            if (filters.gtSeq === null) { resolve({ data: [], error: null }); return; }
            resolve({ data: log.filter((row) => row.seq > filters.gtSeq).slice(0, filters.limit), error: null });
          },
        };
        return builder;
      }
      if (table === 'annotation_snapshots') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: supabase.snapshot }) }) }),
          upsert: async (row) => { supabase.snapshot = row; return { error: null }; },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel() {},
  };
  return supabase;
}

// A big old document: 300 pen strokes of ~6 KB each (~1.8 MB of marks).
function bigOldFormatUpdate() {
  const doc = new Y.Doc();
  doc.transact(() => {
    const old = doc.getMap(LEGACY_ANNOTATIONS_MAP);
    for (let index = 0; index < 300; index += 1) {
      const key = `old-pen-${index}`;
      old.set(key, {
        p: 1 + (index % 5),
        o: {
          type: 'path', path: penPath(index, 120), left: index, top: index, width: 50, height: 9,
          stroke: '#e11d48', strokeWidth: 2, fill: null, data: { id: key, tool: 'pen' },
        },
      });
    }
  });
  return Y.encodeStateAsUpdate(doc);
}

test('through the sync handle: carried in rows under 256 KB, marker last, a fresh device replays every mark', async () => {
  const supabase = makeSupabase();
  supabase.log.push({ seq: 1, data: bytesToPgHex(bigOldFormatUpdate()), client_id: 'old-build', client_seq: 1 });
  const handle = await openAnnotationDoc({
    actorUserId: 'owner', documentId: 'doc-w28-carry', supabase, clientId: 'clientA',
    enableLocal: false, enableRealtime: false, doc: new Y.Doc(),
  });
  assert.deepEqual(handle.getByPage(), {}, 'old marks do not show before the carry-over');
  const notified = [];
  handle.onChange((byPage) => notified.push(byPage));

  const result = handle.carryOverLegacyMarks();
  assert.equal(result.carried, 300);
  assert.ok(result.batches > 1, `carried in ${result.batches} transactions`);
  assert.equal(notified.length, 1, 'the screen is told once');
  assert.equal(Object.values(notified[0]).reduce((sum, page) => sum + page.objects.length, 0), 300);
  await handle.drain();

  const rows = supabase.log.slice(1);
  assert.ok(rows.length > 1);
  for (const row of rows) {
    const size = pgHexToBytes(row.data).length;
    assert.ok(size <= WAL_UPDATE_MAX_BYTES, `row ${size} bytes <= ${WAL_UPDATE_MAX_BYTES}`);
  }
  const seqs = rows.map((row) => row.client_seq);
  assert.deepEqual(seqs, [...seqs].sort((x, y) => x - y));

  // The marker is in the last row, and a device replaying the log sees all 300.
  const replay = new Y.Doc();
  for (const [index, row] of supabase.log.entries()) {
    Y.applyUpdate(replay, pgHexToBytes(row.data));
    const hasMarker = Boolean(getMetaValue(replay, LEGACY_MARKS_CARRIED_MARKER_KEY));
    assert.equal(hasMarker, index === supabase.log.length - 1, `marker only after the last row (row ${index})`);
  }
  assert.equal(replay.getMap(MARKS_MAP).size, 300);
  assert.equal(Object.values(docToByPage(replay)).reduce((sum, page) => sum + page.objects.length, 0), 300);

  // Opening again carries nothing.
  assert.equal(handle.carryOverLegacyMarks().status, 'already');
  await handle.destroy();
});

test('a peer missing one carried row holds the marker back until that row arrives', () => {
  const source = buildOldFormatDoc({
    extra: Array.from({ length: 120 }, (_, index) => [`bulk-${index}`, 5, {
      type: 'path', path: penPath(index, 200), left: 1, top: 1, width: 9, height: 9, stroke: '#000', data: { id: `bulk-${index}` },
    }]),
  });
  const peerBase = Y.encodeStateAsUpdate(source);
  const updates = [];
  source.on('update', (update) => updates.push(update));
  carryOverLegacyMarks(source, { batchBytes: 64 * 1024 });
  assert.ok(updates.length >= 3, `${updates.length} updates`);
  const parts = updates.flatMap((update, index) => (
    index === updates.length - 1 ? [update] : splitYjsUpdate(update)
  ));
  const markerPart = parts[parts.length - 1];

  const peer = new Y.Doc();
  Y.applyUpdate(peer, peerBase);
  parts.slice(0, -1).forEach((part, index) => { if (index !== 1) Y.applyUpdate(peer, part); });
  Y.applyUpdate(peer, markerPart);
  assert.equal(getMetaValue(peer, LEGACY_MARKS_CARRIED_MARKER_KEY), undefined, 'marker held back by the gap');
  Y.applyUpdate(peer, parts[1]);
  assert.ok(getMetaValue(peer, LEGACY_MARKS_CARRIED_MARKER_KEY));
  assert.equal(peer.getMap(MARKS_MAP).size, OLD_MARKS.length + 120);
});

test('carried keys are exactly the old user-drawn keys', () => {
  const doc = buildOldFormatDoc();
  carryOverLegacyMarks(doc);
  assert.deepEqual([...doc.getMap(MARKS_MAP).keys()].sort(), carriedKeys().sort());
});

// ---------------------------------------------------------------------------
// Review fixes (w28 reviews A and B)
// ---------------------------------------------------------------------------

test('review A: a carried mark deleted before the marker row lands never comes back on a third screen', () => {
  const base = buildOldFormatDoc();
  const baseBytes = Y.encodeStateAsUpdate(base);
  const a = new Y.Doc();
  Y.applyUpdate(a, baseBytes);
  const updates = [];
  a.on('update', (update) => updates.push(update));
  carryOverLegacyMarks(a);
  assert.ok(updates.length >= 2, 'batch row(s) then the marker row');
  const batchRows = updates.slice(0, -1);

  // B receives only the batch rows (the marker row has not landed) and
  // deletes a carried mark.
  const b = new Y.Doc();
  Y.applyUpdate(b, baseBytes);
  batchRows.forEach((row) => Y.applyUpdate(b, row));
  const bUpdates = [];
  b.on('update', (update) => bUpdates.push(update));
  b.getMap(MARKS_MAP).delete('rect-1');

  // C hydrates from the log as it stands: base, A's batch, B's delete.
  const c = new Y.Doc();
  Y.applyUpdate(c, baseBytes);
  batchRows.forEach((row) => Y.applyUpdate(c, row));
  bUpdates.forEach((row) => Y.applyUpdate(c, row));
  assert.equal(getMetaValue(c, LEGACY_MARKS_CARRIED_MARKER_KEY), undefined, 'no marker yet on C');
  assert.equal(legacyMarksCarryOverPending(c), false, 'the batch record says rect-1 was carried');
  const result = carryOverLegacyMarks(c);
  assert.equal(result.carried, 0);
  assert.equal(readAnnotationEntry(c, 'rect-1'), undefined, 'still deleted on C');

  // Everyone converges with rect-1 gone.
  for (const [left, right] of [[a, b], [b, c], [a, c]]) exchange(left, right);
  for (const doc of [a, b, c]) assert.equal(readAnnotationEntry(doc, 'rect-1'), undefined);
});

test('review B: the wider "from the PDF" signs are honoured (never carried twice)', () => {
  const doc = new Y.Doc();
  doc.getMap(LEGACY_ANNOTATIONS_MAP).set('flag-only', {
    p: 2, o: { type: 'rect', left: 1, top: 1, width: 2, height: 2, data: { id: 'flag-only', isPdfImported: true } },
  });
  doc.getMap(LEGACY_ANNOTATIONS_MAP).set('type-only', {
    p: 2, o: { type: 'rect', left: 1, top: 1, width: 2, height: 2, pdfAnnotationType: 'Square', data: { id: 'type-only' } },
  });
  assert.equal(carryOverLegacyMarks(doc).status, 'nothing');
  assert.equal(doc.getMap(MARKS_MAP).size, 0);
});

// A PDF ink mark the user edited on the old build (resized / partly erased),
// and the untouched copy the embedded import re-created on this build.
const editedOldPdfMark = (id, extra = {}) => ({
  type: 'path', path: [['M', 0, 0], ['L', 8, 8]], left: 0, top: 0, width: 8, height: 8, scaleX: 0.96, scaleY: 1,
  fill: 'rgba(255, 0, 0, 1)', stroke: null, strokeWidth: 0.9, isPdfImported: true, pdfAnnotationId: id,
  pdfAnnotationType: 'Ink', layer: 'pdf-annotations', id,
  paperEraserGeometry: { version: 1, survivors: 2 },
  pdfImportedEditState: 'edited', pdfImportedEditedAt: '2026-07-26T19:12:40.965Z', pdfImportedEditSource: 'eraser:commit',
  data: { id, pdfInkRenderMode: 'filled-outline', pdfImportedEditState: 'edited' },
  ...extra,
});
const reimportedCopy = (key, id) => ({
  type: 'path', path: [['M', 719, 92], ['L', 739, 114]], left: 719, top: 92, width: 20, height: 22,
  fill: 'rgba(255, 0, 0, 1)', stroke: 'transparent', strokeWidth: 0, isPdfImported: true, pdfAnnotationId: id,
  pdfAnnotationType: 'Ink', layer: 'pdf-annotations', id: key, data: { id: key, pdfInkRenderMode: 'filled-outline' },
});

function editedPdfDoc({ importDone = true } = {}) {
  const doc = buildOldFormatDoc({
    extra: [
      ['4164R', 8, editedOldPdfMark('4164R')],
      ['4175R', 8, editedOldPdfMark('4175R')],
      ['3684R', 6, editedOldPdfMark('3684R')],
      ['9999R', 6, editedOldPdfMark('9999R')],
    ],
  });
  // The embedded import on this build: 4164R under a new key, 4175R under
  // the same key, 3684R deleted by the user (tombstone), 9999R not imported.
  writeAnnotationMark(doc, 'pdf-appearance:4164R:layer:0', 8, reimportedCopy('pdf-appearance:4164R:layer:0', '4164R'));
  writeAnnotationMark(doc, '4175R', 8, reimportedCopy('4175R', '4175R'));
  doc.getMap('deletedPdfAnnotations').set('6\u00003684R', { pageNumber: 6, pdfAnnotationId: '3684R' });
  if (importDone) doc.getMap('annoMeta').set(EMBEDDED_IMPORT_MARKER_KEY, { at: 'now', count: 2 });
  return doc;
}

test('review B: a PDF mark the user edited on the old build keeps that edit (the untouched re-import takes it)', () => {
  const doc = editedPdfDoc();
  const result = carryOverLegacyMarks(doc);
  assert.equal(result.editedPdfReplaced, 2);
  assert.equal(result.editedPdfSkipped, 1, 'the deleted one stays deleted');
  assert.equal(result.editedPdfCreated, 1, 'one with no re-imported copy and no tombstone');
  assert.equal(result.markerWritten, true);

  // Same key as the re-import: the old edited fields, the copy's identity.
  const replaced = readAnnotationEntry(doc, 'pdf-appearance:4164R:layer:0');
  const expected = { ...editedOldPdfMark('4164R'), id: 'pdf-appearance:4164R:layer:0' };
  expected.data = { ...expected.data, id: 'pdf-appearance:4164R:layer:0' };
  assert.deepEqual(plain(replaced.o), oldBuildRead('pdf-appearance:4164R:layer:0', expected));
  assert.equal(doc.getMap(MARKS_MAP).has('4164R'), false, 'no second copy under the old key');
  assert.deepEqual(plain(readAnnotationEntry(doc, '4175R').o), oldBuildRead('4175R', editedOldPdfMark('4175R')));
  assert.equal(doc.getMap(MARKS_MAP).has('3684R'), false);
  assert.deepEqual(plain(readAnnotationEntry(doc, '9999R').o), oldBuildRead('9999R', editedOldPdfMark('9999R')));
  const page8 = docToByPage(doc)[8].objects.filter((object) => object.pdfAnnotationId === '4164R');
  assert.equal(page8.length, 1, 'drawn once');
  assert.equal(carryOverLegacyMarks(doc).status, 'already');
});

test('review B: a re-imported copy the user already edited on this build is not overwritten', () => {
  const doc = editedPdfDoc();
  const copy = readAnnotationEntry(doc, '4175R').o;
  writeAnnotationMark(doc, '4175R', 8, {
    ...copy, left: 500, pdfImportedEditState: 'edited', data: { ...copy.data, pdfImportedEditState: 'edited' },
  });
  const result = carryOverLegacyMarks(doc);
  assert.equal(result.editedPdfReplaced, 1);
  assert.equal(readAnnotationEntry(doc, '4175R').o.left, 500, 'the newer edit wins');
});

test('review B: edited PDF marks wait for the embedded import; the marker is held back until then', () => {
  const doc = editedPdfDoc({ importDone: false });
  const first = carryOverLegacyMarks(doc);
  assert.equal(first.carried, OLD_MARKS.length, 'user-drawn marks do not wait');
  assert.equal(first.editedPdfDeferred, 4);
  assert.equal(first.markerWritten, false);
  assert.equal(legacyMarksCarryOverPending(doc), false, 'nothing to do until the import has run');
  doc.getMap('annoMeta').set(EMBEDDED_IMPORT_MARKER_KEY, { at: 'now', count: 2 });
  assert.equal(legacyMarksCarryOverPending(doc), true);
  const second = carryOverLegacyMarks(doc);
  assert.equal(second.carried, 0);
  assert.equal(second.alreadyPresent, OLD_MARKS.length);
  assert.equal(second.editedPdfReplaced, 2);
  assert.equal(second.markerWritten, true);
});
