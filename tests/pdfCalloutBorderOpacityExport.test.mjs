// Callout borderOpacity must ride Line /CA and print flatten.
// Live toolbar writes style.borderColor + style.borderOpacity (Color Border
// Opacity). Export/flatten used the hex only, so a user-picked fade printed
// and exported opaque. Distinct from fillColor /C and textbox stroke /Border.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { resolveCalloutBorder } from '../src/utils/annotationStyleCatalog.js';
import { defaultCalloutStyle } from '../src/components/Callout/types.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const PAGE_SIZES = { 1: { width: 200, height: 200 } };

function makeCallout(stylePatch = {}) {
  return {
    id: `callout-border-opacity-${stylePatch.borderOpacity ?? 'default'}`,
    pageNumber: 1,
    arrowTip: { x: 0.10, y: 0.10 },
    knee: { x: 0.20, y: 0.20 },
    textBoxPosition: { x: 0.30, y: 0.20 },
    textBoxWidth: 0.30,
    textBoxHeight: 0.12,
    text: 'Fade',
    style: {
      ...defaultCalloutStyle,
      ...stylePatch,
    },
  };
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'callout-border-opacity-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

const dictText = (dict, key) => {
  const value = dict.get(PDFName.of(key));
  return value?.decodeText ? value.decodeText() : null;
};

function dictNumber(dict, key) {
  const value = dict.get(PDFName.of(key));
  if (value == null) return undefined;
  return value?.asNumber ? value.asNumber() : Number(value);
}

function dictRgb(dict, key) {
  const value = dict.get(PDFName.of(key));
  if (!value || typeof value.asArray !== 'function') return null;
  return value.asArray().map((entry) => (entry?.asNumber ? entry.asNumber() : Number(entry)));
}

async function exportCallout(stylePatch) {
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    {},
    PAGE_SIZES,
    null,
    {
      returnBytes: true,
      actionType: 'pdf-export',
      documentId: 'callout-border-opacity',
      callouts: [makeCallout(stylePatch)],
    },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  return annots.asArray().map((ref) => doc.context.lookup(ref));
}

function pageCaValues(doc, page) {
  const resources = page.node.lookup(PDFName.of('Resources')) || page.node.get(PDFName.of('Resources'));
  const resourcesDict = resources?.lookup ? resources : (resources ? doc.context.lookup(resources) : null);
  const ext = resourcesDict?.lookup?.(PDFName.of('ExtGState')) || resourcesDict?.get?.(PDFName.of('ExtGState'));
  const extDict = ext?.lookup ? ext : (ext ? doc.context.lookup(ext) : null);
  if (!extDict || typeof extDict.entries !== 'function') return [];
  const values = [];
  for (const [, ref] of extDict.entries()) {
    const dict = doc.context.lookup(ref) || ref;
    const ca = dict.get?.(PDFName.of('ca')) ?? dict.get?.(PDFName.of('CA'));
    if (ca != null) values.push(ca.asNumber ? ca.asNumber() : Number(ca));
  }
  return values;
}

async function flattenCallout(stylePatch) {
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    {},
    PAGE_SIZES,
    { returnBytes: true, callouts: [makeCallout(stylePatch)] },
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
  return { text, ca: pageCaValues(doc, page) };
}

test('resolveCalloutBorder maps borderColor / borderOpacity and leftover lineColor', () => {
  assert.deepEqual(resolveCalloutBorder(defaultCalloutStyle), {
    hex: '#1E293B',
    opacity: 1,
    visible: true,
    paint: '#1E293B',
  });
  assert.equal(resolveCalloutBorder({ borderColor: '#ff0000', borderOpacity: 0.4 }).paint, 'rgba(255, 0, 0, 0.4)');
  assert.equal(resolveCalloutBorder({ borderColor: '#ff0000', borderOpacity: 0.4 }).hex, '#FF0000');
  assert.equal(resolveCalloutBorder({ borderColor: '#ff0000', borderOpacity: 0 }).visible, false);
  assert.equal(resolveCalloutBorder({ borderColor: '#ff0000', borderOpacity: 0 }).paint, 'rgba(255, 0, 0, 0)');
  assert.equal(resolveCalloutBorder({ lineColor: '#00FF00' }).hex, '#00FF00');
  assert.equal(resolveCalloutBorder({ borderColor: '#0000FF', lineColor: '#FF0000' }).hex, '#0000FF');
});

test('annotated export writes Line /CA from borderOpacity; opaque omits /CA', async () => {
  const faded = await exportCallout({ borderColor: '#FF0000', borderOpacity: 0.4 });
  const fadedLines = faded.filter((dict) => dictText(dict, 'Subtype') === 'Line');
  assert.equal(fadedLines.length, 2, 'callout must export two Line pieces');
  fadedLines.forEach((dict) => {
    assert.deepEqual(dictRgb(dict, 'C'), [1, 0, 0], '/C stays the stroke hex');
    assert.equal(dictNumber(dict, 'CA'), 0.4, 'Line /CA must be live borderOpacity');
  });
  const fadedText = faded.find((dict) => dictText(dict, 'Subtype') === 'FreeText');
  assert.ok(fadedText, 'faded callout must still export a FreeText');
  assert.equal(dictNumber(fadedText, 'CA'), 0.4, 'FreeText /CA matches SVG group opacity');

  const opaque = await exportCallout({ borderColor: '#FF0000', borderOpacity: 1 });
  const opaqueLines = opaque.filter((dict) => dictText(dict, 'Subtype') === 'Line');
  opaqueLines.forEach((dict) => {
    assert.equal(dict.get(PDFName.of('CA')), undefined, 'opaque Line must omit /CA');
  });
  const opaqueText = opaque.find((dict) => dictText(dict, 'Subtype') === 'FreeText');
  assert.equal(opaqueText.get(PDFName.of('CA')), undefined, 'opaque FreeText must omit /CA');

  const leftover = await exportCallout({
    borderColor: 'transparent',
    lineColor: '#00FF00',
    borderOpacity: 0.5,
  });
  leftover.filter((dict) => dictText(dict, 'Subtype') === 'Line').forEach((dict) => {
    assert.deepEqual(dictRgb(dict, 'C'), [0, 1, 0]);
    assert.equal(dictNumber(dict, 'CA'), 0.5);
  });
});

test('print flatten applies borderOpacity and does not invent a fade for opaque', async () => {
  const faded = await flattenCallout({ borderColor: '#FF0000', borderOpacity: 0.4 });
  assert.match(faded.text, /1\s+0\s+0\s+RG/, `red flatten must stroke #FF0000 (got ${faded.text.slice(0, 240)})`);
  assert.match(faded.text, /\/GS-?\d+ gs/, 'faded flatten must apply a graphics state');
  assert.ok(faded.ca.some((value) => Math.abs(value - 0.4) < 0.001), `faded ExtGState must include /ca 0.4 (got ${faded.ca})`);

  const opaque = await flattenCallout({ borderColor: '#FF0000', borderOpacity: 1 });
  assert.match(opaque.text, /1\s+0\s+0\s+RG/, 'opaque flatten still paints the stroke color');
  assert.ok(opaque.ca.every((value) => value >= 0.999), `opaque flatten must not invent a fade (got ${opaque.ca})`);

  const zero = await flattenCallout({ borderColor: '#FF0000', borderOpacity: 0 });
  assert.ok(zero.ca.some((value) => value === 0), `opacity-0 flatten must write /ca 0 (got ${zero.ca})`);
});

test('export/flatten hosts still name the callout borderOpacity contract', () => {
  const flatten = read('src/utils/pdfAnnotationsPdfLib.js');
  const catalog = read('src/utils/annotationStyleCatalog.js');
  assert.match(catalog, /export function resolveCalloutBorder/);
  assert.match(flatten, /resolveCalloutBorder\(style\)/);
  assert.match(flatten, /opacity: strokeOpacity/);
  assert.match(flatten, /if \(alpha < 0\.99999\) annotationDict\.CA = alpha/);
});
