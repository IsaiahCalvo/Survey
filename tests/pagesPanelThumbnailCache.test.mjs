/* Pages panel thumbnails (owner 2026-10-01, iPhone): a thumbnail drawn once
   never goes blank again while the document is open — the phone sheet
   unmounts the panel on close, so the drawn images live in a per-document
   cache; on-screen pages are drawn first; there is no "Loading..." text. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  getCachedPageThumbnails,
  rememberPageThumbnails,
  takePriorityJob,
  encodeCanvasToDataUrl,
  SYNC_ENCODE_MAX_PIXELS,
} from '../src/sidebar/pagesPanelThumbnailCache.js';

const PANEL = readFileSync(new URL('../src/sidebar/PagesPanel.jsx', import.meta.url), 'utf8');

test('drawn thumbnails are kept per document object', () => {
  const docA = { numPages: 3 };
  const docB = { numPages: 3 };
  assert.equal(getCachedPageThumbnails(docA), null);
  rememberPageThumbnails(docA, { 1: { src: 'data:a', quality: 'crisp' } }, { 1: 129 });
  assert.equal(getCachedPageThumbnails(docA).thumbnails[1].src, 'data:a');
  assert.equal(getCachedPageThumbnails(docA).ratios[1], 129);
  assert.equal(getCachedPageThumbnails(docB), null, 'another document never sees these images');
  assert.equal(getCachedPageThumbnails(null), null);
  rememberPageThumbnails(null, {}, {}); // no throw
});

test('on-screen pages are drawn before pages in the preload margin', () => {
  const queue = [{ pageNumber: 1 }, { pageNumber: 2 }, { pageNumber: 3 }, { pageNumber: 4 }];
  const onScreen = new Set([2]);
  assert.equal(takePriorityJob(queue, (n) => onScreen.has(n)).pageNumber, 2);
  assert.deepEqual(queue.map((j) => j.pageNumber), [1, 3, 4]);
  // nothing on screen: last in, first out
  assert.equal(takePriorityJob(queue, () => false).pageNumber, 4);
  assert.equal(takePriorityJob([], () => true), null);
});

test('small first images encode synchronously; big ones use toBlob', async () => {
  const calls = [];
  const small = { width: 150, height: 200, toDataURL: () => { calls.push('sync'); return 'data:small'; }, toBlob: () => calls.push('blob') };
  assert.ok(150 * 200 <= SYNC_ENCODE_MAX_PIXELS);
  assert.equal(await encodeCanvasToDataUrl(small), 'data:small');
  assert.deepEqual(calls, ['sync']);
  const big = { width: 465, height: 600, toDataURL: () => 'data:fallback', toBlob: (cb) => cb(null) };
  // toBlob gives nothing back -> falls back to toDataURL rather than failing
  assert.equal(await encodeCanvasToDataUrl(big), 'data:fallback');
});

test('the panel restores from the cache and shows no "Loading..." text', () => {
  assert.match(PANEL, /useState\(\(\) => getCachedPageThumbnails\(pdfDoc\)\?\.thumbnails \|\| \{\}\)/);
  assert.match(PANEL, /rememberPageThumbnails\(pdfDoc, thumbnails, pageAspectRatios\)/);
  assert.doesNotMatch(PANEL, />\s*Loading\.\.\.\s*</);
  // the phone page menu control is one circle with the level glyph
  assert.match(PANEL, /<Icon name="moreHorizontal" size=\{18\}/);
});
