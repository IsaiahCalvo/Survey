// tests/calloutLineStyleExport.test.mjs
//
// Callout leader line style (solid/dashed/dotted) — PDF export + print
// flatten + persistence round-trip (mirrors calloutArrowheadExport.test.mjs,
// the arrowhead twin from KAL-81).
//
//   1. Annotation export: style.lineStyle maps to a /BS border-style dict
//      (/S /D + /D [6 4] dashed | [2 4] dotted) on BOTH exported Line pieces.
//      Solid / absent → NO /BS key (byte-identical legacy export).
//   2. Print flatten: the content stream carries the dash operator for the
//      leader lines and the box border; solid emits no dash-setting op.
//   3. Metadata round-trip: style.lineStyle rides verbatim inside the callout
//      metadata blob (the app-side source of truth — /BS is only for
//      third-party viewers).
//   4. Bridge round-trip: project → derive preserves lineStyle via
//      data.legacyCallout, and the group-geometry fallback reader recovers it
//      from the projected strokeDashArray.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { PDF_CALLOUT_METADATA_KEY } from '../src/utils/pdfCalloutMetadata.js';
import {
  calloutToAnnotationObject,
  annotationObjectToCallout,
  projectCalloutsIntoByPage,
  deriveCalloutsFromByPage,
} from '../src/utils/calloutAnnotationBridge.js';

async function makePdfFile(name = 'source.pdf') {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

const PAGE_SIZES = { 1: { width: 200, height: 200 } };

const makeCallout = (lineStyle) => ({
  id: `style-${lineStyle || 'default'}`,
  pageNumber: 1,
  arrowTip: { x: 0.1, y: 0.1 },
  knee: { x: 0.2, y: 0.2 },
  textBoxPosition: { x: 0.3, y: 0.2 },
  textBoxWidth: 0.3,
  textBoxHeight: 0.1,
  text: 'Style test',
  style: {
    fontColor: '#1e293b',
    fontSize: 14,
    ...(lineStyle ? { lineStyle } : {}),
  },
});

async function getAnnotationDicts(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => doc.context.lookup(ref));
}

const dictText = (dict, key) => {
  const value = dict.get(PDFName.of(key));
  return value?.decodeText ? value.decodeText() : null;
};

async function exportCalloutLinePieces(lineStyle) {
  const pdfFile = await makePdfFile();
  const bytes = await savePDFWithAnnotationsPdfLib(pdfFile, {}, PAGE_SIZES, null, {
    returnBytes: true,
    callouts: [makeCallout(lineStyle)],
  });
  const dicts = await getAnnotationDicts(bytes);
  const lines = dicts.filter((dict) => dictText(dict, 'Subtype') === 'Line');
  assert.ok(lines.length >= 2, 'callout must export two Line pieces');
  return lines;
}

const readBsDash = (lineDict) => {
  const doc = lineDict; // dicts are already looked-up PDFDicts
  const bs = doc.get(PDFName.of('BS'));
  if (!bs) return null;
  const style = bs.get(PDFName.of('S'));
  const dash = bs.get(PDFName.of('D'));
  return {
    style: style?.decodeText ? style.decodeText() : String(style),
    dash: dash ? dash.asArray().map((n) => n.asNumber()) : null,
  };
};

test('dashed callout exports /BS dash dicts on both Line pieces', async () => {
  const lines = await exportCalloutLinePieces('dashed');
  for (const line of lines) {
    const bs = readBsDash(line);
    assert.ok(bs, 'each leader piece must carry a /BS dict');
    assert.equal(bs.style, 'D', '/BS /S must be the dashed border style');
    assert.deepEqual(bs.dash, [6, 4], '/BS /D must carry the shared dashed pattern');
  }
});

test('dotted callout exports the [2 4] dash pattern', async () => {
  const lines = await exportCalloutLinePieces('dotted');
  for (const line of lines) {
    assert.deepEqual(readBsDash(line)?.dash, [2, 4]);
  }
});

