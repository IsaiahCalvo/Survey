// w33 (2026-09-25) — small snapshots.
//
// "Package 2 - Rev 4 -- IC.pdf" had a 21.6 MB store (5.5 MB gzipped) that
// every fresh open downloads: the old pre-rebuild `annotations` map (~3.5 MB)
// and imported ink stored 4-5 ways per mark. These tests pin:
//   * render parity: every mark the real Package 2 PDF imports reads back
//     from the compact store with the SAME path, polygons (number for number),
//     style and SVG output; only the PDF's source geometry is not stored;
//   * the compact store of that import is a fraction of the old size;
//   * derived polygons are stored as a marker only when the derivation gives
//     back exactly the same numbers; anything else stays explicit;
//   * a write compares compact forms, so an untouched mark writes nothing;
//   * the one-time compaction of an existing store (old map + old-format
//     marks): only after the w28 carry-over is done, reads identical before
//     and after (eraser lanes included), idempotent, and two screens doing it
//     at once converge; a concurrent edit of another field survives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';
import * as Y from 'yjs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';
import { normalizeByPageAnnotationIdentities } from '../src/utils/annotationStorageIdentity.js';
import { renderPathToSvgAttrs, renderPathToSvgD } from '../src/utils/svgPathAttrs.js';
import { docToByPage, META_MAP } from '../src/services/annotationDocStore.js';
import {
  LEGACY_ANNOTATIONS_MAP,
  MARKS_MAP,
  readAnnotationEntry,
  writeAnnotationMark,
} from '../src/services/annotationMarkStore.js';
import {
  DERIVED_POLYGONS_MARKER,
  DERIVED_POLYGONS_PREFIX,
  derivePolygonsFromPath,
  fromStoredMarkObject,
  toStoredMarkObject,
  withoutUnstoredFieldsByPage,
} from '../src/services/annotationMarkCodec.js';
import {
  annotationStoreCompactionPending,
  compactAnnotationStore,
} from '../src/services/annotationStoreCompaction.js';
import { LEGACY_MARKS_CARRIED_MARKER_KEY } from '../src/services/legacyMarksCarryOver.js';
import { EMBEDDED_IMPORT_MARKER_KEY } from '../src/utils/embeddedImportGate.js';

const PACKAGE_2 = new URL('../debug/fixtures/Package 2 - Rev 4 -- IC.pdf', import.meta.url);

function withoutSource(object) {
  const copy = structuredClone(object);
  if (copy?.data) delete copy.data.pdfInkSourceGeometry;
  return copy;
}

function exactlyEqualNumbers(left, right) {
  if (Object.is(left, right)) return true;
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((value, index) => exactlyEqualNumbers(value, right[index]));
}

// Writes the same way the embedded import does (one transaction per page),
// but through the plain old layout when `legacyLayout` (the pre-w33 store
// kept every field): used to build stores as older w26-w32 builds left them.
function writeLegacyLayoutMark(doc, key, page, object) {
  const toY = (value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const map = new Y.Map();
      for (const [k, v] of Object.entries(value)) if (v !== undefined) map.set(k, toY(v));
      return map;
    }
    return structuredClone(value);
  };
  const o = new Y.Map();
  const group = {};
  for (const [k, v] of Object.entries(object)) {
    if (v === undefined) continue;
    if (['left', 'top', 'width', 'height', 'path'].includes(k) && object.type === 'path') { group[k] = structuredClone(v); continue; }
    o.set(k, toY(v));
  }
  if (object.type === 'path') o.set('#pointGeometry', group);
  const mark = new Y.Map();
  mark.set('p', page);
  mark.set('o', o);
  doc.getMap(MARKS_MAP).set(key, mark);
}

