import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';
import { canResolveThumbnailBytes, createThumbnailRequestPool } from '../src/home/thumbnailRequestPolicy.js';
const require = createRequire(import.meta.url);
let serial = 0;

async function mount(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey.test' });
  const state = { reads: 0, bytes: 0, renders: 0, downloads: 0, fail: false, stored: null, readTasks: [] };
  const previous = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true, __localThumbQa: state })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {} });
  dom.window.HTMLCanvasElement.prototype.toDataURL = () => `data:image/jpeg;base64,render${state.renders}`;
  state.read = async file => { state.reads++; state.bytes += file.size; if (state.fail) throw new Error('read failed');
    const task = file.arrayBuffer(); state.readTasks.push(task); return task; };
  state.pdfjs = { VerbosityLevel: { ERRORS: 0 }, getDocument: () => ({ destroy: async () => {},
    promise: Promise.resolve({ cleanup() {}, getPage: async () => ({ cleanup() {},
      getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }),
      render: () => { state.renders++; return { promise: Promise.resolve() }; },
    }) }),
  }) };
  const url = new URL('../src/home/PdfPageThumb.jsx', import.meta.url);
  let source = await readFile(url, 'utf8');
  source = source.replace("from 'react'", `from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)}`)
    .replace("import { loadPdfjs, getPdfjsDocumentOptions } from '../utils/pdfWorkerConfig';", 'const loadPdfjs = async () => globalThis.__localThumbQa.pdfjs; const getPdfjsDocumentOptions = () => ({});')
    .replace("import { readBlobAsArrayBuffer } from '../utils/blobArrayBuffer';", 'const readBlobAsArrayBuffer = file => globalThis.__localThumbQa.read(file);')
    .replace("import { checkedPreviewThumbCacheKey, thumbnailStore, thumbCacheKey } from '../services/thumbnailStore';", 'const thumbnailStore = () => ({ get: async () => globalThis.__localThumbQa.stored, put: async () => true }); const thumbCacheKey = doc => doc.file_path ? doc.id + doc.file_path : null; const checkedPreviewThumbCacheKey = () => null;')
    .replace("from './thumbnailRequestPolicy'", `from ${JSON.stringify(new URL('../src/home/thumbnailRequestPolicy.js', import.meta.url).href)}`);
  const transformed = await transformWithOxc(source, fileURLToPath(url), { lang: 'jsx' });
  const executable = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
  const Component = (await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}#${++serial}`)).default;
  const root = createRoot(document.getElementById('root'));
  const download = async () => { state.downloads++; return new Blob(['cloud']); };
  const render = async entries => act(async () => {
    root.render(React.createElement(React.Fragment, null, ...entries.map((entry, i) => React.createElement(Component,
      { key: entry.key || i, downloadDocument: download, fallback: 'PDF', ...entry }))));
    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.all(state.readTasks);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  t.after(async () => { await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  return { state, render, download };
}

test('25 MiB local row and selected preview share one full read and one raster', async t => {
  const h = await mount(t);
  const doc = { id: 'same', file: new Blob([new Uint8Array(25 * 1024 * 1024)]) };
  await h.render([{ doc, variant: 'row' }, { doc, variant: 'preview', priority: true }]);
  assert.equal(h.state.reads, 1);
  assert.equal(h.state.bytes, 25 * 1024 * 1024);
  assert.equal(h.state.renders, 1);
  assert.equal(h.state.downloads, 0);
  assert.equal(document.querySelectorAll('img').length, 2);
  assert.equal(new Set([...document.querySelectorAll('img')].map(img => img.src)).size, 1);
});

test('replacing a File under the same id does not reuse old memory or durable pixels', async t => {
  const h = await mount(t);
  const doc = { id: 'same', file: new Blob(['old']), file_path: 'owner/old.pdf' };
  h.state.stored = { url: 'data:image/jpeg;base64,stale', aspect: 1 };
  await h.render([{ doc }]);
  await h.render([{ doc: { ...doc, file: new Blob(['new']) } }]);
  assert.equal(h.state.reads, 2);
  assert.equal(h.state.renders, 2);
  assert.notEqual(document.querySelector('img').src, h.state.stored.url);
});

test('local cache does not cross actor-bound download callbacks', async t => {
  const h = await mount(t);
  const doc = { id: 'same', file: new Blob(['local']) };
  await h.render([{ doc }]);
  await h.render([{ doc, downloadDocument: async () => { throw new Error('must remain local'); } }]);
  assert.equal(h.state.reads, 2);
  assert.equal(h.state.renders, 2);
});

test('a failed local read can retry on remount instead of permanently poisoning cache', async t => {
  const h = await mount(t);
  const doc = { id: 'same', file: new Blob(['local']) };
  h.state.fail = true;
  await h.render([{ doc }]);
  assert.equal(document.querySelector('img'), null);
  await h.render([]);
  h.state.fail = false;
  await h.render([{ doc }]);
  assert.equal(h.state.reads, 2);
  assert.equal(h.state.renders, 1);
});

test('an uncached cloud row cannot join a selected preview download', async t => {
  const h = await mount(t);
  const doc = { id: 'cloud', file_path: 'owner/cloud.pdf' };
  await h.render([{ doc, variant: 'row' }, { doc, priority: true }]);
  assert.equal(h.state.downloads, 1);
  assert.equal(h.state.renders, 1);
  assert.equal(document.querySelectorAll('img').length, 1);
});

test('changing cloud source version under the same document id invalidates memory pixels', async t => {
  const h = await mount(t);
  await h.render([{ doc: { id: 'cloud', file_path: 'owner/version1.pdf' }, priority: true }]);
  await h.render([{ doc: { id: 'cloud', file_path: 'owner/version2.pdf' }, priority: true }]);
  assert.equal(h.state.downloads, 2);
  assert.equal(h.state.renders, 2);
});

test('a preview promotes shared local row work ahead of the queued row backlog', async () => {
  const source = await readFile(new URL('../src/home/PdfPageThumb.jsx', import.meta.url), 'utf8');
  const queue = source.slice(source.indexOf('let activeRenders ='), source.indexOf('/* Resolve a document'));
  const loader = source.slice(source.indexOf('const loadThumb ='), source.indexOf('/* US Letter portrait'));
  const order = [];
  const scope = {
    thumbnailRequests: createThumbnailRequestPool(), canResolveThumbnailBytes,
    thumbCacheKey: () => null, checkedPreviewThumbCacheKey: () => null,
    thumbnailStore: () => ({ get: async () => null }),
    resolvePdfBytes: async doc => { order.push(doc.id); return new ArrayBuffer(1); },
    renderFirstPage: async () => ({ url: 'pixels', aspect: 1 }),
  };
  const { acquireSlot, releaseSlot, loadThumb } = new Function(...Object.keys(scope),
    `${queue}\n${loader}\nreturn { acquireSlot, releaseSlot, loadThumb };`)(...Object.values(scope));
  await Promise.all([acquireSlot(), acquireSlot(), acquireSlot()]);
  const local = id => ({ id, file: new Blob(['local']) });
  const target = local('target');
  const first = loadThumb('backlog', local('backlog'), null);
  const row = loadThumb('target', target, null);
  await Promise.resolve();
  const preview = loadThumb('target', target, null, true);
  releaseSlot();
  await Promise.all([first, row, preview]);
  assert.deepEqual(order, ['target', 'backlog'], 'selected local preview shares one render and keeps queue priority');
  releaseSlot(); releaseSlot();
});

test('memory keys keep the pixel contract without retaining inline PDF bytes', async () => {
  const source = await readFile(new URL('../src/home/PdfPageThumb.jsx', import.meta.url), 'utf8');
  const helpers = source.slice(source.indexOf('const sourceObjectIds ='), source.indexOf('const MAX_CACHE_ENTRIES ='));
  const keyFor = new Function('thumbCacheKey', 'TARGET', `${helpers}\nreturn memoryThumbKey;`)(() => null, 1000);
  const doc = { id: 'inline', dataUrl: `data:application/pdf;base64,${'x'.repeat(1024 * 1024)}` };
  const first = keyFor(doc);
  assert.ok(first.length < 100);
  assert.match(first, /page-1:1000:jpeg-0\.9:v1/);
  assert.equal(keyFor(doc), first);
  doc.dataUrl = 'data:application/pdf;base64,new';
  assert.notEqual(keyFor(doc), first);
});
