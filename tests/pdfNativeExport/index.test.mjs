import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as api from '../../src/utils/pdfNativeExport/index.js';

async function makeSourcePdf() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return doc.save();
}

async function getSubtypes(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => doc.context.lookup(ref).get(PDFName.of('Subtype')).decodeText());
}

test('exports the expected public API', () => {
  assert.equal(typeof api.bakeAnnotationsIntoPdf, 'function');
  assert.equal(typeof api.registerAdapter, 'function');
  assert.equal(typeof api.getAdapter, 'function');
});

test('bakeAnnotationsIntoPdf rejects when called without inputs', async () => {
  await assert.rejects(() => api.bakeAnnotationsIntoPdf(null, {}), /requires pdfBytes/);
});

test('bakeAnnotationsIntoPdf returns Uint8Array bytes on empty input', async () => {
  const bytes = await api.bakeAnnotationsIntoPdf(await makeSourcePdf(), {});
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.byteLength > 0);
});

test('bakeAnnotationsIntoPdf returns audit when requested', async () => {
  const result = await api.bakeAnnotationsIntoPdf(await makeSourcePdf(), {}, { returnAudit: true });
  assert.ok(result.bytes instanceof Uint8Array);
  assert.equal(result.audit.totalConsidered, 0);
  assert.equal(result.audit.written, 0);
});

test('bakeAnnotationsIntoPdf writes Square + Circle dicts via per-type adapters', async () => {
  const bytes = await api.bakeAnnotationsIntoPdf(await makeSourcePdf(), {
    1: {
      objects: [
        { id: 'rect-1', type: 'rect', left: 10, top: 10, width: 30, height: 20, stroke: '#111111' },
        { id: 'circle-1', type: 'circle', left: 50, top: 50, radius: 10, stroke: '#111111' },
      ],
    },
  });
  assert.deepEqual((await getSubtypes(bytes)).sort(), ['Circle', 'Square']);
});

test('registerAdapter and getAdapter round-trip a stub adapter', () => {
  const stub = (obj) => ({ stubbed: obj?.id });
  api.registerAdapter('__test_type__', stub);
  assert.equal(api.getAdapter('__test_type__'), stub);
  assert.equal(api.getAdapter('__missing__'), null);
});
