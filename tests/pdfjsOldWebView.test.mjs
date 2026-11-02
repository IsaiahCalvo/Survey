// pdf.js 6.4's "legacy" build no longer polyfills Promise.withResolvers, which
// Chrome only has from 119. Android 14's system WebView (the CI emulator, and
// phones that have not updated it) is older, so every PDF showed "Couldn't open
// this PDF". scripts/vite-pdfjs-assets.mjs puts a polyfill in front of pdf.js
// and its worker. This opens a real PDF with Promise.withResolvers removed,
// once without the polyfill (must fail, or the test proves nothing) and once
// with it (must open).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROMISE_WITH_RESOLVERS_POLYFILL, pdfjsPolyfillPlugin } from '../scripts/vite-pdfjs-assets.mjs';

const require = createRequire(import.meta.url);
const buildDir = join(dirname(require.resolve('pdfjs-dist/package.json')), 'legacy/build');

function openWithoutWithResolvers(prefix) {
  const dir = mkdtempSync(join(tmpdir(), 'pdfjs-old-webview-'));
  try {
    for (const name of ['pdf.mjs', 'pdf.worker.mjs']) {
      writeFileSync(join(dir, name), prefix + readFileSync(join(buildDir, name), 'utf8'));
    }
    const script = `
      delete Promise.withResolvers;
      const pdfjs = await import(${JSON.stringify(pathToFileURL(join(dir, 'pdf.mjs')).href)});
      globalThis.pdfjsWorker = await import(${JSON.stringify(pathToFileURL(join(dir, 'pdf.worker.mjs')).href)});
      const data = new Uint8Array((await import('node:fs')).readFileSync('debug/fixtures/door-tags.pdf'));
      try {
        const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
        const page = await doc.getPage(1);
        console.log('opened ' + doc.numPages + ' ' + (await page.getTextContent()).items.length);
      } catch (error) { console.log('failed ' + error.message); }
    `;
    return execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim().split('\n').pop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('without the polyfill, pdf.js cannot open a PDF on an old WebView', () => {
  assert.match(openWithoutWithResolvers(''), /^failed .*withResolvers/);
});

test('with the polyfill in front of pdf.js and its worker, the PDF opens', () => {
  assert.match(openWithoutWithResolvers(PROMISE_WITH_RESOLVERS_POLYFILL), /^opened 2 [1-9]/);
});

test('the build plugin covers pdf.js, its worker module and the emitted worker asset', () => {
  const plugin = pdfjsPolyfillPlugin();
  for (const id of [
    '/x/node_modules/pdfjs-dist/legacy/build/pdf.mjs',
    '/x/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    '/x/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs?url',
  ]) {
    assert.ok(plugin.transform('/*pdfjs*/', id).code.startsWith(PROMISE_WITH_RESOLVERS_POLYFILL), id);
  }
  assert.equal(plugin.transform('/*app*/', '/x/src/utils/pdfWorkerConfig.js'), null);
  const bundle = {
    worker: { type: 'asset', fileName: 'assets/pdf.worker.min-Dkey6ZUl.mjs', source: '/*worker*/' },
    other: { type: 'asset', fileName: 'assets/logo-abc.svg', source: '<svg/>' },
  };
  plugin.generateBundle({}, bundle);
  assert.ok(bundle.worker.source.startsWith(PROMISE_WITH_RESOLVERS_POLYFILL));
  assert.equal(bundle.other.source, '<svg/>');
});
