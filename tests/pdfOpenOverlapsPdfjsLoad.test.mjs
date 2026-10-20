import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

test('PDF open starts pdf.js loading before the cloud download and awaits it afterwards', () => {
  const start = source.indexOf('const pdfjsReadyPromise = loadPdfjs();');
  const download = source.indexOf('const blob = await downloadFromStorage(pdfFile.filePath);');
  const awaitReady = source.indexOf('await pdfjsReadyPromise;');
  assert.ok(start > 0 && download > 0 && awaitReady > 0);
  assert.ok(start < download, 'loadPdfjs must start before the download');
  assert.ok(download < awaitReady, 'pdf.js readiness is awaited after the download');
  assert.match(source, /pdfjsReadyPromise\.catch\(\(\) => \{\}\);/, 'early rejection must not be unhandled');
});