let importedPackage2 = null;
async function package2Import() {
  if (importedPackage2) return importedPackage2;
  const bytes = new Uint8Array(fs.readFileSync(PACKAGE_2));
  const task = pdfjsLib.getDocument({ data: bytes.slice(), disableWorker: true, verbosity: pdfjsLib.VerbosityLevel.ERRORS });
  const pdf = await task.promise;
  try {
    // The screen gives every mark its storage identity before the capture
    // stores it (data.id); the store's reads carry the same identity.
    importedPackage2 = normalizeByPageAnnotationIdentities(
      (await importAnnotationsFromPdf(pdf, { rawPdfBytes: bytes })).annotationsByPage,
    ).byPage;
  } finally {
    await task.destroy();
  }
  return importedPackage2;
}

function importIntoDoc(byPage, { legacyLayout = false } = {}) {
  const doc = new Y.Doc();
  let bytes = 0;
  doc.on('update', (update) => { bytes += update.length; });
  for (const [pageKey, page] of Object.entries(byPage)) {
    doc.transact(() => {
      for (const object of page.objects || []) {
        const key = String(object.data.id);
        if (legacyLayout) writeLegacyLayoutMark(doc, key, Number(pageKey), object);
        else writeAnnotationMark(doc, key, Number(pageKey), object);
      }
    });
  }
  return { doc, bytes };
}

test('Package 2: every imported mark reads back from the compact store with the same geometry and SVG', async () => {
  const imported = await package2Import();
  const { doc, bytes } = importIntoDoc(imported);
  const reopened = new Y.Doc();
  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc));
  let compared = 0;
  let derived = 0;
  let withPolygons = 0;
  for (const page of Object.values(imported)) {
    for (const original of page.objects || []) {
      const key = String(original.data.id);
      const readBack = readAnnotationEntry(reopened, key).o;
      assert.deepEqual(readBack, withoutSource(original), key);
      assert.ok(exactlyEqualNumbers(readBack.path, original.path), `${key} path`);
      if (Array.isArray(original.polygons)) {
        withPolygons += 1;
        assert.ok(exactlyEqualNumbers(readBack.polygons, original.polygons), `${key} polygons`);
        const storedPolygons = reopened.getMap(MARKS_MAP).get(key).get('o').get('polygons');
        if (typeof storedPolygons === 'string') derived += 1;
      }
      if (original.type === 'path') {
        const attrsBefore = renderPathToSvgAttrs(original);
        const attrsAfter = renderPathToSvgAttrs(readBack);
        assert.deepEqual(attrsAfter, attrsBefore, `${key} svg attrs`);
        assert.equal(renderPathToSvgD(readBack, attrsAfter), renderPathToSvgD(original, attrsBefore), `${key} svg d`);
      }
      compared += 1;
    }
  }
  assert.ok(compared >= 3_000, `compared ${compared} marks`);
  assert.ok(derived / withPolygons > 0.8, `${derived} of ${withPolygons} polygon sets stored as their derivation`);

  const { bytes: legacyBytes } = importIntoDoc(imported, { legacyLayout: true });
  const snapshot = Y.encodeStateAsUpdate(doc);
  // Before w33 the same import stored ~17 MB (~4.3 MB gzipped).
  assert.ok(legacyBytes > 15 * 1024 * 1024, `old layout ${legacyBytes} bytes`);
  assert.ok(bytes < legacyBytes * 0.4, `compact import ${bytes} bytes vs old ${legacyBytes}`);
  assert.ok(gzipSync(snapshot).length < 2.2 * 1024 * 1024, `compact snapshot ${gzipSync(snapshot).length} bytes gzipped`);
});

test('the screen copy of an embedded import equals what the store reads back', async () => {
  const imported = await package2Import();
  const screen = withoutUnstoredFieldsByPage(imported);
  const { doc } = importIntoDoc(imported);
  for (const [pageKey, page] of Object.entries(screen)) {
    for (const object of page.objects) {
      assert.equal(object.data?.pdfInkSourceGeometry, undefined);
      const key = String(object.data.id);
      assert.deepEqual(readAnnotationEntry(doc, key).o, object, `${pageKey}/${key}`);
    }
  }
  // Untouched input: the importer's own output keeps its provenance.
  assert.ok(Object.values(imported).some((page) => page.objects.some((object) => object.data?.pdfInkSourceGeometry)));
});

