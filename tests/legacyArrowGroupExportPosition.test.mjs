// Wave 8 sibling: legacyArrowGroupToLine folds group left/top into x1..y2.
// createLineAnnotation now uses getLineEndpoints (left+width/2 + x1). If the
// mapper keeps the group bbox, /L is double-offset. Strip left/top/width/height
// so world x1..y2 stay a no-op through getLineEndpoints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import {
  buildPdfExportAnnotationPlan,
  savePDFWithAnnotationsPdfLib,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { getLineEndpoints } from '../src/utils/svgBoundingBox.js';

const PAGE = 200;
const PAGE_SIZES = { 1: { width: PAGE, height: PAGE } };

const LEGACY_ARROW_GROUP = {
  id: 'legacy-arrow-1',
  type: 'group',
  left: 20,
  top: 30,
  stroke: '#ff0000',
  strokeWidth: 3,
  objects: [
    { type: 'line', x1: 0, y1: 0, x2: 50, y2: 40, stroke: '#ff0000', strokeWidth: 3 },
    { type: 'triangle', name: 'arrowHead', left: 45, top: 35, width: 10, height: 10 },
  ],
};

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE, PAGE]);
  const bytes = await doc.save();
  return {
    name: 'source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function numberArray(dict, key) {
  const value = dict.get(PDFName.of(key));
  return value ? value.asArray().map((n) => n.asNumber()) : null;
}

test('intended: legacy arrow group export /L is world (20,30)→(70,70), not left+x1 twice', async () => {
  const bytes = await savePDFWithAnnotationsPdfLib(await makePdfFile(), {
    1: { objects: [LEGACY_ARROW_GROUP] },
  }, PAGE_SIZES, null, { returnBytes: true });

  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  const line = doc.context.lookup(annots.asArray()[0]);
  assert.equal(line.get(PDFName.of('Subtype')).decodeText(), 'Line');
  assert.deepEqual(numberArray(line, 'L'), [20, PAGE - 30, 70, PAGE - 70]);
});

test('break: mapped bbox is zero so getLineEndpoints does not add group left again', () => {
  const plan = buildPdfExportAnnotationPlan({
    annotationsByPage: { 1: { objects: [LEGACY_ARROW_GROUP] } },
    pageSizes: PAGE_SIZES,
  });
  const mapped = plan.items[0].object;
  assert.equal(mapped.left, 0);
  assert.equal(mapped.top, 0);
  assert.equal(mapped.width, 0);
  assert.equal(mapped.height, 0);
  assert.deepEqual(getLineEndpoints(mapped), { x1: 20, y1: 30, x2: 70, y2: 70 });
  const doubleOffset = getLineEndpoints({ ...mapped, left: 20, top: 30 });
  assert.deepEqual(doubleOffset, { x1: 40, y1: 60, x2: 90, y2: 100 });
  assert.notDeepEqual(getLineEndpoints(mapped), doubleOffset);
});

test('edge: group width/height on the source does not shift /L; callout-style world x1 stays put', async () => {
  const withBbox = {
    ...LEGACY_ARROW_GROUP,
    width: 80,
    height: 60,
  };
  const bytes = await savePDFWithAnnotationsPdfLib(await makePdfFile(), {
    1: { objects: [withBbox] },
  }, PAGE_SIZES, null, { returnBytes: true });
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  const line = doc.context.lookup(annots.asArray()[0]);
  assert.deepEqual(numberArray(line, 'L'), [20, PAGE - 30, 70, PAGE - 70]);

  // Callout leaders pass world x1..y2 with no left/width — mapper is not
  // involved; getLineEndpoints remains a no-op (Wave 8 contract).
  const leader = { type: 'line', x1: 12, y1: 18, x2: 40, y2: 22 };
  assert.deepEqual(getLineEndpoints(leader), { x1: 12, y1: 18, x2: 40, y2: 22 });
});
