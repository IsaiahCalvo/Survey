// Callout leader endpoints must bake the live box-edge attach.
// Live screen already routes line1 from the textbox EDGE nearest the
// knee (calculateCalloutConnection). Export / flatten hardcoded
// textBox.left + mid-height so Acrobat / print stayed attached to
// the leftover left-middle until the knee was re-touched. Metadata
// already keeps stored knee + box so reimport is not double-routed.
// Distinct from leftover-18, callout leader /BS (no /AP), callout
// box /AP dash, and Line / Arrow Rotation /L. Do not invent Line
// /AP or callout Rotation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { PDF_CALLOUT_METADATA_KEY } from '../src/utils/pdfCalloutMetadata.js';
import { calculateCalloutConnection } from '../src/utils/calloutGeometry.js';
import { defaultCalloutStyle } from '../src/components/Callout/types.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const PAGE = 200;
const PAGE_SIZES = { 1: { width: PAGE, height: PAGE } };

function makeCallout(patch = {}) {
  return {
    id: `callout-leader-endpoint-${patch.idSuffix || 'right'}`,
    pageNumber: 1,
    arrowTip: { x: 0.80, y: 0.36 },
    knee: { x: 0.60, y: 0.36 },
    textBoxPosition: { x: 0.20, y: 0.30 },
    textBoxWidth: 0.25,
    textBoxHeight: 0.12,
    text: 'Y',
    style: {
      ...defaultCalloutStyle,
      fillColor: '#FFFF00',
      fillOpacity: 0.4,
      borderColor: '#000000',
      lineThickness: 2,
    },
    ...patch,
  };
}

function worldBox(callout) {
  return {
    left: Number(callout.textBoxPosition.x) * PAGE,
    top: Number(callout.textBoxPosition.y) * PAGE,
    width: Number(callout.textBoxWidth) * PAGE,
    height: Number(callout.textBoxHeight) * PAGE,
    knee: {
      x: Number(callout.knee.x) * PAGE,
      y: Number(callout.knee.y) * PAGE,
    },
    tip: {
      x: Number(callout.arrowTip.x) * PAGE,
      y: Number(callout.arrowTip.y) * PAGE,
    },
  };
}

function leftoverLeftMid(box) {
  return { x: box.left, y: box.top + box.height / 2 };
}

