// P1-01 / P1-02 / P1-03 / P1-04 / P2-37 — export + print flatten correctness.
//
// Drawn lines/arrows store x1..y2 CENTER-RELATIVE to the bbox (fabric
// contract). On-screen renderers compensate via getLineEndpoints; these
// tests lock the two PDF writers to the same formula, using fixtures that
// include real left/top (the previous suite omitted them and hid the bug).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { ARROWHEAD_STYLES } from '../src/utils/lineRenderHelpers.js';
import { getLineEndpoints } from '../src/utils/svgBoundingBox.js';

const PAGE = 200;
const PAGE_SIZES = { 1: { width: PAGE, height: PAGE } };

async function makePdfFile(name = 'source.pdf') {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE, PAGE]);
  const bytes = await doc.save();
  return {
    name,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

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

const dictNums = (dict, key) => {
  const value = dict.get(PDFName.of(key));
  if (!value) return null;
  return value.asArray().map((item) => Number(item.asNumber ? item.asNumber() : item));
};

async function flattenContent(objects) {
  const pdfFile = await makePdfFile();
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    pdfFile,
    { 1: { objects } },
    PAGE_SIZES,
    { returnBytes: true },
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

// Fabric-contract line: (100,100) → (150,140) stored center-relative.
const DRAWN_LINE = {
  id: 'drawn-line-1',
  type: 'line',
  tool: 'line',
  left: 100,
  top: 100,
  width: 50,
  height: 40,
  x1: -25,
  y1: -20,
  x2: 25,
  y2: 20,
  stroke: '#111111',
  strokeWidth: 2,
};

const DRAWN_ARROW = {
  ...DRAWN_LINE,
  id: 'drawn-arrow-1',
  tool: 'arrow',
  data: { id: 'drawn-arrow-1', arrowheadStyle: ARROWHEAD_STYLES.SOLID_TRIANGLE },
};

test('getLineEndpoints absolutizes the fabric-contract fixture to the drawn segment', () => {
  const { x1, y1, x2, y2 } = getLineEndpoints(DRAWN_LINE);
  assert.equal(x1, 100);
  assert.equal(y1, 100);
  assert.equal(x2, 150);
  assert.equal(y2, 140);
});

test('P1-01: exported Line /L uses page-absolute endpoints, not center-relative x1..y2', async () => {
  const pdfFile = await makePdfFile();
  const bytes = await savePDFWithAnnotationsPdfLib(pdfFile, {
    1: { objects: [DRAWN_LINE] },
  }, PAGE_SIZES, null, { returnBytes: true });

  const dicts = await getAnnotationDicts(bytes);
  const line = dicts.find((dict) => dictText(dict, 'Subtype') === 'Line');
  assert.ok(line, 'line must export as a Line annotation');
  const L = dictNums(line, 'L');
  assert.ok(L, '/L must be written');
  // PDF y is flipped: pageHeight - appY
  assert.deepEqual(L.map((n) => Math.round(n * 100) / 100), [100, 100, 150, 60]);
});

test('P1-01: print flatten draws the line on-page at the absolutized endpoints', async () => {
  const content = await flattenContent([DRAWN_LINE]);
  // pdf-lib drawLine emits the two endpoints (after getPdfY) in the stream.
  assert.match(content, /100(\.0+)?\s+100(\.0+)?\s+m/);
  assert.match(content, /150(\.0+)?\s+60(\.0+)?\s+l/);
  assert.doesNotMatch(content, /Infinity|NaN/);
});

test('P1-01: callout-style absolute leaders (no left/top) are not double-offset', async () => {
  const pdfFile = await makePdfFile();
  const bytes = await savePDFWithAnnotationsPdfLib(pdfFile, {
    1: {
      objects: [{
        id: 'abs-line',
        type: 'line',
        x1: 20,
        y1: 30,
        x2: 80,
        y2: 90,
        stroke: '#000000',
        strokeWidth: 1,
      }],
    },
  }, PAGE_SIZES, null, { returnBytes: true });
  const dicts = await getAnnotationDicts(bytes);
  const line = dicts.find((dict) => dictText(dict, 'Subtype') === 'Line');
  const L = dictNums(line, 'L');
  assert.deepEqual(L.map((n) => Math.round(n * 100) / 100), [20, 170, 80, 110]);
});

const STYLE_TO_LE = {
  [ARROWHEAD_STYLES.NONE]: 'None',
  [ARROWHEAD_STYLES.SOLID_TRIANGLE]: 'ClosedArrow',
  [ARROWHEAD_STYLES.OPEN_TRIANGLE]: 'OpenArrow',
  [ARROWHEAD_STYLES.OPEN_CIRCLE]: 'Circle',
  [ARROWHEAD_STYLES.V_SHAPE]: 'Slash',
  [ARROWHEAD_STYLES.HORIZONTAL_LINE]: 'Butt',
};

test('P1-02: data.arrowheadStyle maps onto /LE for every arrowhead style', async () => {
  for (const [style, expected] of Object.entries(STYLE_TO_LE)) {
    const pdfFile = await makePdfFile();
    const bytes = await savePDFWithAnnotationsPdfLib(pdfFile, {
      1: {
        objects: [{
          ...DRAWN_ARROW,
          id: `arrow-${style}`,
          data: { id: `arrow-${style}`, arrowheadStyle: style },
        }],
      },
    }, PAGE_SIZES, null, { returnBytes: true });
    const dicts = await getAnnotationDicts(bytes);
    const line = dicts.find((dict) => dictText(dict, 'Subtype') === 'Line');
    assert.ok(line, `${style} must export a Line`);
    const le = line.get(PDFName.of('LE'));
    if (style === ARROWHEAD_STYLES.NONE) {
      // None is still written so re-import does not invent a ClosedArrow.
      if (le) {
        const names = le.asArray().map((name) => name.decodeText());
        assert.deepEqual(names, ['None', 'None']);
      }
      continue;
    }
    assert.ok(le, `${style} must write /LE`);
    const names = le.asArray().map((name) => name.decodeText());
    assert.equal(names[1], expected, `${style} → ${expected}`);
  }
});

test('P1-02: tool=arrow without an explicit style still exports ClosedArrow (renderer fallback)', async () => {
  const pdfFile = await makePdfFile();
  const bytes = await savePDFWithAnnotationsPdfLib(pdfFile, {
    1: { objects: [{ ...DRAWN_LINE, id: 'bare-arrow', tool: 'arrow' }] },
  }, PAGE_SIZES, null, { returnBytes: true });
  const dicts = await getAnnotationDicts(bytes);
  const line = dicts.find((dict) => dictText(dict, 'Subtype') === 'Line');
  const names = line.get(PDFName.of('LE')).asArray().map((name) => name.decodeText());
  assert.deepEqual(names, ['None', 'ClosedArrow']);
});

test('P1-03: cloud rectangle export writes /BE /S /C and keeps intensity in metadata', async () => {
  const pdfFile = await makePdfFile();
  const bytes = await savePDFWithAnnotationsPdfLib(pdfFile, {
    1: {
      objects: [{
        id: 'cloud-1',
        type: 'rect',
        left: 20,
        top: 20,
        width: 80,
        height: 40,
        stroke: '#ff0000',
        fill: 'transparent',
        strokeWidth: 2,
        data: { id: 'cloud-1', pdfCloudIntensity: 3 },
      }],
    },
  }, PAGE_SIZES, null, { returnBytes: true });
  const dicts = await getAnnotationDicts(bytes);
  const square = dicts.find((dict) => dictText(dict, 'Subtype') === 'Square');
  assert.ok(square, 'cloud rect must export as Square');
  const be = square.lookup(PDFName.of('BE'));
  assert.ok(be, '/BE must be present');
  assert.equal(be.get(PDFName.of('S')).decodeText(), 'C');
  assert.equal(be.get(PDFName.of('I')).asNumber(), 3);
});

test('P1-03: print flatten of a cloud rect emits a scalloped path, not a plain re', async () => {
  const content = await flattenContent([{
    id: 'cloud-print',
    type: 'rect',
    left: 20,
    top: 20,
    width: 80,
    height: 40,
    stroke: '#ff0000',
    fill: 'transparent',
    strokeWidth: 2,
    data: { pdfCloudIntensity: 2 },
  }]);
  assert.match(content, /[cCvVyY]/, 'cloud flatten must use curve ops');
  assert.doesNotMatch(content, /Infinity|NaN/);
});

test('P1-04: print flatten multiplies rect/ellipse size by |scaleX|/|scaleY|', async () => {
  const rectContent = await flattenContent([{
    type: 'rect',
    left: 10,
    top: 10,
    width: 20,
    height: 10,
    scaleX: 2,
    scaleY: 3,
    stroke: '#000000',
    strokeWidth: 1,
  }]);
  // Scaled box is 40×30. pdf-lib may emit `re` or a translated path
  // (cm + 0 0 m / 0 30 l / 40 30 l / 40 0 l). Origin y = 200-(10+30)=160.
  assert.match(rectContent, /1 0 0 1 10(\.0+)? 160(\.0+)? cm/);
  assert.match(rectContent, /40(\.0+)?\s+30(\.0+)?\s+l/);

  const ellipseContent = await flattenContent([{
    type: 'ellipse',
    left: 40,
    top: 40,
    width: 20,
    height: 10,
    rx: 10,
    ry: 5,
    scaleX: 2,
    scaleY: 2,
    stroke: '#000000',
    strokeWidth: 1,
  }]);
  assert.doesNotMatch(ellipseContent, /Infinity|NaN/);
  // Unscaled would be a tiny oval; scaled rx=20, ry=10 must produce a
  // larger path. A 20×10 bbox at scale 2 spans 40×20.
  const nums = ellipseContent.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  const maxSpan = Math.max(...nums) - Math.min(...nums.filter((n) => n > 0));
  assert.ok(maxSpan >= 30, `scaled ellipse should span tens of units, got ${maxSpan}`);
});

test('P2-37: non-finite line geometry is skipped (no Infinity/NaN in the PDF)', async () => {
  const pdfFile = await makePdfFile();
  const bytes = await savePDFWithAnnotationsPdfLib(pdfFile, {
    1: {
      objects: [{
        id: 'bad-line',
        type: 'line',
        left: 10,
        top: 10,
        width: 10,
        height: 10,
        x1: Infinity,
        y1: 0,
        x2: 10,
        y2: NaN,
        stroke: '#000000',
      }],
    },
  }, PAGE_SIZES, null, { returnBytes: true });
  const asText = new TextDecoder('latin1').decode(bytes);
  assert.doesNotMatch(asText, /Infinity|NaN/);
  const dicts = await getAnnotationDicts(bytes);
  assert.equal(dicts.filter((dict) => dictText(dict, 'Subtype') === 'Line').length, 0);
});
