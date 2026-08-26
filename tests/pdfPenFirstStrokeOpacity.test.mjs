// Pen first-stroke create must stamp next-draw Color Opacity.
// Live toolbar writes Color as hex + strokeOpacity. First-stroke used to
// stamp strokeColor hex, so a faded next-draw never reached persist /
// reimport / export until the user touched Opacity again. Highlighter
// already composes via highlightColor. Distinct from leftover-18 and
// ink /CA export of already-rgba fills.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { buildFreehandCommitJSON, composeAnnotationColor } from '../src/utils/annotationCreationCommit.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeFirstStroke(patch = {}) {
  return buildFreehandCommitJSON({
    tool: 'pen',
    id: `pen-first-stroke-${patch.idSuffix || 'default'}`,
    points: [{ x: 20, y: 40 }, { x: 80, y: 48 }, { x: 140, y: 36 }],
    strokeColor: '#ff0000',
    strokeOpacity: 40,
    strokeWidth: 3,
    ...patch,
  });
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'pen-first-stroke-opacity-source.pdf',
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

function annotAppearanceGs(doc, dict) {
  const ap = lookupDict(doc, dict.get(PDFName.of('AP')));
  if (!ap) return {};
  const nRef = ap.get(PDFName.of('N'));
  const stream = nRef?.dict ? nRef : doc.context.lookup(nRef);
  if (!stream) return {};
  const streamDict = stream.dict || stream;
  const resources = lookupDict(doc, streamDict.lookup?.(PDFName.of('Resources')) || streamDict.get?.(PDFName.of('Resources')));
  const ext = lookupDict(doc, resources?.lookup?.(PDFName.of('ExtGState')) || resources?.get?.(PDFName.of('ExtGState')));
  if (!ext || typeof ext.entries !== 'function') return {};
  const result = {};
  for (const [, ref] of ext.entries()) {
    const gs = doc.context.lookup(ref) || ref;
    const ca = gs.get?.(PDFName.of('ca'));
    const CA = gs.get?.(PDFName.of('CA'));
    if (ca != null) result.ca = ca.asNumber ? ca.asNumber() : Number(ca);
    if (CA != null) result.CA = CA.asNumber ? CA.asNumber() : Number(CA);
  }
  return result;
}

function dictNumber(dict, key) {
  const value = dict.get(PDFName.of(key));
  if (value == null) return undefined;
  return value?.asNumber ? value.asNumber() : Number(value);
}

async function exportFirstStroke(patch = {}) {
  const ink = makeFirstStroke(patch);
  assert.ok(ink, 'first-stroke commit must produce ink');
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [ink] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'pen-first-stroke-opacity' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  return { dict, gs: annotAppearanceGs(doc, dict), ink };
}

test('first-stroke commit composes strokeColor + strokeOpacity, not hex-only', () => {
  const commit = read('src/utils/annotationCreationCommit.js');
  assert.match(
    commit,
    /: composeAnnotationColor\(strokeColor, strokeOpacity\)/,
    'pen first-stroke must compose next-draw Color Opacity',
  );
  assert.equal(
    (commit.match(/: strokeColor,/g) || []).length,
    0,
    'pen first-stroke must not stamp strokeColor hex',
  );
  assert.match(commit, /Next-draw Color Opacity must ride the first pen stroke/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /strokeOpacity,/);
  assert.match(
    layer,
    /shapeCreation\.tool === 'highlighter'\s*\n\s*\? highlightColor\s*\n\s*: composeAnnotationColor\(strokeColor, strokeOpacity\)/,
  );
});

test('composeAnnotationColor of next-draw 40% is faded; hex-only is opaque', () => {
  const faded = composeAnnotationColor('#ff0000', 40);
  assert.equal(faded, 'rgba(255, 0, 0, 0.4)');
  const ink = makeFirstStroke();
  assert.equal(ink.fill, 'rgba(255, 0, 0, 0.4)');
  assert.equal(ink.tool, 'pen');
  const opaque = buildFreehandCommitJSON({
    tool: 'pen',
    id: 'pen-opaque',
    points: [{ x: 10, y: 10 }, { x: 40, y: 14 }],
    strokeColor: '#ff0000',
    strokeOpacity: 100,
    strokeWidth: 3,
  });
  assert.equal(opaque.fill, 'rgba(255, 0, 0, 1)');
  const hexOnly = buildFreehandCommitJSON({
    tool: 'pen',
    id: 'pen-hex',
    points: [{ x: 10, y: 10 }, { x: 40, y: 14 }],
    strokeColor: '#ff0000',
    strokeWidth: 3,
  });
  assert.equal(hexOnly.fill, 'rgba(255, 0, 0, 1)');
});

test('first-stroke-shaped export writes Ink /CA from composed fill', async () => {
  const faded = await exportFirstStroke({ idSuffix: 'fade' });
  assert.ok(Math.abs((dictNumber(faded.dict, 'CA') ?? -1) - 0.4) < 0.001, `dict /CA must be fill 0.4 (got ${dictNumber(faded.dict, 'CA')})`);
  assert.ok(
    Math.abs((faded.gs.CA ?? faded.gs.ca ?? -1) - 0.4) < 0.001,
    `AP /CA must be fill 0.4 (got ${JSON.stringify(faded.gs)})`,
  );

  const opaque = await exportFirstStroke({
    idSuffix: 'opaque',
    strokeOpacity: 100,
  });
  assert.ok(
    (dictNumber(opaque.dict, 'CA') ?? 1) >= 0.999,
    'opaque first stroke must not invent a fade',
  );
});

test('highlighter first-stroke still uses highlightColor; Width floor stays 8', () => {
  const hi = buildFreehandCommitJSON({
    tool: 'highlighter',
    id: 'hi-first',
    points: [{ x: 10, y: 10 }, { x: 40, y: 14 }],
    strokeColor: '#ff0000',
    strokeOpacity: 40,
    highlightColor: 'rgba(255, 255, 0, 0.5)',
    strokeWidth: 4,
  });
  assert.equal(hi.fill, 'rgba(255, 255, 0, 0.5)');
  assert.equal(hi.sourceWidth, 8);
});
