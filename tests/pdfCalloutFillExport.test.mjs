// Callout box fill must ride FreeText /C and print flatten.
// Live toolbar writes style.fillColor / fillOpacity. Export/flatten used
// style.backgroundColor and flatten defaulted to #ffffff — transparent
// boxes printed white and a user-picked fill never reached /C.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { resolveCalloutBoxFill } from '../src/utils/annotationStyleCatalog.js';
import { defaultCalloutStyle } from '../src/components/Callout/types.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const PAGE_SIZES = { 1: { width: 200, height: 200 } };

function makeCallout(stylePatch = {}) {
  return {
    id: `callout-fill-${stylePatch.fillColor || 'default'}`,
    pageNumber: 1,
    arrowTip: { x: 0.10, y: 0.10 },
    knee: { x: 0.20, y: 0.20 },
    textBoxPosition: { x: 0.30, y: 0.20 },
    textBoxWidth: 0.30,
    textBoxHeight: 0.12,
    text: 'Fill',
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
    name: 'callout-fill-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

const dictText = (dict, key) => {
  const value = dict.get(PDFName.of(key));
  return value?.decodeText ? value.decodeText() : null;
};

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
      documentId: 'callout-fill',
      callouts: [makeCallout(stylePatch)],
    },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  return annots.asArray().map((ref) => doc.context.lookup(ref));
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
  return streams
    .filter((stream) => stream instanceof PDFRawStream)
    .map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()))
    .join('\n');
}

test('resolveCalloutBoxFill maps fillColor / fillOpacity and leftover backgroundColor', () => {
  assert.deepEqual(resolveCalloutBoxFill(defaultCalloutStyle), {
    hex: null,
    opacity: 0,
    visible: false,
    paint: 'transparent',
  });
  assert.equal(defaultCalloutStyle.fillColor, 'transparent');
  assert.equal(resolveCalloutBoxFill({ fillColor: '#ffff00' }).hex, '#FFFF00');
  assert.equal(resolveCalloutBoxFill({ fillColor: '#FFFF00', fillOpacity: 1 }).visible, true);
  assert.equal(resolveCalloutBoxFill({ fillColor: '#FFFF00', fillOpacity: 0 }).visible, false);
  assert.equal(resolveCalloutBoxFill({ fillColor: '#FFFF00', fillOpacity: 0.4 }).paint, 'rgba(255, 255, 0, 0.4)');
  assert.equal(resolveCalloutBoxFill({ backgroundColor: '#00FF00' }).hex, '#00FF00');
  assert.equal(resolveCalloutBoxFill({ fillColor: 'transparent', backgroundColor: '#00FF00' }).hex, '#00FF00');
  assert.equal(resolveCalloutBoxFill({ fillColor: '#0000FF', backgroundColor: '#FF0000' }).hex, '#0000FF');
});

test('annotated export writes FreeText /C from fillColor; transparent omits /C', async () => {
  const yellow = await exportCallout({ fillColor: '#FFFF00', fillOpacity: 1 });
  const yellowText = yellow.find((dict) => dictText(dict, 'Subtype') === 'FreeText');
  assert.ok(yellowText, 'yellow callout must export a FreeText');
  assert.deepEqual(dictRgb(yellowText, 'C'), [1, 1, 0]);

  const clear = await exportCallout({ fillColor: 'transparent', fillOpacity: 1 });
  const clearText = clear.find((dict) => dictText(dict, 'Subtype') === 'FreeText');
  assert.ok(clearText, 'transparent callout must still export a FreeText');
  assert.equal(clearText.get(PDFName.of('C')), undefined);

  const leftover = await exportCallout({ backgroundColor: '#00FF00' });
  const leftoverText = leftover.find((dict) => dictText(dict, 'Subtype') === 'FreeText');
  assert.deepEqual(dictRgb(leftoverText, 'C'), [0, 1, 0]);
});

test('print flatten paints fillColor and does not invent white for transparent', async () => {
  const yellow = await flattenCallout({ fillColor: '#FFFF00', fillOpacity: 1 });
  assert.match(yellow, /1\s+1\s+0\s+rg/, `yellow flatten must fill #FFFF00 (got ${yellow.slice(0, 240)})`);

  const clear = await flattenCallout({ fillColor: 'transparent' });
  assert.doesNotMatch(clear, /1\s+1\s+1\s+rg/, 'transparent flatten must not invent a white box');
  assert.doesNotMatch(clear, /1\s+1\s+0\s+rg/);

  const faded = await flattenCallout({ fillColor: '#FFFF00', fillOpacity: 0.4 });
  assert.match(faded, /1\s+1\s+0\s+rg/, 'partial fillOpacity still paints the fill color');
});

test('export/flatten hosts still name the callout fillColor contract', () => {
  const flatten = read('src/utils/pdfAnnotationsPdfLib.js');
  const catalog = read('src/utils/annotationStyleCatalog.js');
  assert.match(catalog, /export function resolveCalloutBoxFill/);
  assert.match(flatten, /backgroundColor: boxFill\.visible \? boxFill\.paint : 'transparent'/);
  assert.match(flatten, /paintWithGroupOpacity\(resolveCalloutBoxFill\(style\), groupOpacity\)/);
  assert.doesNotMatch(flatten, /fill: style\.backgroundColor \|\| '#ffffff'/);
  assert.doesNotMatch(flatten, /backgroundColor: style\.backgroundColor \|\| null/);
});
