// Counter first-pin create must stamp next-draw Fill Opacity.
// Live toolbar writes Fill as composeColorForPatch rgba, but first-pin
// auto-create used to stamp fillColor hex until the user touched Opacity
// again. Distinct from Counter Circle AP /ca (e0657973) and leftover-18.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { resolveShapeFill } from '../src/utils/annotationStyleCatalog.js';
import { composeColorForPatch } from '../src/utils/annotationData.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeFirstPin(patch = {}) {
  return {
    id: `ctr-first-pin-${patch.idSuffix || 'default'}`,
    type: 'circle',
    left: 40,
    top: 40,
    radius: 14,
    fill: composeColorForPatch('#EF4444', 40),
    stroke: '#ffffff',
    strokeWidth: 1.5,
    opacity: 1,
    data: {
      id: `ctr-first-pin-${patch.idSuffix || 'default'}`,
      type: 'counter',
      seriesId: 'series-first-pin',
      number: 1,
      displayNumber: 1,
      pointerAngle: 225,
      numberColor: '#ffffff',
    },
    ...patch,
  };
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'counter-first-pin-fill-opacity-source.pdf',
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

async function exportFirstPin(patch = {}) {
  const file = await makePdfFile();
  const result = await savePDFWithAnnotationsPdfLib(file, {
    1: { version: '7.4.0', objects: [makeFirstPin(patch)] },
  });
  const doc = await PDFDocument.load(result.pdfBytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  const dict = doc.context.lookup(annots.asArray()[0]);
  return { dict, gs: annotAppearanceGs(doc, dict) };
}

test('first-pin auto-create composes fillColor + fillOpacity, not hex-only', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(
    viewer,
    /seriesColor = composeColorForPatch\(fillColor \|\| '#ef4444', fillOpacity\)/,
    'first-pin auto-create must compose next-draw Fill Opacity',
  );
  assert.equal(
    (viewer.match(/seriesColor = fillColor \|\| '#ef4444'/g) || []).length,
    0,
    'first-pin auto-create must not stamp fillColor hex',
  );
  assert.match(viewer, /Next-draw Fill Opacity must ride the first pin/);
});

test('composeColorForPatch of next-draw 40% is faded; hex-only is opaque', () => {
  const faded = composeColorForPatch('#EF4444', 40);
  assert.equal(faded, 'rgba(239, 68, 68, 0.4)');
  assert.equal(resolveShapeFill({ fill: faded }).opacity, 0.4);
  assert.equal(resolveShapeFill({ fill: '#EF4444' }).opacity, 1);
  assert.equal(resolveShapeFill({ fill: composeColorForPatch('#EF4444', 0) }).visible, false);
});

test('first-pin-shaped export writes Circle AP /ca from composed fill', async () => {
  const faded = await exportFirstPin({ idSuffix: 'fade' });
  assert.equal(faded.dict.get(PDFName.of('CA')), undefined, 'faded first pin must not share dict /CA with the number');
  assert.ok(Math.abs((faded.gs.ca ?? -1) - 0.4) < 0.001, `AP /ca must be fill 0.4 (got ${JSON.stringify(faded.gs)})`);

  const opaque = await exportFirstPin({
    idSuffix: 'opaque',
    fill: '#EF4444',
  });
  assert.equal(opaque.gs.ca, undefined, 'opaque first pin must not invent AP /ca');
});

test('export host still names the first-pin compose contract', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /composeColorForPatch\(fillColor \|\| '#ef4444', fillOpacity\)/);
  const flatten = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(flatten, /GS0: \{ Type: 'ExtGState', ca: fillAlpha \}/);
});
