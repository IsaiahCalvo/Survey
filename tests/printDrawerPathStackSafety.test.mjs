// The flattened-print drawer must draw a path of ANY length (2026-09-10,
// export round 6).
//
// Adversarial verification of claude/cloud-export-round5 found the second half
// of that branch's stack-overflow defect still live. Round 5 made the GEOMETRY
// helpers linear (getCloudPathBounds and friends, src/utils/arrayExtrema.js),
// but the drawer still handed the whole operator list to pdf-lib in one call,
// and pdf-lib appends operators as `contentStream.push(...operators)` - one
// ARGUMENT per operator - inside BOTH PDFPage#pushOperators and
// PDFPage#drawSvgPath. Past roughly 125,000 arguments V8 throws
// `RangeError: Maximum call stack size exceeded`.
//
// Measured on the base branch with a plain fabric 'path' object on Letter:
//
//    50,000 commands -> drawn
//    80,000 commands -> RangeError: Maximum call stack size exceeded
//   120,000 commands -> RangeError
//   200,000 commands -> RangeError
//
// Round 5's per-annotation fence (flattenPrintSkips) then SWALLOWED the throw:
// the sheet printed without that stroke, with a console diagnostic, while the
// /Annots export - which never went near the drawer - still wrote it. A hard
// failure had become silent data loss, and print and export disagreed about
// what was on the page.
//
// Both drawer lanes are covered: the stroked lane (page.drawSvgPath) and the
// filled-outline lane (drawFilledOutlineInk, which pushed its own operator
// list), because a pen stroke and an eraser-carved ink region take different
// routes through the drawer.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';

import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';

const PAGE = { width: 612, height: 792 };

const blankFile = async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE.width, PAGE.height]);
  page.setMediaBox(0, 0, PAGE.width, PAGE.height);
  page.setCropBox(0, 0, PAGE.width, PAGE.height);
  const bytes = await source.save();
  return {
    name: 'stack-path.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
};

const withWindow = async (fn) => {
  const original = globalThis.window;
  globalThis.window = {};
  try { return await fn(); } finally { globalThis.window = original; }
};

/**
 * Run the writers with the console captured. The flattener reports an
 * annotation it could not draw ONLY through a diagnostic, so the captured
 * warnings are how this test sees a swallowed throw.
 */
const captureConsole = async (fn) => {
  const { log, warn, error } = console;
  const lines = [];
  const record = (...args) => lines.push(args
    .map((value) => (typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)))
    .join(' '));
  console.log = () => {}; console.warn = record; console.error = record;
  try { return { value: await fn(), lines }; } finally { console.log = log; console.warn = warn; console.error = error; }
};

const printFlattened = (objects) => captureConsole(() => withWindow(() => (
  savePDFWithFlattenedRegularAnnotationsForPrint(
    blankFileHandle(), { 1: { objects } }, { 1: PAGE },
    { returnBytes: true, actionType: 'pdf-print', documentId: 'stack-path' },
  )
)));

const exportAnnotated = (objects) => captureConsole(() => withWindow(() => (
  savePDFWithAnnotationsPdfLib(
    blankFileHandle(), { 1: { objects } }, { 1: PAGE }, null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'stack-path' },
  )
)));

// The writers only ever read the source through `pdfFile.arrayBuffer()`, and
// that handler hands back a fresh copy of the bytes every time, so one blank
// page serves every case without leaking state between them.
let sourceFile = null;
const blankFileHandle = () => sourceFile;

const pageContentText = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.context.lookup(doc.getPage(0).node.get(PDFName.of('Contents')));
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((ref) => doc.context.lookup(ref))
    : [contents];
  return streams
    .filter((stream) => stream instanceof PDFRawStream)
    .map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()))
    .join('\n');
};

const annotCount = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  return annots instanceof PDFArray ? annots.size() : 0;
};

/** A polyline that stays on the page, with `commandCount` path commands. */
const longPath = (id, commandCount, extra = {}) => {
  const path = [['M', 20, 20]];
  for (let index = 1; index < commandCount; index += 1) {
    path.push(['L', 20 + (index % 560), 20 + ((index * 7) % 740)]);
  }
  return {
    id,
    type: 'path',
    path,
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    stroke: '#c42747',
    strokeWidth: 2,
    fill: null,
    ...extra,
  };
};

const drawFailures = (lines) => lines.filter((line) => line.includes('flatten-draw-failed'));

// One `l` operator per drawn line-to. Counting them proves the whole command
// list reached the page, not just the first chunk of it.
const lineToCount = (contentText) => (contentText.match(/^-?[\d.]+ -?[\d.]+ l$/gm) || []).length;

test.before(async () => { sourceFile = await blankFile(); });

for (const commandCount of [50_000, 80_000, 120_000, 200_000]) {
  test(`the flattened print draws a ${commandCount.toLocaleString('en-US')}-command stroked path`, async () => {
    const object = longPath(`stroked-${commandCount}`, commandCount);
    const { value: printed, lines } = await printFlattened([object]);

    assert.deepEqual(
      drawFailures(lines), [],
      `a ${commandCount}-command path must not be skipped by the print drawer`,
    );
    const content = await pageContentText(printed);
    const drawn = lineToCount(content);
    assert.equal(
      drawn, commandCount - 1,
      `every line-to must reach the page (got ${drawn} of ${commandCount - 1})`,
    );
    assert.match(content, /^S$/m, 'the stroked lane paints the path with a stroke');

    // ...and the /Annots export must agree that the shape exists, which is the
    // disagreement the swallowed throw created.
    const { value: exported } = await exportAnnotated([object]);
    assert.equal(await annotCount(exported), 1, 'the same path is in the annotated export');
  });
}

test('the flattened print draws a 200,000-command filled-outline ink path', async () => {
  // Filled outline ink (a native pen stroke, or ink an eraser has carved) is
  // painted as a fill with no stroke and goes through drawFilledOutlineInk,
  // which pushed its own operator list in one call.
  const object = longPath('filled-200000', 200_000, {
    stroke: null,
    strokeWidth: 0,
    fill: '#c42747',
    data: { pdfInkRenderMode: 'filled-outline' },
  });
  const { value: printed, lines } = await printFlattened([object]);

  assert.deepEqual(
    drawFailures(lines), [],
    'a 200,000-command filled ink path must not be skipped by the print drawer',
  );
  const content = await pageContentText(printed);
  const drawn = lineToCount(content);
  assert.equal(drawn, 199_999, `every line-to must reach the page (got ${drawn} of 199999)`);
  // Proves it took the filled-outline lane and not the stroked one: this ink
  // is painted as a fill region with no stroke, exactly as the screen shows it.
  assert.match(content, /^f\*?$/m, 'the filled-outline lane paints the ink with a fill');
  assert.doesNotMatch(content, /^S$/m, 'filled-outline ink is never stroked');
});
