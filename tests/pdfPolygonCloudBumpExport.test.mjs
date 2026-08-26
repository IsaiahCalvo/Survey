// Imported Polygon Style Cloud Bump above spec /BE/I must ride /AP.
// Live toolbar maps selected polygon → rect Style Cloud + Bump 1–20 and
// stamps data.pdfCloudIntensity. Screen already rebuilt cloud-polygon
// scallops, but createPolygonAnnotation keyed only on cloudBorder /
// fabricObj.cloudIntensity and skipped /AP, so Acrobat's native /BE
// (I is only 0–2) clamped Bump 8 to 2. Distinct from Cloud Bump persist,
// Square Cloud Bump /AP (99f02811), Cloud Fill Opacity /ca, and
// leftover-18. Do not invent a create-poly tool.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeCloudPolygon(patch = {}) {
  const fillOpacity = patch.fillOpacity ?? 0;
  const strokeOpacity = patch.strokeOpacity ?? 100;
  return {
    type: 'polygon',
    left: 20,
    top: 30,
    width: 80,
    height: 60,
    scaleX: 1,
    scaleY: 1,
    points: [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 60 },
      { x: 0, y: 60 },
    ],
    stroke: `rgba(255, 0, 0, ${strokeOpacity / 100})`,
    fill: `rgba(255, 255, 0, ${fillOpacity / 100})`,
    strokeWidth: 2,
    id: `poly-cloud-bump-${patch.idSuffix || 'default'}`,
    data: {
      id: `poly-cloud-bump-${patch.idSuffix || 'default'}`,
      pdfCloudIntensity: patch.cloudIntensity ?? 8,
    },
  };
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'polygon-cloud-bump-export-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function lookupDict(doc, value) {
  if (!value) return null;
  if (typeof value.lookup === 'function' || typeof value.get === 'function') return value;
  return doc.context.lookup(value) || null;
}

function dictBeIntensity(doc, dict) {
  const be = lookupDict(doc, dict.get(PDFName.of('BE')));
  if (!be) return undefined;
  const value = be.get(PDFName.of('I'));
  if (value == null) return undefined;
  return value?.asNumber ? value.asNumber() : Number(value);
}

function hasAppearance(dict) {
  return dict.get(PDFName.of('AP')) != null;
}

function appearancePathText(doc, dict) {
  const ap = lookupDict(doc, dict.get(PDFName.of('AP')));
  if (!ap) return '';
  const nRef = ap.get(PDFName.of('N'));
  const stream = nRef?.dict ? nRef : doc.context.lookup(nRef);
  if (!(stream instanceof PDFRawStream)) return '';
  return new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
}

async function exportPolygon(patch) {
  const polygon = makeCloudPolygon(patch);
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [polygon] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'polygon-cloud-bump-export' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  const subtype = dict.get(PDFName.of('Subtype'));
  return {
    polygon,
    doc,
    dict,
    subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
    intensity: dictBeIntensity(doc, dict),
    ap: hasAppearance(dict),
    path: appearancePathText(doc, dict),
  };
}

async function flattenPolygon(patch) {
  const polygon = makeCloudPolygon(patch);
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    { 1: { objects: [polygon] } },
    { 1: { width: 200, height: 200 } },
    { returnBytes: true },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const contentsRef = page.node.get(PDFName.of('Contents'));
  const contents = doc.context.lookup(contentsRef);
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((ref) => doc.context.lookup(ref))
    : [contents];
  const text = streams
    .filter((stream) => stream instanceof PDFRawStream)
    .map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()))
    .join('\n');
  return { text, intensity: polygon.data.pdfCloudIntensity };
}

test('selected-patch Polygon Cloud stamps Bump 8 on data.pdfCloudIntensity', () => {
  const polygon = makeCloudPolygon({ cloudIntensity: 8 });
  assert.equal(polygon.data.pdfCloudIntensity, 8);
  assert.equal(polygon.type, 'polygon');
});

test('annotated export writes Polygon /BE/I 8 and /AP when Bump is above spec', async () => {
  const oversized = await exportPolygon({ idSuffix: 'bump-8', cloudIntensity: 8 });
  assert.match(String(oversized.subtype), /Polygon/);
  assert.equal(oversized.intensity, 8, 'live Bump must write /BE /I 8 from data.pdfCloudIntensity');
  assert.equal(oversized.ap, true, 'Bump 8 must attach /AP so Acrobat does not clamp /BE/I to 2');
  assert.match(oversized.path, /[c]\s/, `oversized /AP must be a cloud path, not a box (got ${oversized.path.slice(0, 160)})`);

  const specBump = await exportPolygon({ idSuffix: 'bump-2', cloudIntensity: 2 });
  assert.equal(specBump.intensity, 2, 'default Bump must still write /BE /I 2');
  assert.equal(specBump.ap, false, 'opaque default Bump 1–2 must omit /AP so viewers keep native /BE scallops');

  const fadedSpec = await exportPolygon({
    idSuffix: 'bump-2-fade',
    cloudIntensity: 2,
    fillOpacity: 40,
  });
  assert.equal(fadedSpec.intensity, 2);
  assert.equal(fadedSpec.ap, true, 'faded default bump still attaches /AP for /ca');
});

test('print flatten rebuilds Polygon Cloud Bump 8 scallops', async () => {
  const oversized = await flattenPolygon({ idSuffix: 'flat-8', cloudIntensity: 8 });
  assert.equal(oversized.intensity, 8);
  assert.match(oversized.text, /\sv\s/, `flatten must stroke a cloud path (got ${oversized.text.slice(0, 240)})`);
});

test('export host still names the Polygon Cloud Bump /AP contract; isolated 8448 / 75/250 standing', () => {
  const flatten = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(flatten, /data\?\.pdfCloudIntensity \?\? fabricObj\?\.cloudIntensity/);
  assert.match(flatten, /Do not invent a create-poly/);
  assert.match(flatten, /Flatten used to stroke the raw vertices so Bump 8 printed as a/);
  assert.doesNotMatch(flatten, /value: 'polygon'|label: 'Polygon'/);
  const shell = read('src/AppShell.jsx');
  assert.doesNotMatch(shell, /value: 'polygon'|label: 'Polygon'/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
