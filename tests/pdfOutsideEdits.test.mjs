// Marks Survey exported, then changed in another PDF app (Adobe Acrobat,
// 2026-11-14 round trip), must come back with that app's changes instead of
// the stale copy in Survey's private blob. See src/utils/pdfOutsideEdits.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';
import {
  PDF_APP_ANNOTATION_METADATA_KEY,
  PDF_APP_LAYER_STATE_KEY,
  parsePdfAppAnnotationMetadata,
  parsePdfAppLayerStateMetadata,
} from '../src/utils/pdfAppAnnotationMetadata.js';
import {
  buildWrittenFingerprint,
  detectOutsideEdits,
  fnv1aHex,
  markSnapshotHash,
  pdfDateString,
  planOutsideEditReconcile,
  readableMarkSubject,
  resolveLegacyOutsideEdits,
} from '../src/utils/pdfOutsideEdits.js';
import { selectEmbeddedImportObjects } from '../src/utils/embeddedImportGate.js';

const PAGE = { width: 612, height: 792 };
const fixture = (name) => readFileSync(new URL(`../debug/fixtures/roundtrip/${name}`, import.meta.url));

const MARKS = [
  { id: 'mark-red-rect', type: 'rect', left: 100, top: 120, width: 150, height: 80, stroke: '#c42747', strokeWidth: 2, fill: 'transparent' },
  { id: 'mark-ellipse', type: 'ellipse', left: 300, top: 200, rx: 60, ry: 45, width: 120, height: 90, stroke: '#c42747', strokeWidth: 2, fill: 'transparent' },
  { id: 'mark-blue-rect', type: 'rect', left: 120, top: 400, width: 200, height: 50, stroke: '#2563eb', strokeWidth: 2, fill: 'transparent' },
  {
    id: 'mark-text', type: 'textbox', left: 80, top: 600, width: 220, height: 30, text: 'Check this valve',
    fontSize: 14, fontFamily: 'Helvetica', fill: '#111111', stroke: null, strokeWidth: 0,
    data: { createdAt: '2026-11-01T12:00:00.000Z' },
  },
];

const makePdfFile = async () => {
  const source = await PDFDocument.create();
  source.addPage([PAGE.width, PAGE.height]);
  const bytes = await source.save();
  return {
    name: 'outside-edit-source.pdf',
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
};

const exportMarks = async (objects, extra = {}) => {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    const out = await savePDFWithAnnotationsPdfLib(
      await makePdfFile(),
      { 1: { objects: structuredClone(objects) } },
      { 1: { width: PAGE.width, height: PAGE.height } },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'outside-edits-doc', ...extra },
    );
    return new Uint8Array(out);
  } finally {
    globalThis.window = originalWindow;
  }
};

const reimport = async (bytes) => {
  const loadingTask = pdfjsLib.getDocument({ data: Uint8Array.from(bytes), disableWorker: true, verbosity: 0 });
  const pdfDoc = await loadingTask.promise;
  try {
    return await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: Uint8Array.from(bytes) });
  } finally {
    await loadingTask.destroy();
  }
};

const byId = (objects) => new Map(objects.filter((o) => o.id).map((o) => [o.id, o]));

const annotDicts = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  return { doc, entries: annots.asArray().map((ref) => ({ ref, dict: doc.context.lookup(ref) })) };
};

const text = (doc, dict, key) => {
  const v = dict.get(PDFName.of(key));
  return v ? (doc.context.lookup(v) || v).decodeText() : undefined;
};

