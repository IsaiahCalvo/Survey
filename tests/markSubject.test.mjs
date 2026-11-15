// Nightly 'mark-subject' (Drawboard Projects parity): every mark can carry its
// own subject. It shows in the Markups list and its CSV, is written as /Subj on
// export and comes back on re-import through the app metadata blob.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import {
  MARK_SUBJECT_MAX,
  cleanMarkSubject,
  markSubjectOf,
  sharedMarkSubject,
  withMarkSubject,
} from '../src/utils/markSubject.js';
import { buildMarkupRows, filterMarkupRows, markupRowsToCsv } from '../src/utils/markupList.js';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import {
  PDF_APP_ANNOTATION_METADATA_KEY,
  applyPdfAppAnnotationMetadata,
  parsePdfAppAnnotationMetadata,
} from '../src/utils/pdfAppAnnotationMetadata.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

test('a typed subject is one trimmed line, at most the cap', () => {
  assert.equal(cleanMarkSubject('  Fire\n door \t A  '), 'Fire door A');
  assert.equal(cleanMarkSubject(null), '');
  assert.equal(cleanMarkSubject('x'.repeat(200)).length, MARK_SUBJECT_MAX);
});

test('withMarkSubject sets, clears and skips no-op changes', () => {
  const mark = { id: 'a', type: 'rect', data: { layerId: 'L1' } };
  const named = withMarkSubject(mark, ' Fire door ');
  assert.deepEqual(named.data, { layerId: 'L1', subject: 'Fire door' });
  assert.equal(mark.data.subject, undefined, 'the original is not changed');
  assert.equal(withMarkSubject(named, 'Fire door'), null);
  const cleared = withMarkSubject(named, '   ');
  assert.deepEqual(cleared.data, { layerId: 'L1' });
  assert.equal(withMarkSubject(mark, ''), null);
  assert.equal(markSubjectOf(cleared), null);
});

test('sharedMarkSubject is the common subject, or null when they differ', () => {
  const a = { data: { subject: 'Door' } };
  const b = { data: { subject: 'Door' } };
  const c = { data: {} };
  assert.equal(sharedMarkSubject([a, b]), 'Door');
  assert.equal(sharedMarkSubject([c, { }]), '');
  assert.equal(sharedMarkSubject([a, c]), null);
  assert.equal(sharedMarkSubject([]), '');
});

test('Markups rows carry the subject, search finds it, the CSV column is opt-in', () => {
  const rows = buildMarkupRows({
    1: { objects: [
      { id: 'r1', type: 'rect', left: 0, top: 0, width: 10, height: 10, stroke: '#ff0000', data: { subject: 'Fire door' } },
      { id: 'r2', type: 'rect', left: 20, top: 0, width: 10, height: 10, stroke: '#ff0000' },
    ] },
  });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.r1.subject, 'Fire door');
  assert.equal(byId.r2.subject, null);
  assert.deepEqual(filterMarkupRows(rows, { query: 'fire' }).map((r) => r.id), ['r1']);

  const plain = markupRowsToCsv(rows).split('\n');
  assert.ok(!plain[0].includes('Subject'), 'no column with the flag off');
  const withSubjects = markupRowsToCsv(rows, { subjects: true }).split('\n');
  const head = withSubjects[0].split(',');
  const col = head.indexOf('Subject');
  assert.equal(col, 2);
  const cells = withSubjects.slice(1).map((line) => line.split(',')[col]);
  assert.ok(cells.includes('Fire door'));
  assert.ok(cells.includes(byId.r2.kindLabel), 'no own subject falls back to the kind');
});

test('export writes the own subject as /Subj and re-import keeps it', async () => {
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
        { id: 'own', type: 'rect', left: 30, top: 10, width: 20, height: 12, stroke: '#111111', data: { subject: 'Fire door' } },
        { id: 'kind', type: 'rect', left: 80, top: 10, width: 20, height: 12, stroke: '#111111' },
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
    found[meta.id] = { subj: dict.get(PDFName.of('Subj'))?.decodeText?.(), meta };
  }
  assert.equal(found.own.subj, 'Fire door');
  assert.equal(found.kind.subj, 'Rectangle');
  const restored = applyPdfAppAnnotationMetadata({ type: 'rect', left: 0, top: 0, width: 1, height: 1, data: {} }, found.own.meta);
  assert.equal(markSubjectOf(restored), 'Fire door');
});

test('the flag is beta, the panel and page layer use it, and a migration adds its row', () => {
  assert.equal(FEATURE_FLAGS['mark-subject'].stage, 'beta');
  const panel = readFileSync(new URL('../src/components/SelectionPropertiesPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /isFeatureOn\('mark-subject'\)/);
  assert.match(panel, /op: 'subject'/);
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(layer, /detail\.op === 'subject'/);
  const migration = readFileSync(new URL('../supabase/migrations/20261115214000_mark_subject_flag.sql', import.meta.url), 'utf8');
  assert.match(migration, /'mark-subject', 'off'/);
});