test('polygons are stored as their derivation only when it gives back exactly the same numbers', () => {
  const path = [['M', 0, 0], ['L', 10, 0], ['L', 10, 10], ['L', 0, 10], ['Z']];
  const exact = derivePolygonsFromPath(path, 'nonzero');
  const ink = { type: 'path', path, polygons: exact, fillRule: 'nonzero', data: { id: 'a' } };
  assert.equal(toStoredMarkObject(ink).polygons, DERIVED_POLYGONS_MARKER);
  assert.deepEqual(fromStoredMarkObject(toStoredMarkObject(ink)), ink);

  const nudged = structuredClone(exact);
  nudged[0][0][1][0] += 1e-12;
  const erased = { ...ink, polygons: nudged };
  assert.equal(toStoredMarkObject(erased), erased, 'one number off: stored explicitly');

  const noPath = { type: 'path', polygons: exact, data: {} };
  assert.equal(toStoredMarkObject(noPath), noPath);

  // A marker this build does not know reads as "no polygons", never a string.
  const unknown = fromStoredMarkObject({ ...ink, polygons: `${DERIVED_POLYGONS_PREFIX}v9` });
  assert.equal('polygons' in unknown, false);
  assert.equal(unknown.path, path);
});

test('a write compares compact forms: re-saving a read mark writes nothing, a path edit re-derives', () => {
  const path = [['M', 0, 0], ['L', 10, 0], ['L', 10, 10], ['L', 0, 10], ['Z']];
  const ink = {
    type: 'path', path, left: 5, top: 5, width: 10, height: 10,
    polygons: derivePolygonsFromPath(path, 'nonzero'), fillRule: 'nonzero',
    data: { id: 'a', pdfInkSourceGeometry: { inkLists: [[[1, 2]]] } },
  };
  const doc = new Y.Doc();
  writeAnnotationMark(doc, 'a', 1, ink);
  const stored = doc.getMap(MARKS_MAP).get('a').get('o');
  assert.equal(stored.get('polygons'), DERIVED_POLYGONS_MARKER);
  assert.equal(stored.get('data').has('pdfInkSourceGeometry'), false);

  const readBack = readAnnotationEntry(doc, 'a').o;
  let updates = 0;
  doc.on('update', () => { updates += 1; });
  assert.equal(writeAnnotationMark(doc, 'a', 1, ink, { base: readBack, basePage: 1 }).writes, 0);
  assert.equal(writeAnnotationMark(doc, 'a', 1, readBack).writes, 0, 'full sync of the read copy');
  assert.equal(updates, 0);

  const bigger = [['M', 0, 0], ['L', 20, 0], ['L', 20, 20], ['L', 0, 20], ['Z']];
  const edited = { ...readBack, path: bigger, width: 20, height: 20, polygons: derivePolygonsFromPath(bigger, 'nonzero') };
  writeAnnotationMark(doc, 'a', 1, edited, { base: readBack, basePage: 1 });
  assert.deepEqual(readAnnotationEntry(doc, 'a').o.polygons, derivePolygonsFromPath(bigger, 'nonzero'));
  assert.equal(stored.get('polygons'), DERIVED_POLYGONS_MARKER, 'marker unchanged, no write needed');

  const clipped = [[[[0, 0], [5, 0], [5, 5], [0, 0]]]];
  writeAnnotationMark(doc, 'a', 1, { ...edited, polygons: clipped }, { base: edited, basePage: 1 });
  assert.deepEqual(stored.get('polygons'), clipped);
  assert.deepEqual(readAnnotationEntry(doc, 'a').o.polygons, clipped);
});

