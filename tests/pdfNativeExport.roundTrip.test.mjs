// KAL-52 — Round-trip integration test.
// Bakes a representative Fabric annotation set into a PDF, then re-reads
// the resulting PDF with pdf-lib's low-level API (the same path the
// importer uses for raw metadata) and verifies geometry survives within
// the Phase 11 sub-pixel tolerance. PDF.js isn't part of the Node test
// runtime, so the importer's full PDF.js pipeline is exercised at
// runtime; here we verify the dict-level contract that pipeline depends
// on.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import { bakeAnnotationsIntoPdf } from '../src/utils/pdfNativeExport/index.js';

const PAGE_W = 200;
const PAGE_H = 200;

async function makeBlankPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE_W, PAGE_H]);
  return doc.save();
}

async function readAnnots(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  const out = [];
  annots.asArray().forEach((ref) => {
    const dict = doc.context.lookup(ref);
    out.push({
      subtype: dict.get(PDFName.of('Subtype'))?.decodeText?.() || null,
      rect: dict.get(PDFName.of('Rect'))?.asArray?.()?.map((n) => (typeof n.value === 'function' ? n.value() : Number(n))) || null,
      l: dict.get(PDFName.of('L'))?.asArray?.()?.map((n) => (typeof n.value === 'function' ? n.value() : Number(n))) || null,
      vertices: dict.get(PDFName.of('Vertices'))?.asArray?.()?.map((n) => (typeof n.value === 'function' ? n.value() : Number(n))) || null,
      inkList: dict.get(PDFName.of('InkList'))?.asArray?.()?.map((list) => list.asArray().map((n) => (typeof n.value === 'function' ? n.value() : Number(n)))) || null,
      quadPoints: dict.get(PDFName.of('QuadPoints'))?.asArray?.()?.map((n) => (typeof n.value === 'function' ? n.value() : Number(n))) || null,
      contents: dict.get(PDFName.of('Contents'))?.decodeText?.() || null,
    });
  });
  return out;
}

// Helper: convert PDF-space rect [x1,y1,x2,y2] back to app-space
// (left/top/width/height) and check that it matches the original Fabric
// object's bounds within tolerance.
function rectToAppBounds([x1, y1, x2, y2], pageHeight) {
  return {
    left: x1,
    top: pageHeight - y2,
    width: x2 - x1,
    height: y2 - y1,
  };
}

const TOL = 0.5;

test('Square round-trips with sub-pixel geometry tolerance', async () => {
  const original = { id: 'sq', type: 'rect', left: 12.37, top: 25.5, width: 40, height: 30, stroke: '#ff0000' };
  const bytes = await bakeAnnotationsIntoPdf(await makeBlankPdf(), { 1: { objects: [original] } });
  const [annot] = await readAnnots(bytes);
  const bounds = rectToAppBounds(annot.rect, PAGE_H);
  assert.equal(annot.subtype, 'Square');
  assert.ok(Math.abs(bounds.left - original.left) < TOL);
  assert.ok(Math.abs(bounds.top - original.top) < TOL);
  assert.ok(Math.abs(bounds.width - original.width) < TOL);
  assert.ok(Math.abs(bounds.height - original.height) < TOL);
});

test('Line round-trips L array within tolerance', async () => {
  const original = { id: 'ln', type: 'line', x1: 10, y1: 20, x2: 80, y2: 95, stroke: '#000000' };
  const bytes = await bakeAnnotationsIntoPdf(await makeBlankPdf(), { 1: { objects: [original] } });
  const [annot] = await readAnnots(bytes);
  assert.equal(annot.subtype, 'Line');
  const [lx1, ly1, lx2, ly2] = annot.l;
  // Convert PDF y back to app y
  assert.ok(Math.abs(lx1 - original.x1) < TOL);
  assert.ok(Math.abs((PAGE_H - ly1) - original.y1) < TOL);
  assert.ok(Math.abs(lx2 - original.x2) < TOL);
  assert.ok(Math.abs((PAGE_H - ly2) - original.y2) < TOL);
});

test('FreeText round-trips text content and Y-flip', async () => {
  const original = { id: 'ft', type: 'textbox', left: 30, top: 40, width: 80, height: 18, text: 'Round-trip', fill: '#1e293b', fontSize: 14 };
  const bytes = await bakeAnnotationsIntoPdf(await makeBlankPdf(), { 1: { objects: [original] } });
  const [annot] = await readAnnots(bytes);
  assert.equal(annot.subtype, 'FreeText');
  assert.equal(annot.contents, 'Round-trip');
  const bounds = rectToAppBounds(annot.rect, PAGE_H);
  assert.ok(Math.abs(bounds.left - original.left) < TOL);
  assert.ok(Math.abs(bounds.top - original.top) < TOL);
});