test('solid and legacy (absent lineStyle) callouts export with NO /BS — byte-identical legacy shape', async () => {
  for (const style of ['solid', undefined]) {
    const lines = await exportCalloutLinePieces(style);
    for (const line of lines) {
      assert.equal(line.get(PDFName.of('BS')), undefined,
        `${String(style)} must not add a /BS dict`);
    }
  }
});

test('style.lineStyle rides verbatim in the exported callout metadata blob', async () => {
  const lines = await exportCalloutLinePieces('dotted');
  const line2 = lines.find((dict) => {
    const meta = dictText(dict, PDF_CALLOUT_METADATA_KEY);
    return meta && JSON.parse(meta).part === 'line2';
  });
  const meta = JSON.parse(dictText(line2, PDF_CALLOUT_METADATA_KEY));
  assert.equal(meta.style.lineStyle, 'dotted',
    'metadata round-trip is the app-side source of truth for the line style');
});

// --------------------------------------------------------------------------
// Print flatten
// --------------------------------------------------------------------------

async function flattenCalloutContent(lineStyle) {
  const pdfFile = await makePdfFile();
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(pdfFile, {}, PAGE_SIZES, {
    returnBytes: true,
    callouts: [makeCallout(lineStyle)],
  });
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const contentsRef = page.node.get(PDFName.of('Contents'));
  const contents = doc.context.lookup(contentsRef);
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((ref) => doc.context.lookup(ref))
    : [contents];
  return streams
    .filter((stream) => stream instanceof PDFRawStream)
    .map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()))
    .join('\n');
}

test('print flatten carries the dash operator for dashed and dotted callouts', async () => {
  const dashed = await flattenCalloutContent('dashed');
  assert.ok(/\[\s*6\s+4\s*\]\s+0\s+d\b/.test(dashed),
    'dashed flatten must set the [6 4] dash pattern');
  const dotted = await flattenCalloutContent('dotted');
  assert.ok(/\[\s*2\s+4\s*\]\s+0\s+d\b/.test(dotted),
    'dotted flatten must set the [2 4] dash pattern');
});

test('print flatten of a solid callout sets no dash pattern', async () => {
  const solid = await flattenCalloutContent(undefined);
  assert.ok(!/\[\s*\d[\d\s.]*\]\s+[\d.]+\s+d\b/.test(solid),
    'solid flatten must not emit a non-empty dash-setting op');
});

// --------------------------------------------------------------------------
// Persistence round-trip (dual representation)
// --------------------------------------------------------------------------

const PAGE = { width: 816, height: 1056 };

test('lineStyle survives the project → derive round trip verbatim (data.legacyCallout)', () => {
  const callout = makeCallout('dashed');
  const byPage = projectCalloutsIntoByPage({}, [callout], { 1: PAGE });
  const derived = deriveCalloutsFromByPage(byPage);
  assert.equal(derived.length, 1);
  assert.equal(derived[0].style.lineStyle, 'dashed');
});

test('projected fabric children carry the shared strokeDashArray and the fallback reader recovers lineStyle', () => {
  const obj = calloutToAnnotationObject(makeCallout('dotted'), PAGE);
  const lines = obj.objects.filter((child) => child.type === 'line');
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.deepEqual(line.strokeDashArray, [2, 4]);
  }
  // Group-geometry fallback (no data.legacyCallout on hand):
  const recovered = annotationObjectToCallout(obj, PAGE);
  assert.equal(recovered.style.lineStyle, 'dotted');
});

test('solid callouts project with NO strokeDashArray key (legacy projection byte-identical)', () => {
  const obj = calloutToAnnotationObject(makeCallout(undefined), PAGE);
  for (const line of obj.objects.filter((child) => child.type === 'line')) {
    assert.ok(!('strokeDashArray' in line));
  }
  const recovered = annotationObjectToCallout(obj, PAGE);
  assert.equal(recovered.style.lineStyle, 'solid');
});
