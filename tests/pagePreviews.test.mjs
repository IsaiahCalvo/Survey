/* Page previews kept on the device and drawn on their own thread (2026-11-09).
   Heavy drawing sets left pages white for seconds right after opening: each
   page's preview cost about a full page draw and waited in line behind the
   pages on screen. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createPageThumbStore, pageThumbStamp } from '../src/services/pageThumbStore.js';
import { createPagePreviewSession } from '../src/utils/pagePreviewSession.js';
import { pageThumbWorkerSupported } from '../src/utils/pageThumbRenderer.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const buf = (n, fill = 1) => new Uint8Array(n).fill(fill).buffer;
// A fresh database name per test: the store's name is fixed, so each test
// gets its own fake IndexedDB factory.
async function freshStore(options = {}) {
  const { IDBFactory } = await import('fake-indexeddb');
  return createPageThumbStore({ indexedDb: new IDBFactory(), timeoutMs: 2000, ...options });
}

test('a file\'s previews survive a reopen, keyed by the bytes\' hash', async () => {
  const { IDBFactory } = await import('fake-indexeddb');
  const factory = new IDBFactory();
  const store = createPageThumbStore({ indexedDb: factory, timeoutMs: 2000 });
  const stamp = await pageThumbStamp(new TextEncoder().encode('%PDF-1.7 drawing set'));
  assert.match(stamp, /^[0-9a-f]{64}$/);
  assert.deepEqual(await store.loadDoc(stamp), []);
  assert.equal(await store.putPages(stamp, [
    { pageKey: '0:r0', scale: 0.1, type: 'image/webp', data: buf(10) },
    { pageKey: '1:r0', scale: 0.1, type: 'image/webp', data: buf(20) },
  ]), true);
  await store.close();
  const reopened = createPageThumbStore({ indexedDb: factory, timeoutMs: 2000 });
  const rows = await reopened.loadDoc(stamp);
  assert.deepEqual(rows.map((r) => r.pageKey).sort(), ['0:r0', '1:r0']);
  assert.equal(rows.find((r) => r.pageKey === '1:r0').data.byteLength, 20);
  // Other bytes, other previews.
  assert.deepEqual(await reopened.loadDoc(await pageThumbStamp(new TextEncoder().encode('other'))), []);
});

test('over budget, whole files go least recently opened first, never the one being saved', async () => {
  let clock = 0;
  const store = await freshStore({ budgetBytes: 100, now: () => ++clock });
  await store.putPages('a', [{ pageKey: '0:r0', scale: 1, data: buf(40) }]);
  await store.putPages('b', [{ pageKey: '0:r0', scale: 1, data: buf(40) }]);
  await store.loadDoc('a'); // a opened more recently than b
  await store.putPages('c', [{ pageKey: '0:r0', scale: 1, data: buf(40) }]);
  assert.equal((await store.loadDoc('b')).length, 0, 'b (oldest) dropped');
  assert.equal((await store.loadDoc('a')).length, 1);
  assert.equal((await store.loadDoc('c')).length, 1);
});

test('signing out or another account empties the previews', async () => {
  const store = await freshStore();
  await store.retainOnly('user-1');
  await store.putPages('a', [{ pageKey: '0:r0', scale: 1, data: buf(4) }]);
  await store.retainOnly('user-1');
  assert.equal((await store.loadDoc('a')).length, 1, 'same account keeps them');
  await store.retainOnly('user-2');
  assert.equal((await store.loadDoc('a')).length, 0, 'another account drops them');
  await store.putPages('a', [{ pageKey: '0:r0', scale: 1, data: buf(4) }]);
  await store.clear();
  assert.equal((await store.loadDoc('a')).length, 0, 'sign-out clears');
});

test('a session loads kept previews and keeps new ones for the next open', async () => {
  const store = await freshStore();
  await store.putPages('hash-1', [{ pageKey: '0:r0', scale: 0.1, data: buf(8) }]);
  const session = createPagePreviewSession(null, { stamp: 'hash-1', store });
  const kept = await session.kept();
  assert.deepEqual(kept.map((r) => r.pageKey), ['0:r0']);
  assert.equal(session.isKept('0:r0'), true);
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });
  session.keep('1:r0', { blob, scale: 0.1 });
  session.keep('0:r0', { blob, scale: 0.1 }); // already kept: ignored
  session.stop(); // writes what is waiting
  for (let i = 0; i < 50 && (await store.loadDoc('hash-1')).length < 2; i += 1) await new Promise((r) => setTimeout(r, 10));
  const rows = await store.loadDoc('hash-1');
  assert.deepEqual(rows.map((r) => r.pageKey).sort(), ['0:r0', '1:r0']);
});

test('the preview worker runs only on computers with cores to spare', () => {
  const env = (cores, coarse) => ({
    Worker: function Worker() {}, OffscreenCanvas: function OffscreenCanvas() {}, createImageBitmap() {},
    navigator: { hardwareConcurrency: cores }, matchMedia: () => ({ matches: coarse }),
  });
  assert.equal(pageThumbWorkerSupported(env(8, false)), true);
  assert.equal(pageThumbWorkerSupported(env(2, false)), false);
  assert.equal(pageThumbWorkerSupported(env(8, true)), false, 'touch devices keep the in-line prefetch');
  assert.equal(pageThumbWorkerSupported({ ...env(8, false), OffscreenCanvas: undefined }), false);
});

test('viewer: pages show a preview the moment one arrives, and the in-line prefetch steps aside for the worker', () => {
  const src = read('../src/components/PdfjsViewerContainer.jsx');
  assert.match(src, /stopWaiting = waitForPageThumb\(pageId,/);
  assert.match(src, /stopWaiting\?\.\(\);/);
  assert.match(src, /if \(previewWorker !== 'off'\) return undefined;/);
  assert.match(src, /createPagePreviewSession\(base,/);
  assert.match(src, /\{ fromDevice: true \}/);
  const worker = read('../src/workers/pageThumbWorker.js');
  assert.match(worker, /CanvasFactory: OffscreenCanvasFactory/);
  assert.match(worker, /annotationMode: pdfjsLib\.AnnotationMode\.DISABLE/, 'previews never bake marks in');
  const db = read('../src/hooks/useDatabase.js');
  assert.match(db, /bindPdfCacheToAuth\(supabase, pageThumbStore\(\)\)/);
});

test('overlay page scale: measured from the page box, kept until the box changes', async () => {
  const { measurePdfjsPageScaleCached } = await import('../src/viewerShared.js');
  let reads = 0;
  const canvas = { get clientWidth() { reads += 1; return this.w; }, w: 600 };
  const host = { style: { width: '600px', display: '' }, querySelector: (sel) => (sel === '.survey-pdfjs-page-canvas' ? canvas : null), clientWidth: 600 };
  const sizes = { 1: { width: 300 } };
  const cache = new WeakMap();
  assert.equal(measurePdfjsPageScaleCached(1, sizes, { 1: host }, 1, cache), 2);
  const after = reads;
  assert.equal(measurePdfjsPageScaleCached(1, sizes, { 1: host }, 1, cache), 2);
  assert.equal(reads, after, 'no layout read while the box is unchanged');
  host.style.width = '900px'; canvas.w = 900;
  assert.equal(measurePdfjsPageScaleCached(1, sizes, { 1: host }, 1, cache), 3, 'measures again after a zoom');
  canvas.w = 0; host.style.width = '450px'; host.clientWidth = 0;
  assert.equal(measurePdfjsPageScaleCached(1, sizes, { 1: host }, 1.2, cache), 1.2, 'unlaid page falls back');
  canvas.w = 450;
  assert.equal(measurePdfjsPageScaleCached(1, sizes, { 1: host }, 1.2, cache), 1.5, 'and measures again once laid out');
});
