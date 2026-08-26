// Counter first-pin create must stamp Counter Fill, not rect's empty fill.
// Live toolbar Fill is the badge body. Counter prefs used to omit
// fillColor/fillOpacity, so Shapes → Counter inherited rect's #ffffff / 0
// and first-pin compose stamped a transparent pin. Distinct from Counter
// first-pin fillOpacity compose (66dff649), Number export GS1 /ca
// (4562beb2), and leftover-18.
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
    id: `ctr-first-pin-fill-${patch.idSuffix || 'default'}`,
    type: 'circle',
    left: 40,
    top: 40,
    radius: 14,
    fill: composeColorForPatch('#ef4444', 100),
    stroke: '#ffffff',
    strokeWidth: 1.5,
    opacity: 1,
    data: {
      id: `ctr-first-pin-fill-${patch.idSuffix || 'default'}`,
      type: 'counter',
      seriesId: 'series-first-pin-fill',
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
    name: 'counter-first-pin-fill-color-source.pdf',
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
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [makeFirstPin(patch)] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'counter-first-pin-fill-color' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  return { dict, gs: annotAppearanceGs(doc, dict) };
}

test('Counter defaults include badge Fill; Number is white; prefs merge per key', () => {
  const db = read('src/hooks/useDatabase.js');
  assert.match(
    db,
    /counter: \{ strokeColor: '#ffffff', strokeWidth: 14, strokeOpacity: 100, fillColor: '#ef4444', fillOpacity: 100 \}/,
    'Counter defaults must stamp badge Fill separate from Number',
  );
  assert.match(
    db,
    /\.\.\.\(DEFAULT_TOOL_PREFERENCES\[toolId\] \|\| \{\}\)/,
    'getToolPreference must merge per-tool defaults so omitted fill keys do not leak rect empty fill',
  );
  assert.equal(
    (db.match(/strokeColor is the circle fill/g) || []).length,
    0,
    'stale strokeColor-as-circle-fill comment must not remain',
  );
});

test('Counter default Fill compose is opaque red; inherited rect empty fill is transparent', () => {
  const badge = composeColorForPatch('#ef4444', 100);
  assert.equal(badge, 'rgba(239, 68, 68, 1)');
  assert.equal(resolveShapeFill({ fill: badge }).opacity, 1);
  assert.equal(resolveShapeFill({ fill: badge }).hex?.toLowerCase(), '#ef4444');

  const leakedRect = composeColorForPatch('#ffffff', 0);
  assert.equal(leakedRect, 'rgba(255, 255, 255, 0)');
  assert.equal(resolveShapeFill({ fill: leakedRect }).visible, false);
});

test('first-pin-shaped export writes opaque Counter Fill without inventing /ca', async () => {
  const badge = await exportFirstPin({ idSuffix: 'badge' });
  assert.equal(badge.dict.get(PDFName.of('CA')), undefined, 'opaque first pin must not share dict /CA with the number');
  assert.equal(badge.gs.ca, undefined, 'opaque Counter Fill must not invent AP /ca');

  const leaked = await exportFirstPin({
    idSuffix: 'leaked-rect',
    fill: composeColorForPatch('#ffffff', 0),
  });
  assert.ok(
    leaked.gs.ca === 0 || leaked.gs.ca === undefined,
    `transparent leaked rect fill must not paint an opaque body (got ${JSON.stringify(leaked.gs)})`,
  );
});

test('first-pin create still composes fillColor + fillOpacity', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /seriesColor = composeColorForPatch\(fillColor \|\| '#ef4444', fillOpacity\)/);
  const db = read('src/hooks/useDatabase.js');
  assert.match(db, /fillColor: '#ef4444', fillOpacity: 100/);
});
