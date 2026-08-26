// Cloud Bump above spec /BE/I must ride Square /AP.
// Live toolbar writes Style Cloud /BE + Bump 1–20. Persist already stamped
// pdfCloudIntensity and flatten already rebuilt the scallops, but opaque
// export skipped /AP so Acrobat's native /BE (I is only 0–2) clamped Bump
// 8 down to 2. Distinct from Cloud Bump persist (53d63a7c), Cloud Fill
// Opacity /ca (26885c51), and leftover-18. Stroke /CA already rides
// needsFade — confirmed live, not taken.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { buildBoundaryShapeCommitJSON } from '../src/utils/annotationCreationCommit.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const sharedRect = {
  tool: 'rect',
  start: { x: 20, y: 30 },
  end: { x: 120, y: 110 },
  strokeColor: '#ff0000',
  strokeOpacity: 100,
  fillColor: '#ffff00',
  strokeWidth: 2,
  lineBorderStyle: 'cloud',
  selectedModuleId: null,
  stampRegionId: null,
  activeRegionId: null,
};

function makeCloudRect(patch = {}) {
  return buildBoundaryShapeCommitJSON({
    ...sharedRect,
    id: `cloud-bump-export-${patch.idSuffix || 'default'}`,
    fillOpacity: patch.fillOpacity ?? 0,
    strokeOpacity: patch.strokeOpacity ?? 100,
    cloudIntensity: patch.cloudIntensity ?? 8,
  });
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'cloud-bump-export-source.pdf',
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

async function exportRect(patch) {
  const rect = makeCloudRect(patch);
  assert.ok(rect, 'first-create commit must produce a cloud rect');
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [rect] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'cloud-bump-export' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  return {
    rect,
    doc,
    dict,
    intensity: dictBeIntensity(doc, dict),
    ap: hasAppearance(dict),
    path: appearancePathText(doc, dict),
  };
}

async function flattenRect(patch) {
  const rect = makeCloudRect(patch);
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    { 1: { objects: [rect] } },
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
  return { text, intensity: rect.data.pdfCloudIntensity };
}

test('first-create Cloud stamps Bump 8; default fill stays empty', () => {
  const rect = makeCloudRect({ cloudIntensity: 8 });
  assert.equal(rect.data.pdfCloudIntensity, 8);
  assert.equal(rect.fill, 'rgba(255, 255, 0, 0)');
  assert.equal(rect.stroke, 'rgba(255, 0, 0, 1)');
});

test('annotated export writes Cloud /BE/I 8 and /AP when Bump is above spec', async () => {
  const oversized = await exportRect({ idSuffix: 'bump-8', cloudIntensity: 8 });
  assert.equal(oversized.intensity, 8, 'live Bump must still write /BE /I 8');
  assert.equal(oversized.ap, true, 'Bump 8 must attach /AP so Acrobat does not clamp /BE/I to 2');
  assert.match(oversized.path, /[c]\s/, `oversized /AP must be a cloud path, not a box (got ${oversized.path.slice(0, 160)})`);
  assert.doesNotMatch(oversized.path, /^[\s\d.]+re\s/, 'Bump 8 /AP must not be the plain-rect fallback');

  const specBump = await exportRect({ idSuffix: 'bump-2', cloudIntensity: 2 });
  assert.equal(specBump.intensity, 2, 'default Bump must still write /BE /I 2');
  assert.equal(specBump.ap, false, 'opaque default Bump 1–2 must omit /AP so viewers keep native /BE scallops');

  const fadedSpec = await exportRect({
    idSuffix: 'bump-2-fade',
    cloudIntensity: 2,
    fillOpacity: 40,
  });
  assert.equal(fadedSpec.intensity, 2);
  assert.equal(fadedSpec.ap, true, 'faded default bump still attaches /AP for /ca');
});

test('print flatten rebuilds Cloud Bump 8 scallops', async () => {
  const oversized = await flattenRect({ idSuffix: 'flat-8', cloudIntensity: 8 });
  assert.equal(oversized.intensity, 8);
  assert.match(oversized.text, /\sv\s/, `flatten must stroke a cloud path (got ${oversized.text.slice(0, 240)})`);
});

test('export host still names the Cloud Bump /AP contract; isolated 8448 / 75/250 standing', () => {
  const flatten = read('src/utils/pdfAnnotationsPdfLib.js');
  const creation = read('src/utils/annotationCreationCommit.js');
  assert.match(creation, /pdfCloudIntensity: Math\.max\(1, Number\(cloudIntensity\) \|\| 2\)/);
  assert.match(flatten, /const needsOversizedBump = intensity > 2/);
  assert.match(flatten, /if \(needsFade \|\| needsOversizedBump\) \{/);
  assert.match(flatten, /PDF \/BE\/I is only/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
