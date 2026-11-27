// Redact text must take the words out of the exported PDF, not just cover them.
// pdf.js text extraction can miss text it cannot place, so this test reads the
// file itself: every string operand in every content stream, joined in order so
// a word split across TJ pieces still counts, plus every string anywhere else in
// the file (annotation /Contents, popups, orphaned objects).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  decodePDFRawStream,
  PDFDocument,
  PDFRawStream,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { init } from '@embedpdf/pdfium';
import { PdfEngine, PdfiumNative } from '@embedpdf/engines/pdfium';
import { applyPermanentPdfRedactions } from '../src/utils/permanentPdfRedaction.js';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { createTextMarkupAnnotation } from '../src/utils/pdfTextMarkup.js';

const PAGE_SIZE = { width: 240, height: 200 };
const SECRET_WORDS = ['SECRET', 'ALPHA'];

const toArrayBuffer = (value) => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);

async function createNodePdfiumEngine() {
  const wasmBytes = readFileSync(fileURLToPath(import.meta.resolve('@embedpdf/pdfium/pdfium.wasm')));
  const module = await init({ wasmBinary: toArrayBuffer(wasmBytes) });
  const native = new PdfiumNative(module, { fontFallback: null });
  return new PdfEngine(native, {
    imageConverter: async () => {
      throw new Error('The redaction path must not rasterize pages.');
    },
  });
}

async function makeSourcePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([PAGE_SIZE.width, PAGE_SIZE.height]);
  page.drawText('TOP SECRET ALPHA', { x: 20, y: 150, size: 14, font, color: rgb(0, 0, 0) });
  page.drawText('KEEP ME SEARCHABLE', { x: 20, y: 105, size: 14, font, color: rgb(0, 0, 0) });
  const second = doc.addPage([PAGE_SIZE.width, PAGE_SIZE.height]);
  second.drawText('SECOND PAGE STAYS', { x: 20, y: 150, size: 14, font });
  return doc.save();
}

function makeRedaction() {
  return createTextMarkupAnnotation({
    id: 'strip-words-redaction',
    pageNumber: 1,
    selectionGroupId: 'strip-words-group',
    markupType: 'redact',
    selectedText: 'TOP SECRET ALPHA',
    quads: [{ x1: 18, y1: 34, x2: 158, y2: 34, x3: 18, y3: 55, x4: 158, y4: 55 }],
  });
}

// Pull the string operands out of a content stream, in order. Handles literal
// strings (escapes, nested parentheses) and hex strings; skips comments.
function contentStreamStrings(source) {
  const out = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '%') {
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i += 1;
    } else if (ch === '(') {
      let depth = 1;
      let text = '';
      i += 1;
      while (i < source.length && depth > 0) {
        const c = source[i];
        if (c === '\\') {
          const next = source[i + 1];
          if (/[0-7]/.test(next)) {
            const oct = /^[0-7]{1,3}/.exec(source.slice(i + 1))[0];
            text += String.fromCharCode(parseInt(oct, 8));
            i += 1 + oct.length;
            continue;
          }
          const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
          text += map[next] ?? next ?? '';
          i += 2;
          continue;
        }
        if (c === '(') depth += 1;
        if (c === ')') depth -= 1;
        if (depth > 0) text += c;
        i += 1;
      }
      out.push(text);
    } else if (ch === '<' && source[i + 1] !== '<') {
      const end = source.indexOf('>', i);
      const hex = source.slice(i + 1, end < 0 ? source.length : end).replace(/\s+/g, '');
      const padded = hex.length % 2 ? `${hex}0` : hex;
      let text = '';
      for (let k = 0; k < padded.length; k += 2) text += String.fromCharCode(parseInt(padded.slice(k, k + 2), 16));
      out.push(text);
      i = end < 0 ? source.length : end + 1;
    } else if (ch === '<') {
      i += 2;
    } else {
      i += 1;
    }
  }
  return out;
}

