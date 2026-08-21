import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPagesPanelThumbKey,
  canReorderVisiblePages,
  getPdfDocumentCacheStamp,
  isLikelyBlackThumbnailPixels,
} from '../src/sidebar/pagesPanelUtils.js';

test('pages-panel cache key includes doc stamp, page, quality, and revision', () => {
  assert.equal(
    buildPagesPanelThumbKey({ stamp: 'abc', pageNumber: 3, quality: 'crisp', revision: 2 }),
    'pages-panel::abc::3::crisp::r2',
  );
  assert.equal(
    buildPagesPanelThumbKey({ stamp: 'abc', pageNumber: 3, quality: 'fast' }),
    'pages-panel::abc::3::fast::r0',
  );
  assert.notEqual(
    buildPagesPanelThumbKey({ stamp: 'abc', pageNumber: 1, quality: 'fast', revision: 0 }),
    buildPagesPanelThumbKey({ stamp: 'abc', pageNumber: 1, quality: 'fast', revision: 1 }),
  );
  assert.equal(buildPagesPanelThumbKey({ stamp: null, pageNumber: 1 }), null);
  assert.equal(buildPagesPanelThumbKey({ stamp: 'abc', pageNumber: 0 }), null);
});

test('pdf.js fingerprints are used as the durable cache stamp', () => {
  assert.equal(getPdfDocumentCacheStamp({ fingerprints: ['deadbeef', 'other'] }), 'deadbeef');
  assert.equal(getPdfDocumentCacheStamp({ fingerprint: 'legacy-fp' }), 'legacy-fp');
  assert.equal(getPdfDocumentCacheStamp({}), null);
  assert.equal(getPdfDocumentCacheStamp(null), null);
});

test('solid-black pixel buffers are rejected; normal and empty buffers are not', () => {
  const solidBlack = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < solidBlack.length; i += 4) {
    solidBlack[i] = 0;
    solidBlack[i + 1] = 0;
    solidBlack[i + 2] = 0;
    solidBlack[i + 3] = 255;
  }
  assert.equal(isLikelyBlackThumbnailPixels(solidBlack, 8, 8), true);

  const white = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < white.length; i += 4) {
    white[i] = 255;
    white[i + 1] = 255;
    white[i + 2] = 255;
    white[i + 3] = 255;
  }
  assert.equal(isLikelyBlackThumbnailPixels(white, 8, 8), false);

  const mixed = new Uint8ClampedArray(solidBlack);
  mixed[0] = 200;
  mixed[1] = 200;
  mixed[2] = 200;
  assert.equal(isLikelyBlackThumbnailPixels(mixed, 8, 8), false);

  assert.equal(isLikelyBlackThumbnailPixels(null, 8, 8), false);
  assert.equal(isLikelyBlackThumbnailPixels(solidBlack, 0, 8), false);
});

test('filtered Space views cannot internally reorder (hidden pages would move)', () => {
  assert.equal(canReorderVisiblePages({ allowedPages: [1, 2, 3], numPages: 3 }), true);
  assert.equal(canReorderVisiblePages({ allowedPages: [2, 5, 8], numPages: 10 }), false);
  assert.equal(canReorderVisiblePages({ allowedPages: [1, 2], numPages: 3 }), false);
  assert.equal(canReorderVisiblePages({ allowedPages: [2, 1, 3], numPages: 3 }), false);
  assert.equal(canReorderVisiblePages({ allowedPages: [], numPages: 3 }), false);
  assert.equal(canReorderVisiblePages({ allowedPages: [1], numPages: 0 }), false);
});

test('PagesPanel wires IndexedDB cache, black-frame reject, and space-filter reorder gate', () => {
  const panel = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../src/sidebar/PagesPanel.jsx'),
    'utf8',
  );
  assert.match(panel, /thumbnailStore\(\)\.get/);
  assert.match(panel, /thumbnailStore\(\)\.put/);
  assert.match(panel, /isLikelyBlackThumbnailSrc/);
  assert.match(panel, /canReorderPages/);
  assert.match(panel, /application\/pdf-page-internal/);
  assert.match(panel, /Insert blank page/);
  assert.match(panel, /handleInsertBlank/);
  assert.match(panel, /event\.key === 'Escape'/);
  assert.match(panel, /data-pages-context-menu="true"/);
});
