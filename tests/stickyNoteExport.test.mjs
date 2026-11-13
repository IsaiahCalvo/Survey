// Nightly 'note-tool': a sticky note made in Survey exports as a real PDF
// /Text note with its words in /Contents (every PDF reader opens it), and
// comes back in as a note with the same words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFArray } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { stickyNoteItem } from '../src/utils/stickyNote.js';

const quiet = async (fn) => {
  const { log, warn, error } = console;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; console.error = error; }
};

const makePdfFile = async () => {
  const source = await PDFDocument.create();
  source.addPage([420, 320]);
  const bytes = await source.save();
  return {
    name: 'note.pdf',
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
};

test('a Survey sticky note exports as a /Text note with its words', async () => {
  const note = stickyNoteItem({ text: 'Check the hinge', id: 'note-export-1' }).payload.items[0].object;
  note.left = 100;
  note.top = 50;
  const file = await makePdfFile();
  const original = globalThis.window;
  globalThis.window = {};
  let bytes;
  try {
    bytes = await quiet(() => savePDFWithAnnotationsPdfLib(
      file,
      { 1: { objects: [note] } },
      { 1: { width: 420, height: 320 } },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'note-export' },
    ));
  } finally {
    globalThis.window = original;
  }
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  assert.ok(annots instanceof PDFArray);
  const dicts = annots.asArray().map((ref) => doc.context.lookup(ref));
  const text = dicts.find((d) => String(d.get(PDFName.of('Subtype'))) === '/Text');
  assert.ok(text, 'a /Text annotation is written');
  assert.equal(text.lookup(PDFName.of('Contents')).decodeText(), 'Check the hinge');
  assert.equal(String(text.get(PDFName.of('Name'))), '/Note');
  const rect = text.lookup(PDFName.of('Rect')).asArray().map((n) => n.asNumber());
  assert.deepEqual(rect.map((n) => Math.round(n)), [100, 320 - 72, 122, 270]);
  assert.ok(!dicts.some((d) => String(d.get(PDFName.of('Subtype'))) === '/Square'), 'not a plain rectangle');
});