// What Acrobat did in the real test, done with pdf-lib: one mark recoloured,
// one moved 60 pt right and down, one deleted, words retyped, /M stamped.
const editLikeAcrobat = async (bytes) => {
  const { doc, entries } = await annotDicts(bytes);
  const page = doc.getPage(0);
  const keep = [];
  for (const { ref, dict } of entries) {
    const nm = text(doc, dict, 'NM');
    if (nm === 'mark-ellipse') continue;
    const touch = () => dict.set(PDFName.of('M'), PDFString.of("D:20261114112752-05'00'"));
    if (nm === 'mark-red-rect') { dict.set(PDFName.of('C'), doc.context.obj([0, 0, 1])); touch(); }
    if (nm === 'mark-blue-rect') {
      const r = dict.get(PDFName.of('Rect')).asArray().map((n) => n.asNumber());
      dict.set(PDFName.of('Rect'), doc.context.obj([Math.round(r[0] + 60), Math.round(r[1] - 60), Math.round(r[2] + 60), Math.round(r[3] - 60)]));
      touch();
    }
    if (nm === 'mark-text') { dict.set(PDFName.of('Contents'), PDFString.of('Valve replaced')); touch(); }
    keep.push(ref);
  }
  page.node.set(PDFName.of('Annots'), doc.context.obj(keep));
  return doc.save();
};

test('fingerprint helpers', () => {
  assert.equal(fnv1aHex(''), '811c9dc5');
  assert.equal(pdfDateString(new Date('2026-11-14T16:05:09Z')), 'D:20261114160509Z');
  assert.equal(readableMarkSubject({ subtype: 'Square' }), 'Rectangle');
  assert.equal(readableMarkSubject({ subtype: '/Circle' }), 'Ellipse');
  assert.equal(readableMarkSubject({ subtype: 'Line', appType: 'arrow' }), 'Arrow');
  assert.equal(readableMarkSubject({ subtype: 'Polygon', hasCloudBorder: true }), 'Cloud');
  assert.equal(readableMarkSubject({ subtype: 'FreeText' }), 'Text Box');

  const written = buildWrittenFingerprint({ rect: [98.75, 590.75, 251.25, 673.25], color: [0.77, 0.15, 0.28], borderWidth: 2, contents: '' });
  const metadata = { kind: 'survey-app-annotation', fabricType: 'rect', written };
  // Acrobat rounds the box to whole points on any edit: not a move.
  assert.equal(detectOutsideEdits(metadata, { rect: [99, 591, 251, 673], color: [0.77, 0.15, 0.28], borderWidth: 2 }), null);
  assert.deepEqual(detectOutsideEdits(metadata, { rect: [99, 591, 251, 673], color: [0, 0, 1], borderWidth: 2 }), { stroke: '#0000ff' });
  assert.deepEqual(detectOutsideEdits(metadata, { rect: [159, 531, 311, 613], color: [0.77, 0.15, 0.28], borderWidth: 4 }), { geometry: true, strokeWidth: 4 });
  // A dropped default (no /BS) is not an edit.
  assert.equal(detectOutsideEdits(metadata, { rect: [99, 591, 251, 673], color: [0.77, 0.15, 0.28] }), null);
  // No fingerprint and no /M: a file nobody else saved; the blob wins.
  assert.equal(detectOutsideEdits({ kind: 'survey-app-annotation', fabricType: 'rect', style: { stroke: '#c42747' } }, { color: [0, 0, 1] }), null);
});

test('export stamps readable subject, author, dates, fingerprint and the exported-mark list', async () => {
  const bytes = await exportMarks(MARKS, { authorName: 'Pat Field' });
  const { doc, entries } = await annotDicts(bytes);
  const seen = {};
  for (const { dict } of entries) {
    const nm = text(doc, dict, 'NM');
    const metadata = parsePdfAppAnnotationMetadata(text(doc, dict, PDF_APP_ANNOTATION_METADATA_KEY));
    assert.ok(metadata, `blob kept for ${nm}`);
    assert.ok(metadata.written?.rect, `fingerprint for ${nm}`);
    assert.match(metadata.written.m, /^D:\d{14}Z$/);
    assert.equal(text(doc, dict, 'M'), metadata.written.m);
    assert.equal(text(doc, dict, 'T'), 'Pat Field');
    seen[nm] = { subject: text(doc, dict, 'Subj'), created: text(doc, dict, 'CreationDate') };
  }
  assert.equal(seen['mark-red-rect'].subject, 'Rectangle');
  assert.equal(seen['mark-ellipse'].subject, 'Ellipse');
  assert.equal(seen['mark-text'].subject, 'Text Box');
  assert.equal(seen['mark-text'].created, 'D:20261101120000Z');
  const layer = parsePdfAppLayerStateMetadata(doc.catalog.get(PDFName.of(PDF_APP_LAYER_STATE_KEY)).decodeText());
  assert.deepEqual(layer.exportedMarks.map((e) => e.id).sort(), MARKS.map((m) => m.id).sort());
  for (const entry of layer.exportedMarks) {
    assert.equal(entry.page, 1);
    assert.equal(entry.snap, markSnapshotHash(MARKS.find((m) => m.id === entry.id)));
  }
});

