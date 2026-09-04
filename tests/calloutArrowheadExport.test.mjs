// Callout leader arrowhead — PDF export + print flatten parity (KAL-81).
//
// The callout adopted the arrow tool's shared arrowhead machinery
// (buildArrowheadRenderSpec, one home in src/utils/lineRenderHelpers.js).
// These tests lock the two PDF surfaces:
//   1. Annotation export: the callout's line2 piece carries the /LE line
//      ending mapped from style.arrowheadStyle (ARROWHEAD_STYLE_TO_PDF_LINE_
//      ENDING — the inverse of PageAnnotationLayer's import map). Default /
//      absent style stays ClosedArrow, byte-identical to the legacy export.
//   2. Print flatten: the head is DRAWN via the shared spec (pdf-lib twin of
//      the canvas painter), with all coordinates ON the page — regression
//      guard for the drawSvgPath origin trap (pdf-lib negates path y around
//      options.y, which defaults to the page BOTTOM).
//   3. Metadata round-trip: style.arrowheadStyle rides verbatim inside the
//      callout metadata blob on every exported piece.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { PDF_CALLOUT_METADATA_KEY } from '../src/utils/pdfCalloutMetadata.js';

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

const makeCallout = (arrowheadStyle) => ({
  id: `head-${arrowheadStyle || 'default'}`,
  pageNumber: 1,
  arrowTip: { x: 0.1, y: 0.1 },
  knee: { x: 0.2, y: 0.2 },
  textBoxPosition: { x: 0.3, y: 0.2 },
  textBoxWidth: 0.3,
  textBoxHeight: 0.1,
  text: 'Head test',
  style: {
    fontColor: '#1e293b',
    fontSize: 14,
    ...(arrowheadStyle ? { arrowheadStyle } : {}),
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

async function exportCalloutLineEndings(arrowheadStyle) {
  const pdfFile = await makePdfFile();
  const bytes = await savePDFWithAnnotationsPdfLib(pdfFile, {}, PAGE_SIZES, null, {
    returnBytes: true,
    callouts: [makeCallout(arrowheadStyle)],
  });
  const dicts = await getAnnotationDicts(bytes);
  const lines = dicts.filter((dict) => dictText(dict, 'Subtype') === 'Line');
  assert.ok(lines.length >= 2, 'callout must export two Line pieces');
  // line2 (knee → tip) is the piece whose metadata part is 'line2'
  const line2 = lines.find((dict) => {
    const meta = dictText(dict, PDF_CALLOUT_METADATA_KEY);
    return meta && JSON.parse(meta).part === 'line2';
  });
  assert.ok(line2, 'line2 piece with callout metadata must exist');
  const le = line2.get(PDFName.of('LE'));
  if (!le) return { leNames: null, line2 };
  return { leNames: le.asArray().map((name) => name.decodeText()), line2 };
}

test('callout with no arrowheadStyle exports the legacy ClosedArrow ending (visual no-op)', async () => {
  const { leNames } = await exportCalloutLineEndings(undefined);
  assert.deepEqual(leNames, ['None', 'ClosedArrow']);
});

test('each callout arrowhead style maps to its closest PDF /LE name', async () => {
  // Ruled change 2026-09-03 (owner, via the arrow-endings batch): Slash is now
  // drawn as a true slash, so the V may no longer export as Slash — a V that
  // came back as a slash would be exactly the "file asks for a different shape
  // than the one drawn" defect this batch removes. PDF 32000 §12.5.6.7 defines
  // OpenArrow as two short lines meeting at an acute angle, i.e. the V.
  const expected = {
    solidTriangle: 'ClosedArrow',
    openTriangle: 'OpenArrow',
    openCircle: 'Circle',
    vShape: 'OpenArrow',
    horizontalLine: 'Butt',
    diamond: 'Diamond',
    slash: 'Slash',
    none: 'None',
  };
  for (const [style, leName] of Object.entries(expected)) {
    const { leNames } = await exportCalloutLineEndings(style);
    assert.deepEqual(leNames, ['None', leName], `style ${style} must map to /LE ${leName}`);
  }
});

test('style.arrowheadStyle rides verbatim in the exported callout metadata blob', async () => {
  const { line2 } = await exportCalloutLineEndings('openCircle');
  const meta = JSON.parse(dictText(line2, PDF_CALLOUT_METADATA_KEY));
  assert.equal(meta.style.arrowheadStyle, 'openCircle',
    'metadata round-trip is the app-side source of truth for the head style');
});

// --------------------------------------------------------------------------
// Print flatten
// --------------------------------------------------------------------------

async function flattenCalloutContent(arrowheadStyle) {
  const pdfFile = await makePdfFile();
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(pdfFile, {}, PAGE_SIZES, {
    returnBytes: true,
    callouts: [makeCallout(arrowheadStyle)],
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

// Extract "x y m ... x y l ... h f" filled closed subpaths (the triangle head).
const filledClosedPaths = (contentText) => (
  contentText.match(/[\d.-]+ [\d.-]+ m[\s\S]*?h\s*\n?f\b/g) || []
);

test('print flatten draws the default solid-triangle head as a filled ON-PAGE path', async () => {
  const contentText = await flattenCalloutContent(undefined);
  const heads = filledClosedPaths(contentText);
  assert.equal(heads.length, 1, 'exactly one filled closed path (the head) expected');
  // Off-page regression guard: every coordinate of the head path must land
  // inside the 200x200 page (the drawSvgPath default origin would put y < 0).
  const coords = heads[0].match(/(-?[\d.]+) (-?[\d.]+) (?:m|l)/g).map((op) => {
    const [x, y] = op.split(' ');
    return { x: Number(x), y: Number(y) };
  });
  assert.ok(coords.length >= 3, 'triangle head must have 3+ path points');
  for (const { x, y } of coords) {
    assert.ok(x >= 0 && x <= 200, `head x ${x} must be on the 200pt page`);
    assert.ok(y >= 0 && y <= 200, `head y ${y} must be on the 200pt page`);
  }
});

test('print flatten with arrowhead style none draws no head', async () => {
  const contentText = await flattenCalloutContent('none');
  assert.equal(filledClosedPaths(contentText).length, 0, 'no filled head path for none');
  // and no extra stroked segments beyond the two leader lines + box border
  const defaultText = await flattenCalloutContent(undefined);
  assert.ok(contentText.length < defaultText.length,
    'none must emit strictly fewer ops than the default solid triangle');
});

test('print flatten draws the open-circle head as stroked curves', async () => {
  const withCircle = await flattenCalloutContent('openCircle');
  const withNone = await flattenCalloutContent('none');
  const curveCount = (text) => (text.match(/ c\n/g) || []).length;
  assert.ok(curveCount(withCircle) >= 4,
    'circle head must emit bezier curve ops');
  assert.ok(curveCount(withCircle) > curveCount(withNone),
    'circle head must add curve ops over the none baseline');
});
