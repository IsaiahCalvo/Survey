// A callout whose text is NOT WinAnsi (export round 7 integration, 2026-09-10).
//
// THE BLIND SPOT THIS PINS. Two round-7 lanes met in this file: one gave every
// callout part an /AP built from the print's own draw, the other taught the
// text drawer to embed a Unicode fallback for glyphs the standard 14 cannot
// encode. They meet at `exportHasTextAnnotation` -> `collectDrawnTextSamples`:
// the /Annots exporter only embeds fallback fonts for strings it can SEE ahead
// of drawing, and a callout's text lives on the export object, not on a fabric
// textbox.
//
// If that collection ever stops reaching a callout's text, the failure is
// silent in the obvious way: BOTH the appearance stream and the flattened
// print lose the same glyphs, so an annotated-vs-print comparison still
// matches perfectly - two identically empty boxes. So this test judges each
// export against a BLANK-TEXT callout of the same geometry instead: the leader,
// the arrowhead and the box are the baseline, and the glyphs have to be ink on
// top of it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFArray } from 'pdf-lib';
import { PNG } from 'pngjs';

import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';

const SCALE = 3;
const APP = { width: 420, height: 320 };
const tmp = mkdtempSync(join(tmpdir(), 'callout-unicode-ap-'));
const hasPoppler = spawnSync('which', ['pdftoppm'], { encoding: 'utf8' }).status === 0;

const frameFile = async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([APP.width, APP.height]);
  page.setMediaBox(0, 0, APP.width, APP.height);
  page.setCropBox(0, 0, APP.width, APP.height);
  const bytes = await source.save();
  return {
    name: 'frame.pdf',
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

const quiet = async (fn) => {
  const { log, warn, error } = console;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; console.error = error; }
};

const calloutWith = (text) => ({
  id: 'callout-unicode',
  pageNumber: 1,
  arrowTip: { x: 0.74, y: 0.26 },
  knee: { x: 0.54, y: 0.5 },
  textBoxPosition: { x: 0.08, y: 0.4 },
  textBoxWidth: 0.4,
  textBoxHeight: 0.22,
  text,
  style: {
    borderColor: '#c42747',
    fontColor: '#111111',
    backgroundColor: '#ffffff',
    fontSize: 12,
    lineThickness: 2,
  },
});

const exportAnnotated = async (callouts) => quiet(() => withWindow(async () => (
  savePDFWithAnnotationsPdfLib(
    await frameFile(), { 1: { objects: [] } }, { 1: APP }, null,
    {
      returnBytes: true, actionType: 'pdf-export', documentId: 'callout-unicode', callouts,
    },
  )
)));

const printFlattened = async (callouts) => quiet(() => withWindow(async () => (
  savePDFWithFlattenedRegularAnnotationsForPrint(
    await frameFile(), { 1: { objects: [] } }, { 1: APP },
    {
      returnBytes: true, actionType: 'pdf-print', documentId: 'callout-unicode', callouts,
    },
  )
)));

const inkPixels = (bytes, label) => {
  const pdfPath = join(tmp, `${label}.pdf`);
  writeFileSync(pdfPath, bytes);
  const result = spawnSync(
    'pdftoppm',
    ['-r', String(72 * SCALE), '-cropbox', '-png', '-singlefile', pdfPath, join(tmp, label)],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const png = PNG.sync.read(readFileSync(join(tmp, `${label}.png`)));
  let count = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    const alpha = png.data[index + 3] / 255;
    const channel = (offset) => png.data[index + offset] * alpha + 255 * (1 - alpha);
    if (255 - Math.min(channel(0), channel(1), channel(2)) >= 40) count += 1;
  }
  return count;
};

const CASES = [
  // Latin stays on Helvetica - the control, so a failure below is about the
  // Unicode lane and not about callout appearances in general.
  { label: 'latin', text: 'Check this detail' },
  // CJK: DroidSansFallback territory.
  { label: 'cjk', text: '確認してください 检查此处' },
  // Emoji: NotoEmoji territory (monochrome outlines, so they read as ink).
  { label: 'emoji', text: 'Look 🔥 here 🚀' },
];

test('a callout carries three appearance-bearing parts whatever script its text is in', async () => {
  for (const { label, text } of CASES) {
    const bytes = await exportAnnotated([calloutWith(text)]);
    const doc = await PDFDocument.load(bytes);
    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
    assert.ok(annots instanceof PDFArray, `${label}: page carries /Annots`);
    assert.equal(annots.size(), 3, `${label}: leader, arrow and text box`);
    for (const ref of annots.asArray()) {
      const dict = doc.context.lookup(ref);
      const ap = doc.context.lookup(dict.get(PDFName.of('AP')));
      assert.ok(ap, `${label}: every callout part has an /AP`);
    }
  }
});

test('non-WinAnsi callout text is drawn, not silently dropped', { skip: hasPoppler ? false : 'pdftoppm not installed' }, async () => {
  // Same callout with no text at all: leader + arrowhead + empty box.
  const blankPrintInk = inkPixels(await printFlattened([calloutWith('')]), 'callout-blank');

  for (const { label, text } of CASES) {
    const annotatedInk = inkPixels(await exportAnnotated([calloutWith(text)]), `callout-annotated-${label}`);
    const printInk = inkPixels(await printFlattened([calloutWith(text)]), `callout-print-${label}`);

    // The glyphs are ink the empty callout does not have. A missing Unicode
    // fallback shows up here as ~0 on both sides.
    assert.ok(
      printInk - blankPrintInk > 400,
      `${label}: printed callout text draws glyphs (print ${printInk} vs blank ${blankPrintInk})`,
    );
    assert.ok(
      annotatedInk - blankPrintInk > 400,
      `${label}: the exported /AP draws the same glyphs (annotated ${annotatedInk} vs blank ${blankPrintInk})`,
    );
    // And the two surfaces stay the same picture, as round 7 requires.
    assert.ok(
      Math.abs(annotatedInk - printInk) <= Math.max(8, printInk * 0.01),
      `${label}: /AP and print agree (annotated ${annotatedInk}, print ${printInk})`,
    );
  }
});
