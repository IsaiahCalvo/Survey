import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib';

import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';

const PAGE_WIDTH = 240;
const PAGE_HEIGHT = 180;
const PAGE_SIZES = { 1: { width: PAGE_WIDTH, height: PAGE_HEIGHT } };
const fidelityPdfUrl = new URL('../debug/fixtures/print-fidelity.pdf', import.meta.url);
const fidelityManifestUrl = new URL('../debug/fixtures/print-fidelity.manifest.json', import.meta.url);

const fileFromBytes = (bytes, name = 'batch-5.pdf') => ({
  name,
  async arrayBuffer() {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  },
});

async function blankFile() {
  const pdf = await PDFDocument.create();
  pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  return fileFromBytes(await pdf.save());
}

const textValue = (dict, key) => dict.get(PDFName.of(key))?.decodeText?.() || '';

const pageAnnotationDicts = (pdf, pageIndex = 0) => {
  const annots = pdf.getPage(pageIndex).node.lookup(PDFName.of('Annots'), PDFArray);
  return annots?.asArray?.().map((entry) => pdf.context.lookup(entry, PDFDict)) || [];
};

const numberArray = (pdf, value) => {
  if (value === undefined || value === null) return [];
  const array = pdf.context.lookup(value, PDFArray);
  return array?.asArray?.().map((entry) => pdf.context.lookup(entry)?.asNumber?.()) || [];
};

const decodedPageContent = (pdf, pageIndex = 0) => {
  const contents = pdf.context.lookup(pdf.getPage(pageIndex).node.get(PDFName.of('Contents')));
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((entry) => pdf.context.lookup(entry))
    : [contents];
  return streams
    .filter((stream) => stream instanceof PDFRawStream)
    .map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()))
    .join('\n');
};

const decodedNormalAppearance = (pdf, dict) => {
  const appearance = pdf.context.lookup(dict.get(PDFName.of('AP')), PDFDict);
  const stream = pdf.context.lookup(appearance?.get(PDFName.of('N')));
  return stream instanceof PDFRawStream
    ? new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode())
    : '';
};

test('export skips non-finite, off-page, and zero-length line geometry', async () => {
  const output = await savePDFWithAnnotationsPdfLib(await blankFile(), {
    1: { objects: [
      { id: 'valid', type: 'line', x1: 20, y1: 30, x2: 100, y2: 70, stroke: '#008000' },
      { id: 'zero', type: 'line', x1: 12, y1: 12, x2: 12, y2: 12, stroke: '#ff0000' },
      { id: 'outside', type: 'line', x1: -9000, y1: 10, x2: 9000, y2: 20, stroke: '#ff0000' },
      { id: 'nan', type: 'line', x1: Number.NaN, y1: 0, x2: 30, y2: 30, stroke: '#ff0000' },
    ] },
  }, PAGE_SIZES, null, { returnBytes: true });

  const pdf = await PDFDocument.load(output);
  const dicts = pageAnnotationDicts(pdf);
  assert.equal(dicts.length, 1);
  assert.equal(textValue(dicts[0], 'NM'), 'valid');
  for (const dict of dicts) {
    const values = [
      ...numberArray(pdf, dict.get(PDFName.of('Rect'))),
      ...numberArray(pdf, dict.get(PDFName.of('L'))),
    ];
    assert.ok(values.every(Number.isFinite));
    for (let index = 0; index < values.length; index += 2) {
      assert.ok(values[index] >= 0 && values[index] <= PAGE_WIDTH);
      assert.ok(values[index + 1] >= 0 && values[index + 1] <= PAGE_HEIGHT);
    }
  }
});

test('print-fidelity E2E round-trip state exports no non-finite, outside-page, or zero-length annotation geometry', async () => {
  const source = new Uint8Array(await readFile(fidelityPdfUrl));
  const manifest = JSON.parse(await readFile(fidelityManifestUrl, 'utf8'));
  const pageSizes = Object.fromEntries(manifest.pages.map((page) => [page.page, page.cropBox
    ? { width: page.cropBox[2] - page.cropBox[0], height: page.cropBox[3] - page.cropBox[1] }
    : page.rotation === 90 || page.rotation === 270
      ? { width: page.height, height: page.width }
      : { width: page.width, height: page.height }]));
  const output = await savePDFWithAnnotationsPdfLib(fileFromBytes(source, manifest.pdfFile),
    manifest.annotationsByPage, pageSizes, null, {
      returnBytes: true,
      callouts: manifest.callouts,
      surveyMarkers: manifest.surveyMarkers,
      activeModuleId: 'kal436-module',
      spaces: manifest.spaces,
    });
  const pdf = await PDFDocument.load(output);
  for (const [pageIndex, page] of pdf.getPages().entries()) {
    const crop = page.getCropBox();
    const minX = crop.x; const minY = crop.y;
    const maxX = crop.x + crop.width; const maxY = crop.y + crop.height;
    const assertPairs = (values, label) => {
      assert.ok(values.every(Number.isFinite), `${label} must be finite`);
      for (let index = 0; index < values.length; index += 2) {
        assert.ok(values[index] >= minX && values[index] <= maxX, `${label} x ${values[index]} must be on page`);
        assert.ok(values[index + 1] >= minY && values[index + 1] <= maxY, `${label} y ${values[index + 1]} must be on page`);
      }
    };
    for (const [annotIndex, dict] of pageAnnotationDicts(pdf, pageIndex).entries()) {
      for (const key of ['Rect', 'L', 'QuadPoints', 'Vertices', 'CL']) {
        const raw = dict.get(PDFName.of(key));
        if (raw !== undefined) assertPairs(numberArray(pdf, raw), `page ${pageIndex + 1} annot ${annotIndex} /${key}`);
      }
      const line = numberArray(pdf, dict.get(PDFName.of('L')));
      if (line.length === 4) assert.ok(Math.hypot(line[2] - line[0], line[3] - line[1]) > 0.01);
      const inkListRaw = dict.get(PDFName.of('InkList'));
      const inkList = inkListRaw ? pdf.context.lookup(inkListRaw, PDFArray) : null;
      for (const stroke of inkList?.asArray?.() || []) {
        assertPairs(numberArray(pdf, stroke), `page ${pageIndex + 1} annot ${annotIndex} /InkList`);
      }
    }
  }
});

