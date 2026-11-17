// KAL-721 (Nightly 'mark-note', Drawboard's Edit Note): any mark can carry a
// written note. It shows in the Markups list and its CSV, is written as the
// PDF mark's comment (/Contents) when the mark has no words of its own, and
// comes back on re-import through the app metadata blob.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import {
  MARK_NOTE_MAX,
  cleanMarkNote,
  markNoteOf,
  markNotePreview,
  sharedMarkNote,
  withMarkNote,
} from '../src/utils/markNote.js';
import { buildMarkupRows, filterMarkupRows, markupRowsToCsv } from '../src/utils/markupList.js';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import {
  PDF_APP_ANNOTATION_METADATA_KEY,
  applyPdfAppAnnotationMetadata,
  parsePdfAppAnnotationMetadata,
} from '../src/utils/pdfAppAnnotationMetadata.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

test('a typed note keeps its lines, loses trailing space and blank runs, at most the cap', () => {
  assert.equal(cleanMarkNote('  Door swings in.  \r\nCheck the closer.\t '), 'Door swings in.\nCheck the closer.');
  assert.equal(cleanMarkNote('a\n\n\n\nb'), 'a\n\nb');
  assert.equal(cleanMarkNote('   \n  '), '');
  assert.equal(cleanMarkNote('x'.repeat(MARK_NOTE_MAX + 50)).length, MARK_NOTE_MAX);
  assert.equal(markNotePreview('one\ntwo   three'), 'one two three');
  assert.equal(markNotePreview('y'.repeat(200), 10), `${'y'.repeat(9)}…`);
});

test('withMarkNote sets, clears and skips no-op changes', () => {
  const mark = { type: 'rect', data: { id: 'a' } };
  const noted = withMarkNote(mark, 'Fix the hinge');
  assert.equal(markNoteOf(noted), 'Fix the hinge');
  assert.equal(mark.data.note, undefined);
  assert.equal(withMarkNote(noted, 'Fix the hinge  '), null);
  const cleared = withMarkNote(noted, '  ');
  assert.equal('note' in cleared.data, false);
  assert.equal(withMarkNote(null, 'x'), null);
  assert.equal(sharedMarkNote([noted, { ...noted }]), 'Fix the hinge');
  assert.equal(sharedMarkNote([noted, mark]), null);
  assert.equal(sharedMarkNote([mark]), '');
});

test('Markups rows carry the note, search finds it, the CSV column is opt-in', () => {
  const rows = buildMarkupRows({ 1: { objects: [
    { id: 'a', type: 'rect', left: 0, top: 0, width: 10, height: 10, stroke: '#ff0000', data: { note: 'Door swings in' } },
    { id: 'b', type: 'rect', left: 20, top: 0, width: 10, height: 10, stroke: '#00ff00' },
  ] } });
  assert.equal(rows[0].note, 'Door swings in');
  assert.equal(rows[1].note, null);
  assert.deepEqual(filterMarkupRows(rows, { query: 'swings' }).map((r) => r.id), ['a']);
  assert.doesNotMatch(markupRowsToCsv(rows).split('\r\n')[0], /Note/);
  const csv = markupRowsToCsv(rows, { notes: true }).split('\r\n');
  assert.match(csv[0], /^Page,Kind,Text,Note,Colour/);
  assert.match(csv[1], /,Door swings in,/);
});

test('export writes the note as /Contents, keeps a mark\'s own words, and re-import keeps it', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const source = await doc.save();
  const file = { name: 'source.pdf', async arrayBuffer() { return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength); } };
  const originalWindow = globalThis.window;
  globalThis.window = {};
  let bytes;
  try {
    bytes = await savePDFWithAnnotationsPdfLib(
      file,
      { 1: { objects: [
        { id: 'noted', type: 'rect', left: 30, top: 10, width: 20, height: 12, stroke: '#111111', data: { note: 'Door swings in' } },
        { id: 'plain', type: 'rect', left: 80, top: 10, width: 20, height: 12, stroke: '#111111' },
      ] } },
      { 1: { width: 200, height: 200 } },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'doc-test', surveyMarkers: {} },
    );
  } finally {
    globalThis.window = originalWindow;
  }
  const out = await PDFDocument.load(bytes);
  const annots = out.getPage(0).node.lookup(PDFName.of('Annots')).asArray().map((ref) => out.context.lookup(ref));
  const found = {};
  for (const dict of annots) {
    const meta = parsePdfAppAnnotationMetadata(dict.get(PDFName.of(PDF_APP_ANNOTATION_METADATA_KEY))?.decodeText?.());
    found[meta.id] = { contents: dict.get(PDFName.of('Contents'))?.decodeText?.() || '', meta };
  }
  assert.equal(found.noted.contents, 'Door swings in');
  assert.equal(found.plain.contents, '');
  // The fingerprint is taken with the note in place, so the next upload of
  // this file sees no outside edit.
  assert.ok(found.noted.meta.written?.contents);
  assert.notEqual(found.noted.meta.written.contents, found.plain.meta.written?.contents);
  const restored = applyPdfAppAnnotationMetadata({ type: 'rect', left: 0, top: 0, width: 1, height: 1, data: {} }, found.noted.meta);
  assert.equal(markNoteOf(restored), 'Door swings in');
});

test('wiring: beta flag, panel box, page layer, menu row, list, migration', () => {
  assert.equal(FEATURE_FLAGS['mark-note']?.stage, 'beta');
  const panel = readFileSync(new URL('../src/components/SelectionPropertiesPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /isFeatureOn\('mark-note'\)/);
  assert.match(panel, /op: 'note'/);
  assert.match(panel, /data-props-note/);
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(layer, /detail\.op === 'note'/);
  const menu = readFileSync(new URL('../src/hooks/useAnnotationContextMenu.jsx', import.meta.url), 'utf8');
  assert.match(menu, /item\('Edit note', 'editNote', \(\) => focusPanelBox\('\[data-props-note\]', false\)\)/);
  const list = readFileSync(new URL('../src/sidebar/MarkupsPanel.jsx', import.meta.url), 'utf8');
  assert.match(list, /notes: notesOn/);
  const migration = readFileSync(new URL('../supabase/migrations/20261117122000_mark_note_flag.sql', import.meta.url), 'utf8');
  assert.match(migration, /'mark-note', 'off'/);
});