function decodedStreams(doc) {
  const streams = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    let bytes;
    try {
      bytes = decodePDFRawStream(object).decode();
    } catch {
      bytes = object.getContents();
    }
    streams.push({ dict: object.dict.toString(), text: new TextDecoder('latin1').decode(bytes) });
  }
  return streams;
}

const hexOf = (text) => [...text].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
const utf16HexOf = (text) => [...text].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('');

function stringFormsIn(haystack, word) {
  const lower = haystack.toLowerCase();
  return [word, hexOf(word), utf16HexOf(word)].filter((form) => lower.includes(form.toLowerCase()));
}

async function exportRedacted() {
  const sourceBytes = await makeSourcePdf();
  const redaction = makeRedaction();
  const annotationsByPage = { 1: { objects: [redaction] } };
  const annotatedBytes = await savePDFWithAnnotationsPdfLib(
    { name: 'strip-words.pdf', async arrayBuffer() { return toArrayBuffer(sourceBytes); } },
    annotationsByPage,
    { 1: PAGE_SIZE, 2: PAGE_SIZE },
    null,
    { returnBytes: true, actionType: 'pdf-apply-redactions-source', documentId: 'strip-words-test' },
  );
  const outputBytes = await applyPermanentPdfRedactions({
    annotatedPdfBytes: annotatedBytes,
    annotationsByPage,
    createEngine: createNodePdfiumEngine,
  });
  return { sourceBytes, annotatedBytes, outputBytes };
}

function joinedPageText(doc) {
  return decodedStreams(doc)
    .filter(({ dict }) => !/\/Subtype\s*\/Image/.test(dict) && !/\/Length1|\/Length2|\/Length3/.test(dict))
    .map(({ text }) => contentStreamStrings(text).join(''))
    .join('\n')
    .replace(/\s+/g, '');
}

test('the reader finds the words before redaction, so a miss afterwards means they are gone', async () => {
  const { sourceBytes } = await exportRedacted();
  const joined = joinedPageText(await PDFDocument.load(sourceBytes));
  for (const word of SECRET_WORDS) assert.ok(joined.includes(word), `source should hold ${word}`);
  assert.ok(joined.includes('KEEPMESEARCHABLE'));
});

test('Redact text strips the words from every content stream of the exported PDF', async () => {
  const { outputBytes } = await exportRedacted();
  const doc = await PDFDocument.load(outputBytes);
  const joined = joinedPageText(doc);
  for (const word of SECRET_WORDS) {
    assert.equal(joined.includes(word), false, `${word} must not survive in any content stream`);
  }
  assert.ok(joined.includes('KEEPMESEARCHABLE'), 'unredacted text on the same page stays in the file');
  assert.ok(joined.includes('SECONDPAGESTAYS'), 'the other page stays in the file');
});

test('Redact text leaves the words in no annotation, popup or orphaned object', async () => {
  const { outputBytes } = await exportRedacted();
  const doc = await PDFDocument.load(outputBytes);
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    const serialized = object instanceof PDFRawStream ? object.dict.toString() : object.toString();
    for (const word of SECRET_WORDS) {
      assert.deepEqual(stringFormsIn(serialized, word), [], `${word} found in object ${ref.toString()}`);
    }
  }
});

test('Redact text leaves nothing for a PDF reader to extract or search', async () => {
  const { outputBytes } = await exportRedacted();
  const loadingTask = pdfjsLib.getDocument({ data: outputBytes.slice(), useSystemFonts: false });
  const loaded = await loadingTask.promise;
  try {
    const texts = [];
    for (let n = 1; n <= loaded.numPages; n += 1) {
      const content = await (await loaded.getPage(n)).getTextContent();
      texts.push(content.items.map((item) => item.str).join(' '));
    }
    const all = texts.join('\n');
    for (const word of SECRET_WORDS) assert.doesNotMatch(all, new RegExp(word));
    assert.match(all, /KEEP ME SEARCHABLE/);
    const annotations = await (await loaded.getPage(1)).getAnnotations({ intent: 'display' });
    assert.equal(annotations.some((a) => a.subtype === 'Redact'), false);
  } finally {
    await loadingTask.destroy();
  }
});