test('pending redaction keeps split QuadPoints, outlines each quad, strips text, and reports one count', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const quads = [20, 150, 75, 150, 20, 135, 75, 135, 110, 150, 165, 150, 110, 135, 165, 135];
  const redact = source.context.register(source.context.obj({
    Type: 'Annot', Subtype: 'Redact', Rect: [20, 135, 165, 150], QuadPoints: quads,
    Contents: PDFString.of('replacement text'), OverlayText: PDFString.of('secret'), P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), source.context.obj([redact]));
  const notices = [];
  const output = await savePDFWithAnnotationsPdfLib(fileFromBytes(await source.save()), {}, PAGE_SIZES, null, {
    returnBytes: true,
    onRedactionsSanitized: (count) => notices.push(count),
  });

  const pdf = await PDFDocument.load(output);
  const [dict] = pageAnnotationDicts(pdf);
  assert.deepEqual(numberArray(pdf, dict.get(PDFName.of('QuadPoints'))), quads);
  assert.equal(dict.get(PDFName.of('Contents')), undefined);
  assert.equal(dict.get(PDFName.of('OverlayText')), undefined);
  assert.deepEqual(notices, [1]);
  assert.equal((decodedNormalAppearance(pdf, dict).match(/h S/g) || []).length, 2,
    'the hollow appearance must trace the two marked runs, not their bounding rectangle');
});

test('export writes managed annotations in app draw order around a native mark', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const native = source.context.register(source.context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [40, 80, 130, 140], NM: PDFString.of('native-front'),
    Border: [0, 0, 3], P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), source.context.obj([native]));
  const output = await savePDFWithAnnotationsPdfLib(fileFromBytes(await source.save()), {
    1: { objects: [
      { id: 'new-behind', type: 'rect', left: 30, top: 30, width: 110, height: 70, stroke: '#0000ff' },
      { id: 'native-front', type: 'rect', left: 40, top: 40, width: 90, height: 60, stroke: '#ff0000',
        isPdfImported: true, pdfAnnotationId: `${native.objectNumber}R`, pdfAnnotationType: 'Square' },
    ] },
  }, PAGE_SIZES, null, { returnBytes: true });

  const pdf = await PDFDocument.load(output);
  assert.deepEqual(pageAnnotationDicts(pdf).map((dict) => textValue(dict, 'NM')), ['new-behind', 'native-front']);
});

test('print flattens textbox fill, border, wrapped lines, and Fabric line height', async () => {
  const output = await savePDFWithFlattenedRegularAnnotationsForPrint(await blankFile(), {
    1: { objects: [{
      id: 'three-lines', type: 'textbox', left: 20, top: 20, width: 92, height: 72,
      text: 'FIRST WRAPPED LINE SECOND WRAPPED LINE THIRD', fontFamily: 'Helvetica', fontSize: 12,
      lineHeight: 1, fill: '#111111', backgroundColor: '#fff0aa', stroke: '#2255cc', strokeWidth: 2,
    }] },
  }, PAGE_SIZES, { returnBytes: true });
  const pdf = await PDFDocument.load(output);
  const content = decodedPageContent(pdf);
  assert.match(content, /h\s+B\b/, 'textbox background and border must be painted');
  const textMatrices = [...content.matchAll(/1 0 0 1 [-.\d]+ ([-.\d]+) Tm/g)].map((match) => Number(match[1]));
  assert.ok(textMatrices.length >= 3, `wrapped textbox must paint at least three lines, got ${textMatrices.length}`);
  const steps = textMatrices.slice(1).map((value, index) => Math.abs(value - textMatrices[index]));
  assert.ok(steps.every((step) => Math.abs(step - 12 * 1.13) < 0.05), `line steps must match Fabric: ${steps}`);
});

test('counter number fallback paints in print content and exported appearance', async () => {
  const counter = {
    id: 'counter-number-fallback', type: 'circle', left: 80, top: 60, radius: 18, fill: '#ef4444',
    data: { id: 'counter-number-fallback', type: 'counter', number: 7, numberColor: '#ffffff', pointerAngle: 225 },
  };
  const printed = await savePDFWithFlattenedRegularAnnotationsForPrint(await blankFile(), {
    1: { objects: [counter] },
  }, PAGE_SIZES, { returnBytes: true });
  assert.match(decodedPageContent(await PDFDocument.load(printed)), /<37> Tj/);

  const exported = await savePDFWithAnnotationsPdfLib(await blankFile(), {
    1: { objects: [counter] },
  }, PAGE_SIZES, null, { returnBytes: true });
  const pdf = await PDFDocument.load(exported);
  const [dict] = pageAnnotationDicts(pdf);
  assert.equal(textValue(dict, 'Contents'), '7');
  assert.match(decodedNormalAppearance(pdf, dict), /\(7\) Tj/);
});

test('the export action owns the single sanitized-redaction notice copy', async () => {
  const viewer = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /onRedactionsSanitized: \(count\) => \{ redactionsSanitizedForExport = count; \}/);
  assert.match(viewer, /redaction marks were exported as outlines without their replacement text/);
});
