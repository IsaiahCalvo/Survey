// Independent hunt after Arrow flatten Arrowhead style (aa0b87ef).
// No unique LIVE leftover proved. Style Dotted already rides the same
// /AP writers as Dashed. Native Line has no /AP. Font chrome is
// edit-only. Known-fixed decode already survives. Do not invent a
// leftover. Do not invent Line /AP, callout Rotation, user-settable
// callout verticalAlign, or a richTextEditor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFString, decodePDFRawStream } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import {
  buildBoundaryShapeCommitJSON,
  buildLineCommitJSON,
} from '../src/utils/annotationCreationCommit.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'after-arrow-head-flatten-hunt-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function lookupDict(doc, value) {
  if (!value) return null;
  if (typeof value.lookup === 'function' || typeof value.get === 'function') return value;
  return doc.context.lookup(value) || null;
}

function readApStream(doc, dict) {
  const ap = lookupDict(doc, dict.get(PDFName.of('AP')));
  if (!ap) return '';
  const nRef = ap.get(PDFName.of('N'));
  const normal = lookupDict(doc, nRef);
  if (!normal) return '';
  return new TextDecoder('latin1').decode(decodePDFRawStream(normal).decode());
}

function readBs(doc, dict) {
  return dict.get(PDFName.of('BS')) != null;
}

async function exportObjects(objects) {
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'after-arrow-head-flatten-hunt' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  return annots.asArray().map((ref) => {
    const dict = doc.context.lookup(ref);
    const subtype = dict.get(PDFName.of('Subtype'));
    return {
      dict,
      doc,
      subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
      ap: dict.get(PDFName.of('AP')) != null,
      bs: readBs(doc, dict),
      apText: readApStream(doc, dict),
      contents: (() => {
        try {
          const raw = dict.get(PDFName.of('Contents'));
          if (!raw) return '';
          if (typeof raw.decodeText === 'function') return raw.decodeText();
          return String(raw);
        } catch {
          return '';
        }
      })(),
    };
  });
}

test('Style Dotted already writes Ellipse /AP [2 4] 0 d — not a leftover', async () => {
  const ellipse = buildBoundaryShapeCommitJSON({
    tool: 'ellipse',
    id: 'hunt-dotted-ellipse',
    start: { x: 20, y: 30 },
    end: { x: 100, y: 90 },
    strokeColor: '#FF0000',
    strokeOpacity: 100,
    fillColor: '#00FF00',
    fillOpacity: 0,
    strokeWidth: 2,
    lineBorderStyle: 'dotted',
  });
  assert.deepEqual(ellipse.strokeDashArray, [2, 4]);
  const rows = await exportObjects([{ ...ellipse, type: String(ellipse.type || 'ellipse').toLowerCase() }]);
  const circle = rows.find((row) => /Circle/i.test(row.subtype));
  assert.ok(circle, `export must write Circle (got ${rows.map((row) => row.subtype).join(',')})`);
  assert.equal(circle.ap, true);
  assert.match(circle.apText, /\[2 4\] 0 d/, `dotted /AP must set [2 4] (got ${circle.apText.slice(0, 240)})`);
  assert.equal(circle.bs, false, 'do not invent Square/Circle /BS');
});

test('plain Line export stays headless and has no /AP — not a leftover', async () => {
  const line = buildLineCommitJSON({
    tool: 'line',
    id: 'hunt-plain-line',
    start: { x: 20, y: 40 },
    end: { x: 120, y: 80 },
    strokeColor: '#FF0000',
    strokeOpacity: 100,
    strokeWidth: 2,
    lineBorderStyle: 'dotted',
  });
  assert.equal(line.data?.arrowheadStyle, undefined);
  assert.deepEqual(line.strokeDashArray, [2, 4]);
  const rows = await exportObjects([{ ...line, type: 'line' }]);
  const native = rows.find((row) => /Line/i.test(row.subtype));
  assert.ok(native, `export must write Line (got ${rows.map((row) => row.subtype).join(',')})`);
  assert.equal(native.ap, false, 'native Line has no /AP — do not invent');
  assert.equal(native.bs, true, 'Line dash rides native /BS');
});

test('known-fixed PDF decode still survives Survey-to-Survey load', async () => {
  const texts = ['Hi\rthere', 'unpaired\\slash', '#hash', 'café', 'a) Hi', 'Hi 😀'];
  for (const text of texts) {
    const box = {
      id: `hunt-decode-${text.length}`,
      type: 'textbox',
      left: 20,
      top: 30,
      width: 120,
      height: 40,
      text,
      fill: '#000000',
      fontSize: 14,
      fontFamily: 'Helvetica',
      backgroundColor: 'rgba(255, 255, 0, 0.4)',
      data: { id: `hunt-decode-${text.length}`, type: 'textbox', tool: 'text' },
    };
    const rows = await exportObjects([box]);
    const free = rows.find((row) => /FreeText/i.test(row.subtype));
    assert.ok(free, `export must write FreeText for ${JSON.stringify(text)}`);
    assert.equal(free.contents, text, `Contents must keep ${JSON.stringify(text)}`);
  }
});

test('PDFString.decodeText still treats JSON tab as an escape — hex fallback already covers it', () => {
  const literal = PDFString.of('{"text":"Hi\\tGo"}');
  assert.notEqual(literal.decodeText(), '{"text":"Hi\\tGo"}');
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /decodeText\(\) === text\) return literal/);
  assert.match(writer, /PDFHexString\.fromText\(text\)/);
});

test('Arrow flatten already consumes buildArrowheadRenderSpec; Font chrome stays edit-only', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /buildArrowheadRenderSpec/);
  assert.match(writer, /resolveFlattenedArrowheadStyle/);
  assert.doesNotMatch(writer, /function drawArrowHead\s*\(/);
  assert.match(writer, /Native Line has no \/AP|native Line has no \/AP|Do not invent Line \/AP/i);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /if \(!bottomToolbarApi\?\.richTextEditor\)/);
  assert.match(shell, /setShowFontFamilyMenu\(false\)/);

  const prefs = read('src/hooks/useDatabase.js');
  assert.match(prefs, /arrow: \{[^}]*arrowheadStyle: 'solidTriangle'/);
  assert.match(prefs, /callout: \{[^}]*arrowheadStyle: 'solidTriangle'/);
  assert.match(prefs, /text: \{[^}]*lineBorderStyle: 'solid'/);

  const spec = read('debug/scenarios/e2e-after-arrow-head-flatten-independent-hunt.spec.mjs');
  assert.match(spec, /AFTER_ARROW_HEAD_FLATTEN_INDEPENDENT_HUNT/);
  assert.match(spec, /Style Dotted/);
  assert.match(spec, /fileId/);
  assert.match(spec, /viewBox/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('isolated 8448 / 75/250 still standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
  assert.match(leftover, /X-01 \/ X-05 persist/);
  assert.match(leftover, /A-01 \/ UL-15/);
  assert.match(leftover, /A-03 \/ UL-24/);
});
