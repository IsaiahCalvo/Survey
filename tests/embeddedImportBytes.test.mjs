import test from 'node:test';
import assert from 'node:assert/strict';
import { readOriginalPdfBytes } from '../src/services/embeddedImportBytes.js';

test('a File gives its own bytes', async () => {
  const buf = new Uint8Array([1, 2]).buffer;
  assert.equal(await readOriginalPdfBytes({ arrayBuffer: async () => buf }, { getData: async () => { throw new Error('unused'); } }), buf);
});

test('a streamed open (row metadata, no File) reads the bytes from the pdf.js document', async () => {
  const data = new Uint8Array([37, 80, 68, 70]);
  assert.equal(await readOriginalPdfBytes({ id: 'd', filePath: 'u/p.pdf' }, { getData: async () => data }), data);
});

test('no bytes anywhere throws, so the import marker is never written', async () => {
  await assert.rejects(readOriginalPdfBytes({ id: 'd' }, null));
  await assert.rejects(readOriginalPdfBytes({ id: 'd' }, { getData: async () => new Uint8Array(0) }));
});

test('PDFViewer\'s once-only embedded import uses the helper, not a null fallback', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(src, /const rawPdfBytes = await readOriginalPdfBytes\(pdfFile, pdfDoc\);\n\s+const \{ annotationsByPage: importedWithSource/);
});