// A store as w26-w32 builds left it: old map (carried) + old-layout marks.
async function oldStore({ carried = true, userMarkInOldMap = false } = {}) {
  const imported = await package2Import();
  const page11 = { 11: { objects: imported[11].objects.slice(0, 120) } };
  const { doc } = importIntoDoc(page11, { legacyLayout: true });
  doc.transact(() => {
    const legacy = doc.getMap(LEGACY_ANNOTATIONS_MAP);
    for (const object of page11[11].objects.slice(0, 60)) {
      legacy.set(`old-${object.data.id}`, { p: 11, o: structuredClone(object) });
    }
    if (userMarkInOldMap) {
      legacy.set('user-pen', { p: 1, o: { type: 'path', id: 'user-pen', path: [['M', 0, 0], ['L', 5, 5]], stroke: 'red', data: { id: 'user-pen' } } });
    }
    const meta = doc.getMap(META_MAP);
    meta.set(EMBEDDED_IMPORT_MARKER_KEY, { at: 'x', count: 120 });
    if (carried) meta.set(LEGACY_MARKS_CARRIED_MARKER_KEY, { at: 'x', carried: 0, eligible: 0 });
  });
  return { doc, objects: page11[11].objects };
}

test('compaction shrinks an existing store and every mark reads back the same', async () => {
  const { doc, objects } = await oldStore();
  const before = docToByPage(doc);
  const sizeBefore = Y.encodeStateAsUpdate(doc).length;
  assert.equal(annotationStoreCompactionPending(doc), true);
  const updates = [];
  doc.on('update', (update) => updates.push(update));
  const result = compactAnnotationStore(doc);
  assert.equal(result.legacyDeleted, 60);
  assert.equal(result.marksCompacted, objects.filter((object) => object.data?.pdfInkSourceGeometry).length);
  assert.ok(updates.every((update) => update.length < 256 * 1024));
  assert.equal(doc.getMap(LEGACY_ANNOTATIONS_MAP).size, 0);
  const snapshot = Y.encodeStateAsUpdate(doc);
  assert.ok(snapshot.length < sizeBefore * 0.4, `${snapshot.length} vs ${sizeBefore}`);

  const reopened = new Y.Doc();
  Y.applyUpdate(reopened, snapshot);
  const after = docToByPage(reopened);
  assert.deepEqual(after[11].objects, before[11].objects.map(withoutSource));

  assert.equal(annotationStoreCompactionPending(doc), false);
  const again = compactAnnotationStore(doc);
  assert.deepEqual(again, { legacyDeleted: 0, marksCompacted: 0, writes: 0, batches: 0 });
});

test('the old map stays until the carry-over is done (or has nothing to carry)', async () => {
  const waiting = await oldStore({ carried: false, userMarkInOldMap: true });
  compactAnnotationStore(waiting.doc);
  assert.equal(waiting.doc.getMap(LEGACY_ANNOTATIONS_MAP).size, 61, 'a user mark still to carry: old map kept');

  const nothingToCarry = await oldStore({ carried: false, userMarkInOldMap: false });
  compactAnnotationStore(nothingToCarry.doc);
  assert.equal(nothingToCarry.doc.getMap(LEGACY_ANNOTATIONS_MAP).size, 0, 'only PDF markup (the import owns it): dropped');
});

test('two screens compacting at once converge; a concurrent edit of another field survives', async () => {
  const { doc } = await oldStore();
  const a = new Y.Doc();
  const b = new Y.Doc();
  const start = Y.encodeStateAsUpdate(doc);
  Y.applyUpdate(a, start);
  Y.applyUpdate(b, start);
  const key = String(doc.getMap(MARKS_MAP).keys().next().value);
  const base = readAnnotationEntry(b, key).o;

  compactAnnotationStore(a);
  compactAnnotationStore(b);
  const c = new Y.Doc();
  Y.applyUpdate(c, start);
  // A third screen moves and recolours the mark while the others compact.
  writeAnnotationMark(c, key, 11, { ...base, left: base.left + 7, fill: 'rgba(0, 0, 255, 1)' }, { base, basePage: 11 });

  for (const target of [a, b, c]) {
    for (const source of [a, b, c]) if (source !== target) Y.applyUpdate(target, Y.encodeStateAsUpdate(source));
  }
  const views = [a, b, c].map((d) => JSON.stringify(docToByPage(d)));
  assert.equal(views[0], views[1]);
  assert.equal(views[1], views[2]);
  const merged = readAnnotationEntry(a, key).o;
  assert.equal(merged.left, base.left + 7);
  assert.equal(merged.fill, 'rgba(0, 0, 255, 1)');
  assert.ok(exactlyEqualNumbers(merged.polygons, base.polygons));
  assert.equal(merged.data.pdfInkSourceGeometry, undefined);
  assert.equal(a.getMap(LEGACY_ANNOTATIONS_MAP).size, 0);
});