test('Polygon round-trips Y-flipped vertices', async () => {
  const original = {
    id: 'pg', type: 'polygon', left: 0, top: 0,
    points: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 30, y: 40 }],
    stroke: '#000000',
  };
  const bytes = await bakeAnnotationsIntoPdf(await makeBlankPdf(), { 1: { objects: [original] } });
  const [annot] = await readAnnots(bytes);
  assert.equal(annot.subtype, 'Polygon');
  assert.equal(annot.vertices.length, 6);
  // Re-flip each vertex
  const recovered = [];
  for (let i = 0; i < annot.vertices.length; i += 2) {
    recovered.push({ x: annot.vertices[i], y: PAGE_H - annot.vertices[i + 1] });
  }
  recovered.forEach((pt, i) => {
    assert.ok(Math.abs(pt.x - original.points[i].x) < TOL);
    assert.ok(Math.abs(pt.y - original.points[i].y) < TOL);
  });
});

test('PolyLine round-trips Y-flipped vertices', async () => {
  const original = {
    id: 'pl', type: 'polyline', left: 0, top: 0,
    points: [{ x: 5, y: 5 }, { x: 60, y: 30 }, { x: 100, y: 50 }],
    stroke: '#000000',
  };
  const bytes = await bakeAnnotationsIntoPdf(await makeBlankPdf(), { 1: { objects: [original] } });
  const [annot] = await readAnnots(bytes);
  assert.equal(annot.subtype, 'PolyLine');
  const recovered = [];
  for (let i = 0; i < annot.vertices.length; i += 2) {
    recovered.push({ x: annot.vertices[i], y: PAGE_H - annot.vertices[i + 1] });
  }
  recovered.forEach((pt, i) => {
    assert.ok(Math.abs(pt.x - original.points[i].x) < TOL);
    assert.ok(Math.abs(pt.y - original.points[i].y) < TOL);
  });
});

test('Ink round-trips multi-sub-path InkList', async () => {
  const original = {
    id: 'ik', type: 'path',
    path: [['M', 10, 10], ['L', 30, 30], ['M', 50, 50], ['L', 70, 70], ['L', 90, 90]],
    stroke: '#000000', strokeWidth: 2,
  };
  const bytes = await bakeAnnotationsIntoPdf(await makeBlankPdf(), { 1: { objects: [original] } });
  const [annot] = await readAnnots(bytes);
  assert.equal(annot.subtype, 'Ink');
  assert.equal(annot.inkList.length, 2);
  assert.equal(annot.inkList[0].length, 4); // (10,10),(30,30) → 4 numbers
  assert.equal(annot.inkList[1].length, 6); // (50,50),(70,70),(90,90) → 6 numbers
});

test('Highlight round-trips QuadPoints in Adobe order with Y-flip', async () => {
  const original = { id: 'h', type: 'rect', exportType: 'highlight', left: 10, top: 20, width: 40, height: 10, fill: '#ffff00' };
  const bytes = await bakeAnnotationsIntoPdf(await makeBlankPdf(), { 1: { objects: [original] } });
  const [annot] = await readAnnots(bytes);
  assert.equal(annot.subtype, 'Highlight');
  assert.equal(annot.quadPoints.length, 8);
  // TL.y === BR.y +/- height, etc.
  assert.equal(annot.quadPoints[0], 10);          // TL.x
  assert.equal(annot.quadPoints[1], PAGE_H - 20); // TL.y
  assert.equal(annot.quadPoints[6], 50);          // BR.x
  assert.equal(annot.quadPoints[7], PAGE_H - 30); // BR.y
});

test('mixed annotations all round-trip with correct subtypes', async () => {
  const bytes = await bakeAnnotationsIntoPdf(await makeBlankPdf(), {
    1: {
      objects: [
        { type: 'rect', left: 5, top: 5, width: 10, height: 10 },
        { type: 'circle', left: 30, top: 5, radius: 5 },
        { type: 'line', x1: 50, y1: 5, x2: 70, y2: 15 },
        { type: 'textbox', left: 5, top: 30, width: 80, height: 15, text: 'a' },
        { type: 'polygon', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }] },
        { type: 'polyline', points: [{ x: 100, y: 50 }, { x: 120, y: 60 }] },
        { type: 'path', path: [['M', 100, 100], ['L', 110, 110]] },
        { type: 'rect', exportType: 'highlight', left: 5, top: 80, width: 20, height: 5, fill: '#ffff00' },
        { type: 'rect', exportType: 'underline', left: 30, top: 80, width: 20, height: 5 },
        { type: 'rect', exportType: 'squiggly', left: 55, top: 80, width: 20, height: 5 },
        { type: 'rect', exportType: 'strikeout', left: 80, top: 80, width: 20, height: 5 },
      ],
    },
  });
  const annots = await readAnnots(bytes);
  const subtypes = annots.map((a) => a.subtype).sort();
  assert.deepEqual(subtypes, [
    'Circle', 'FreeText', 'Highlight', 'Ink',
    'Line', 'PolyLine', 'Polygon', 'Square',
    'Squiggly', 'StrikeOut', 'Underline',
  ]);
});