test('an untouched Survey export reimports exactly as before (no outside edit seen)', async () => {
  const bytes = await exportMarks(MARKS);
  const { annotationsByPage } = await reimport(bytes);
  const objects = byId(annotationsByPage[1].objects);
  for (const mark of MARKS) {
    const got = objects.get(mark.id);
    assert.ok(got, mark.id);
    assert.equal(got.data?.appAnnotationMetadata?.outsideEdits, undefined, mark.id);
    assert.equal(got.left, mark.left, `${mark.id} left`);
    assert.equal(got.top, mark.top, `${mark.id} top`);
    if (mark.stroke) assert.equal(got.stroke, mark.stroke, `${mark.id} stroke`);
    if (mark.text) assert.equal(got.text, mark.text);
  }
});

test('colour, move, retyped words and deletion made in another app come back', async () => {
  const edited = await editLikeAcrobat(await exportMarks(MARKS));
  const { annotationsByPage } = await reimport(edited);
  const objects = byId(annotationsByPage[1].objects);
  assert.equal(objects.has('mark-ellipse'), false);

  const recoloured = objects.get('mark-red-rect');
  assert.equal(recoloured.stroke, '#0000ff');
  assert.equal(recoloured.left, 100, 'unmoved mark keeps Survey geometry');
  assert.equal(recoloured.top, 120);
  assert.equal(recoloured.strokeWidth, 2);

  const moved = objects.get('mark-blue-rect');
  assert.equal(moved.stroke, '#2563eb', 'colour not touched stays Survey\'s');
  assert.ok(Math.abs(moved.left - 180) <= 1.5, `moved left ${moved.left}`);
  assert.ok(Math.abs(moved.top - 460) <= 1.5, `moved top ${moved.top}`);
  assert.ok(Math.abs(moved.width * (moved.scaleX ?? 1) - 200) <= 3, `width ${moved.width}`);

  const retyped = objects.get('mark-text');
  assert.equal(retyped.text, 'Valve replaced');
  assert.equal(retyped.left, 80);
});

test('real Acrobat file (Survey export from before the fingerprint): colour and move come back', async () => {
  const { annotationsByPage } = await reimport(fixture('survey-marked-acrobat-edited.pdf'));
  const objects = byId(annotationsByPage[1].objects);
  const recoloured = objects.get('a1b2c3d4-0000-4000-8000-000000000001');
  assert.equal(recoloured.stroke, '#0000ff');
  assert.equal(Math.round(recoloured.left), 100);
  assert.equal(Math.round(recoloured.top), 120);
  assert.equal(objects.has('a1b2c3d4-0000-4000-8000-000000000002'), false);
  const moved = objects.get('a1b2c3d4-0000-4000-8000-000000000003');
  assert.equal(moved.stroke, '#2563eb');
  assert.ok(Math.abs(moved.left - 180) <= 2, `left ${moved.left}`);
  assert.ok(Math.abs(moved.top - 460) <= 2, `top ${moved.top}`);
  // Acrobat's own new marks import too.
  assert.ok(annotationsByPage[1].objects.length >= 5);

  // The same file before Acrobat touched it still reimports from the blob.
  const before = byId((await reimport(fixture('survey-marked.pdf'))).annotationsByPage[1].objects);
  assert.equal(before.get('a1b2c3d4-0000-4000-8000-000000000001').stroke, '#c42747');
  assert.equal(before.get('a1b2c3d4-0000-4000-8000-000000000003').left, 120);
});

