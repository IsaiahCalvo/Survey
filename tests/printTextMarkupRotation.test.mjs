import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { init } from '@embedpdf/pdfium';
import { PdfEngine, PdfiumNative } from '@embedpdf/engines/pdfium';

import { savePDFWithFlattenedRegularAnnotationsForPrint } from '../src/utils/pdfAnnotationsPdfLib.js';

const FIXTURE_URL = new URL('../debug/fixtures/text-selection-rotation-matrix.pdf', import.meta.url);

const toArrayBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

async function createNodePdfiumEngine() {
  const wasmBytes = readFileSync(fileURLToPath(import.meta.resolve('@embedpdf/pdfium/pdfium.wasm')));
  const module = await init({ wasmBinary: toArrayBuffer(wasmBytes) });
  const native = new PdfiumNative(module, { fontFallback: null });
  return new PdfEngine(native, {
    imageConverter: async () => { throw new Error('Raw page rendering must not encode an image.'); },
  });
}

const textPatternForPage = (pageNumber) => {
  if (pageNumber <= 4) return /Selectable line one/;
  if (pageNumber === 5) return /שלום/;
  if (pageNumber === 6) return /Left column line one/;
  return /Rotated cropped selectable/;
};

const textItemViewportBounds = (page, viewport, item) => {
  const x = Number(item.transform[4]);
  const y = Number(item.transform[5]);
  const width = Number(item.width);
  const height = Number(item.height);
  const points = [
    viewport.convertToViewportPoint(x, y),
    viewport.convertToViewportPoint(x + width, y),
    viewport.convertToViewportPoint(x, y + height),
    viewport.convertToViewportPoint(x + width, y + height),
  ];
  const xs = points.map(([pointX]) => pointX);
  const ys = points.map(([, pointY]) => pointY);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
};

const quadFromBounds = ({ left, top, right, bottom }) => ({
  x1: left, y1: top,
  x2: right, y2: top,
  x3: left, y3: bottom,
  x4: right, y4: bottom,
});

const findMarkupBounds = ({ data, width, height }) => {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (data[index] < 220 || data[index + 1] > 35 || data[index + 2] < 220) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right >= left && bottom >= top ? { left, top, right: right + 1, bottom: bottom + 1 } : null;
};

const assertBoundsNear = (actual, expected, pageNumber) => {
  assert.ok(actual, `page ${pageNumber} must contain the flattened highlight`);
  for (const edge of ['left', 'top', 'right', 'bottom']) {
    assert.ok(
      Math.abs(actual[edge] - expected[edge]) <= 2,
      `page ${pageNumber} ${edge}: expected ${expected[edge]}, got ${actual[edge]}`,
    );
  }
};

test('print flatten keeps text markup on its selected text across page rotation and CropBox offsets', async () => {
  const sourceBytes = new Uint8Array(readFileSync(FIXTURE_URL));
  const sourceTask = pdfjsLib.getDocument({ data: sourceBytes.slice(), useSystemFonts: false });
  const source = await sourceTask.promise;
  const annotationsByPage = {};
  const pageSizes = {};
  const expectedByPage = {};

  try {
    for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber += 1) {
      const page = await source.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const text = await page.getTextContent();
      const item = text.items.find(({ str }) => textPatternForPage(pageNumber).test(str));
      assert.ok(item, `page ${pageNumber} fixture target text must exist`);
      const bounds = textItemViewportBounds(page, viewport, item);
      expectedByPage[pageNumber] = bounds;
      pageSizes[pageNumber] = { width: viewport.width, height: viewport.height };
      annotationsByPage[pageNumber] = {
        objects: [{
          id: `rotation-highlight-${pageNumber}`,
          type: 'group',
          fill: '#ff00ff',
          opacity: 1,
          data: {
            type: 'text-markup',
            markupType: 'highlight',
            overlapMode: 'layered',
            quads: [quadFromBounds(bounds)],
          },
        }],
      };
    }
  } finally {
    await sourceTask.destroy();
  }

  const flattenedBytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    {
      name: 'text-selection-rotation-matrix.pdf',
      async arrayBuffer() { return toArrayBuffer(sourceBytes); },
    },
    annotationsByPage,
    pageSizes,
    { actionType: 'test-print-text-markup-rotation' },
  );

  const engine = await createNodePdfiumEngine();
  let output = null;
  try {
    output = await engine.openDocumentBuffer({
      id: 'print-text-markup-rotation-output',
      content: toArrayBuffer(flattenedBytes),
    }, { normalizeRotation: false }).toPromise();
    for (let pageNumber = 1; pageNumber <= output.pages.length; pageNumber += 1) {
      const image = await engine.renderPageRaw(output, output.pages[pageNumber - 1], { scaleFactor: 1 }).toPromise();
      assertBoundsNear(
        findMarkupBounds(image),
        expectedByPage[pageNumber],
        pageNumber,
      );
    }
  } finally {
    if (output) await engine.closeDocument(output).toPromise();
    await engine.destroy();
  }
});