// Review A (w33): a mark stored before w33 still holds an explicit polygons
// array its path reproduces. An edit of its path must write the new polygons,
// even though both the old and new copies compact to the same marker.
test('a path edit of a not-yet-compacted mark writes the new polygons', () => {
  const square = (size) => [['M', 0, 0], ['L', size, 0], ['L', size, size], ['L', 0, size], ['Z']];
  const doc = new Y.Doc();
  const old = {
    type: 'path', path: square(10), left: 5, top: 5, width: 10, height: 10,
    polygons: derivePolygonsFromPath(square(10), 'nonzero'), fillRule: 'nonzero', data: { id: 'old' },
  };
  writeLegacyLayoutMark(doc, 'old', 1, old); // the pre-w33 layout: explicit array
  assert.ok(Array.isArray(doc.getMap(MARKS_MAP).get('old').get('o').get('polygons')));
  const base = readAnnotationEntry(doc, 'old').o;
  const moved = { ...base, path: square(20), width: 20, height: 20, polygons: derivePolygonsFromPath(square(20), 'nonzero') };
  writeAnnotationMark(doc, 'old', 1, moved, { base, basePage: 1, echoVersions: [base] });
  assert.deepEqual(readAnnotationEntry(doc, 'old').o.polygons, derivePolygonsFromPath(square(20), 'nonzero'));
});

// Review A (w33): the marker rebuilds with the mark's own fill rule, so a
// compaction racing an erase that switched the mark to evenodd with a hole
// keeps the hole (the marker names no rule of its own).
test('a compaction racing an erase that made a hole keeps the hole', () => {
  const outer = [['M', 0, 0], ['L', 30, 0], ['L', 30, 30], ['L', 0, 30], ['Z']];
  const withHole = [...outer, ['M', 10, 10], ['L', 20, 10], ['L', 20, 20], ['L', 10, 20], ['Z']];
  const start = new Y.Doc();
  writeLegacyLayoutMark(start, 'm', 1, {
    type: 'path', path: outer, left: 0, top: 0, width: 30, height: 30, isPdfImported: true,
    polygons: derivePolygonsFromPath(outer, 'nonzero'), fillRule: 'nonzero',
    data: { id: 'm', pdfInkSourceGeometry: { inkLists: [] } },
  });
  start.getMap(META_MAP).set(EMBEDDED_IMPORT_MARKER_KEY, { at: 'x' });
  const a = new Y.Doc();
  const b = new Y.Doc();
  Y.applyUpdate(a, Y.encodeStateAsUpdate(start));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(start));
  compactAnnotationStore(b);
  const base = readAnnotationEntry(a, 'm').o;
  const holePolygons = derivePolygonsFromPath(withHole, 'evenodd');
  assert.equal(holePolygons[0].length, 2, 'evenodd leaves a hole');
  writeAnnotationMark(a, 'm', 1, { ...base, path: withHole, fillRule: 'evenodd', polygons: holePolygons }, { base, basePage: 1 });
  for (const order of [[a, b], [b, a]]) {
    const merged = new Y.Doc();
    for (const d of order) Y.applyUpdate(merged, Y.encodeStateAsUpdate(d));
    const read = readAnnotationEntry(merged, 'm').o;
    assert.deepEqual(read.path, withHole);
    assert.equal(read.fillRule, 'evenodd');
    assert.deepEqual(read.polygons, holePolygons, 'the hole survives whichever polygons write wins');
  }
});
