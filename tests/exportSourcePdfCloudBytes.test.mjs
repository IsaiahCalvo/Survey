import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const print = readFileSync(new URL('../src/components/BrowserPrintDocument.jsx', import.meta.url), 'utf8');

// A cloud document's pdfFile is { id, name, filePath, ... } with no
// arrayBuffer(); handing it straight to a writer failed every cloud export
// with "e.arrayBuffer is not a function".
test('export, print and redaction writers get a source that can give its bytes', () => {
  const helper = viewer.slice(viewer.indexOf('const getExportSourcePdf = useCallback'));
  assert.match(helper, /const source = \(await flushPageOperations\(\)\) \|\| pdfFile;/);
  assert.match(helper, /typeof source\?\.arrayBuffer === 'function'\) return source;/);
  assert.match(helper, /await readPageMutationPdfBytes\(source\)/);
  assert.match(helper, /new File\(\[bytes\]/);
  const raw = viewer.match(/\(await flushPageOperations\(\)\) \|\| pdfFile/g) || [];
  assert.equal(raw.length, 1, 'only the helper may fall back to the bare pdfFile');
  // The Export PDF dialog's writer (export-modes) goes through the helper too.
  assert.equal((viewer.match(/await getExportSourcePdf\(\)/g) || []).length, 6);
  assert.match(viewer, /getSourcePdf=\{getExportSourcePdf\}/);
});

test('browser print resolves its source bytes through the viewer', () => {
  assert.match(print, /const sourcePdf = getSourcePdf \? await getSourcePdf\(\) : pdfFile;/);
  assert.match(print, /savePDFWithFlattenedRegularAnnotationsForPrint\(\s*sourcePdf,/);
});
