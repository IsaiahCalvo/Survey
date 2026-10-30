import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { pdfjsAssetOptions } from '../src/utils/pdfjsAssets.js';

// Launch audit 2026-10-30: pdf.js 5+ needs its wasm decoders for JPEG 2000 /
// JBIG2 images (scanned drawings) and its standard fonts for unembedded text.
// Without wasmUrl those images were silently left off the page.

const lib = (workerSrc) => ({ version: '6.2.108', GlobalWorkerOptions: { workerSrc } });

test('built app: assets sit in a versioned folder next to the worker', () => {
  const opts = pdfjsAssetOptions(lib('https://surveytool.app/assets/pdf.worker.min-abc.mjs'), 'https://surveytool.app/');
  assert.equal(opts.wasmUrl, 'https://surveytool.app/assets/pdfjs-6.2.108/wasm/');
  assert.equal(opts.standardFontDataUrl, 'https://surveytool.app/assets/pdfjs-6.2.108/standard_fonts/');
  assert.equal(opts.cMapUrl, 'https://surveytool.app/assets/pdfjs-6.2.108/cmaps/');
  assert.equal(opts.cMapPacked, true);
  assert.equal(opts.iccUrl, 'https://surveytool.app/assets/pdfjs-6.2.108/iccs/');
});

test('Electron file:// and a relative worker path resolve against the page', () => {
  const opts = pdfjsAssetOptions(lib('./assets/pdf.worker.min-abc.mjs'), 'file:///Applications/Survey.app/dist/index.html');
  assert.equal(opts.wasmUrl, 'file:///Applications/Survey.app/dist/assets/pdfjs-6.2.108/wasm/');
});

test('dev server: straight from the package folder', () => {
  const opts = pdfjsAssetOptions(lib('/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs?import&url'), 'http://localhost:5173/');
  assert.equal(opts.wasmUrl, 'http://localhost:5173/node_modules/pdfjs-dist/wasm/');
  assert.equal(opts.standardFontDataUrl, 'http://localhost:5173/node_modules/pdfjs-dist/standard_fonts/');
});

test('no worker yet: no options', () => {
  assert.deepEqual(pdfjsAssetOptions(lib(''), 'https://x/'), {});
  assert.deepEqual(pdfjsAssetOptions(null, 'https://x/'), {});
});

test('every app getDocument call passes the asset options', () => {
  const files = [
    'src/components/PdfjsViewerContainer.jsx',
    'src/services/cloudPdfStream.js',
    'src/services/thumbnailRender.js',
    'src/hooks/useThumbnailBackfill.js',
    'src/components/BrowserPrintDocument.jsx',
    'src/components/VersionCompareDialog.jsx',
    'src/PDFViewer.jsx',
    'src/home/PdfPageThumb.jsx',
    'src/tools/browser.js',
  ];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const calls = source.match(/\.getDocument\(/g) || [];
    const withAssets = source.match(/pdfjsAssetOptions\((?:pdfjsLib|pdfjs)\)/g) || [];
    assert.ok(calls.length > 0, `${file} has no getDocument call any more; update this list`);
    assert.ok(withAssets.length >= calls.length, `${file}: ${calls.length} getDocument calls but ${withAssets.length} pass pdfjsAssetOptions`);
  }
});

test('the build emits the asset folders', () => {
  const config = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(config, /pdfjsAssetsPlugin\(\)/);
});