function liveAttach(callout) {
  const box = worldBox(callout);
  return calculateCalloutConnection(
    box.left,
    box.top,
    box.width,
    box.height,
    box.knee,
    box.tip,
    0,
  );
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE, PAGE]);
  const bytes = await doc.save();
  return {
    name: 'callout-leader-endpoint-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

const dictText = (dict, key) => {
  const value = dict.get(PDFName.of(key));
  return value?.decodeText ? value.decodeText() : String(value || '');
};

function readL(dict) {
  const raw = dict.get(PDFName.of('L'));
  if (!raw || typeof raw.asArray !== 'function') return [];
  return raw.asArray().map((n) => (n?.asNumber ? n.asNumber() : Number(n)));
}

async function exportCallout(callout) {
  const pdfFile = await makePdfFile();
  const bytes = await savePDFWithAnnotationsPdfLib(pdfFile, {}, PAGE_SIZES, null, {
    returnBytes: true,
    callouts: [callout],
  });
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  const dicts = annots ? annots.asArray().map((ref) => doc.context.lookup(ref)) : [];
  return dicts.map((dict) => {
    const metaRaw = dictText(dict, PDF_CALLOUT_METADATA_KEY);
    let metadata = null;
    try { metadata = JSON.parse(metaRaw); } catch { metadata = null; }
    return {
      subtype: dictText(dict, 'Subtype'),
      part: metadata?.part || null,
      L: readL(dict),
      ap: dict.get(PDFName.of('AP')) != null,
      knee: metadata?.knee || null,
      textBoxPosition: metadata?.textBoxPosition || null,
    };
  });
}

async function flattenCallout(callout) {
  const pdfFile = await makePdfFile();
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(pdfFile, {}, PAGE_SIZES, {
    returnBytes: true,
    callouts: [callout],
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

function near(a, b, slack = 0.8) {
  return Math.abs(Number(a) - Number(b)) < slack;
}

test('knee right of the box: line1 /L starts on the right edge, not leftover left-middle', async () => {
  const callout = makeCallout({ idSuffix: 'right' });
  const box = worldBox(callout);
  const leftover = leftoverLeftMid(box);
  const live = liveAttach(callout);
  assert.ok(live.line1Start.x > leftover.x + 8, 'live attach must sit on the right edge');
  assert.ok(near(live.line1Start.x, box.left + box.width), 'live attach x is the right edge');

  const exported = await exportCallout(callout);
  const line1 = exported.find((row) => row.part === 'line1');
  assert.ok(line1, 'export must write line1');
  assert.equal(line1.ap, false, 'do not invent Line /AP');
  assert.ok(near(line1.L[0], live.line1Start.x), `line1 /L x1 ${line1.L[0]} must be live ${live.line1Start.x}`);
  assert.ok(near(line1.L[1], PAGE - live.line1Start.y), `line1 /L y1 ${line1.L[1]} must be live PDF y`);
  assert.ok(!near(line1.L[0], leftover.x), `line1 /L must not stay leftover left ${leftover.x}`);
  assert.ok(near(line1.knee.x, callout.knee.x), 'metadata must keep leftover knee x');
  assert.ok(near(line1.textBoxPosition.x, callout.textBoxPosition.x), 'metadata must keep leftover box x');
});

test('knee left of the box: line1 /L uses leftover left edge at the knee y, not leftover mid-height', async () => {
  const callout = makeCallout({
    idSuffix: 'left',
    arrowTip: { x: 0.10, y: 0.10 },
    knee: { x: 0.20, y: 0.20 },
    textBoxPosition: { x: 0.30, y: 0.20 },
    textBoxWidth: 0.30,
    textBoxHeight: 0.12,
  });
  const box = worldBox(callout);
  const leftover = leftoverLeftMid(box);
  const live = liveAttach(callout);
  assert.ok(near(live.line1Start.x, box.left), 'left-of-box attach stays on the left edge');
  assert.ok(!near(live.line1Start.y, leftover.y), 'live y is not leftover mid-height');

  const exported = await exportCallout(callout);
  const line1 = exported.find((row) => row.part === 'line1');
  assert.ok(line1, 'export must write line1');
  assert.ok(near(line1.L[0], live.line1Start.x));
  assert.ok(near(line1.L[1], PAGE - live.line1Start.y));
  assert.ok(!near(line1.L[1], PAGE - leftover.y), 'line1 /L must not stay leftover mid-height');
});

test('flatten paints the live right-edge attach, not leftover left-middle', async () => {
  const callout = makeCallout({ idSuffix: 'flat-right' });
  const leftover = leftoverLeftMid(worldBox(callout));
  const live = liveAttach(callout);
  const stream = await flattenCallout(callout);
  const livePdfY = PAGE - live.line1Start.y;
  assert.match(stream, new RegExp(`${Math.round(live.line1Start.x)}`), `flatten must write live x ${live.line1Start.x}`);
  assert.match(stream, new RegExp(`${Math.round(livePdfY)}`), `flatten must write live PDF y ${livePdfY}`);
  const leftoverToken = `${leftover.x} ${PAGE - leftover.y}`;
  assert.doesNotMatch(stream, new RegExp(leftoverToken.replace('.', '\\.')), `flatten must not paint leftover ${leftoverToken}`);
});

test('export host still names the callout leader-edge /L contract; isolated 8448 / 75/250 standing', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /const resolveCalloutLeaderWorld = /);
  assert.match(writer, /calculateCalloutConnection\(/);
  assert.match(writer, /hardcoded textBox\.left \+ mid-height/);
  assert.match(writer, /connection\.line1Start\.x/);
  assert.match(writer, /Do not invent callout Rotation or Line \/AP/);
  const flatten = writer.slice(writer.indexOf('const drawFlattenedCallout'));
  assert.match(flatten.slice(0, 2200), /if \(!connection\.shouldHideLine1\)/);
  assert.match(flatten.slice(0, 2200), /connection\.line2Start\.x/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