test('legacy compare leaves a box that did not move on Survey geometry', () => {
  const metadata = {
    kind: 'survey-app-annotation', fabricType: 'rect', style: { strokeWidth: 2 },
    geometry: { left: 100, top: 120, width: 150, height: 80 }, outsideEdits: { geometry: 'compare', stroke: true },
  };
  const still = resolveLegacyOutsideEdits(metadata, { left: 99, top: 119, width: 152, height: 82 });
  assert.deepEqual(still.outsideEdits, { stroke: true });
  const moved = resolveLegacyOutsideEdits(metadata, { left: 160, top: 180, width: 152, height: 82 });
  assert.deepEqual(moved.outsideEdits, { stroke: true, geometry: true });
  const none = resolveLegacyOutsideEdits({ ...metadata, outsideEdits: { geometry: 'compare' } }, { left: 100, top: 120, width: 150, height: 80 });
  assert.equal(none.outsideEdits, undefined);
});

test('new version plan: take outside edits and deletions only where Survey did not change the mark', async () => {
  const bytes = await exportMarks(MARKS);
  const layer = parsePdfAppLayerStateMetadata(
    (await PDFDocument.load(bytes)).catalog.get(PDFName.of(PDF_APP_LAYER_STATE_KEY)).decodeText(),
  );
  const edited = await editLikeAcrobat(bytes);
  const { annotationsByPage, appLayerState, rawAnnotationIdsByPage } = await reimport(edited);
  const rawIds = rawAnnotationIdsByPage[1];
  assert.equal(rawIds.includes('mark-ellipse'), false);
  assert.deepEqual(appLayerState.exportedMarks, layer.exportedMarks, 'Acrobat keeps the layer state');
  const imported = selectEmbeddedImportObjects(annotationsByPage[1].objects, 1);

  const plan = planOutsideEditReconcile({
    pageNumber: 1, imported, current: structuredClone(MARKS), exportedMarks: appLayerState.exportedMarks, rawIds,
  });
  assert.deepEqual([...plan.replace.keys()].sort(), ['mark-blue-rect', 'mark-red-rect', 'mark-text']);
  assert.deepEqual([...plan.remove], ['mark-ellipse']);

  // Changed in Survey since the export: Survey's copy stays, on both counts.
  const current = structuredClone(MARKS);
  current[0].stroke = '#16a34a';
  current[1].left = 310;
  const guarded = planOutsideEditReconcile({
    pageNumber: 1, imported, current, exportedMarks: appLayerState.exportedMarks, rawIds,
  });
  assert.equal(guarded.replace.has('mark-red-rect'), false);
  assert.equal(guarded.remove.has('mark-ellipse'), false);
  // Still listed in the file (the converter could not read it), file index
  // unknown, or page unreadable: never removed.
  const base = { pageNumber: 1, imported, current: structuredClone(MARKS), exportedMarks: appLayerState.exportedMarks };
  assert.equal(planOutsideEditReconcile({ ...base, rawIds: [...rawIds, 'mark-ellipse'] }).remove.size, 0);
  assert.equal(planOutsideEditReconcile({ ...base, rawIds: null }).remove.size, 0);
  assert.equal(planOutsideEditReconcile({ ...base, rawIds, pageUnreadable: true }).remove.size, 0);
  // Another page is left alone.
  const other = planOutsideEditReconcile({ pageNumber: 2, imported: [], current: structuredClone(MARKS), exportedMarks: appLayerState.exportedMarks, rawIds: [] });
  assert.equal(other.remove.size, 0);
});
