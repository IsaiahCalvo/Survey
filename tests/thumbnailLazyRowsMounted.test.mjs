/* Lazy list thumbnails (owner 2026-09-23: "It shouldn't be constantly
   fetching"). Mounts the real PdfPageThumb in jsdom with a controllable
   IntersectionObserver and counts every cache read, download and backfill
   request:
     - an off-screen row touches nothing;
     - a visible row with no cached image downloads nothing itself and asks
       the idle backfill for exactly that document;
     - a pushed "thumbnail changed" event refreshes only the matching row from
       the local cache — no polling, no download. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { transformWithOxc } from 'vite';
import { registerThumbnailBackfill } from '../src/home/thumbnailRequestPolicy.js';
import { publishThumbnailUpdate } from '../src/services/thumbnailEvents.js';

const require = createRequire(import.meta.url);
let moduleId = 0;

async function mount(t, docs) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
  const state = { reads: [], downloads: 0, renders: 0, observers: [], stored: new Map() };
  class IntersectionObserverMock {
    constructor(callback) { this.callback = callback; state.observers.push(this); }
    observe(node) { this.node = node; }
    disconnect() { this.disconnected = true; }
    fire(isIntersecting) { this.callback([{ isIntersecting, target: this.node }]); }
  }
  const previous = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
    IntersectionObserver: IntersectionObserverMock, __thumbnailLazyState: state,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const componentUrl = new URL('../src/home/PdfPageThumb.jsx', import.meta.url);
  let source = await readFile(componentUrl, 'utf8');
  source = source
    .replace("from 'react'", `from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)}`)
    .replace("import { loadPdfjs } from '../utils/pdfWorkerConfig';", 'const loadPdfjs = async () => { globalThis.__thumbnailLazyState.renders++; throw new Error("no pdf.js in this test"); };')
    .replace("import { readBlobAsArrayBuffer } from '../utils/blobArrayBuffer';", 'const readBlobAsArrayBuffer = async () => new ArrayBuffer(1);')
    .replace("import { thumbnailStore, thumbCacheKey } from '../services/thumbnailStore';",
      'const thumbnailStore = () => ({ get: async (key) => { globalThis.__thumbnailLazyState.reads.push(key); return globalThis.__thumbnailLazyState.stored.get(key) || null; }, put: async () => true }); const thumbCacheKey = doc => doc?.id ? `${doc.id}::${doc.file_path}` : null;')
    .replace("from './thumbnailRequestPolicy'", `from ${JSON.stringify(new URL('../src/home/thumbnailRequestPolicy.js', import.meta.url).href)}`);
  const transformed = await transformWithOxc(source, fileURLToPath(componentUrl), { lang: 'jsx' });
  const executable = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
  const PdfPageThumb = (await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}#${++moduleId}`)).default;

  const requested = [];
  const unregister = registerThumbnailBackfill({ prioritize: (doc) => requested.push(doc.id) });
  const root = createRoot(document.getElementById('root'));
  const downloadDocument = async () => { state.downloads++; return new Blob(); };
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => {
    root.render(React.createElement('div', null, docs.map((doc) => React.createElement(PdfPageThumb, {
      key: doc.id, doc, downloadDocument, variant: 'row', height: 30,
      fallback: React.createElement('span', { 'data-placeholder': doc.id }),
    }))));
  });
  await settle();
  t.after(async () => {
    unregister();
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const imgSrc = (index) => state.observers[index].node.querySelector('img')?.getAttribute('src') || null;
  return { state, requested, settle, imgSrc };
}

const docA = { id: 'lazy-a', file_path: 'owner/a.pdf' };
const docB = { id: 'lazy-b', file_path: 'owner/b.pdf' };

test('off-screen rows read nothing, download nothing and queue nothing', async (t) => {
  const h = await mount(t, [docA, docB]);
  assert.equal(h.state.observers.length, 2);
  assert.deepEqual(h.state.reads, []);
  assert.equal(h.state.downloads, 0);
  assert.deepEqual(h.requested, []);
});

test('a visible uncached row asks the idle backfill for that one document and downloads nothing', async (t) => {
  const h = await mount(t, [docA, docB]);
  await act(async () => { h.state.observers[0].fire(true); });
  await h.settle();
  assert.deepEqual(h.state.reads, ['lazy-a::owner/a.pdf'], 'one local cache read for the visible row only');
  assert.deepEqual(h.requested, ['lazy-a']);
  assert.equal(h.state.downloads, 0);
  assert.equal(h.state.renders, 0);
});

test('a pushed update refreshes only the matching visible row, from the local cache', async (t) => {
  const h = await mount(t, [docA, docB]);
  await act(async () => { h.state.observers[0].fire(true); h.state.observers[1].fire(true); });
  await h.settle();
  assert.equal(h.imgSrc(0), null);
  const readsBefore = h.state.reads.length;

  h.state.stored.set('lazy-a::owner/a.pdf', { url: 'data:image/webp;base64,NEW', aspect: 0.75 });
  await act(async () => { publishThumbnailUpdate({ docId: 'lazy-a', key: 'lazy-a::owner/a.pdf' }); });
  await h.settle();
  assert.equal(h.imgSrc(0), 'data:image/webp;base64,NEW');
  assert.equal(h.imgSrc(1), null, 'the other row is untouched');
  assert.deepEqual(h.state.reads.slice(readsBefore), ['lazy-a::owner/a.pdf'], 'exactly one cache read');
  assert.equal(h.state.downloads, 0);

  // A second edit replaces the image in place (no placeholder flash).
  h.state.stored.set('lazy-a::owner/a.pdf', { url: 'data:image/webp;base64,NEWER', aspect: 0.75 });
  await act(async () => { publishThumbnailUpdate({ docId: 'lazy-a' }); });
  await h.settle();
  assert.equal(h.imgSrc(0), 'data:image/webp;base64,NEWER');
  assert.equal(h.state.downloads, 0);
});
