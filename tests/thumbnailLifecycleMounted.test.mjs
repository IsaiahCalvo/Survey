import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { transformWithOxc } from 'vite';

const require = createRequire(import.meta.url);
let moduleId = 0;

async function mount(t, { priority = false, failDownload = false, catalog = false } = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
  const state = { downloads: 0, renders: 0, removedTargets: 0, observers: [], failDownload,
    describes: 0, acquires: 0, failDescribe: false };
  class IntersectionObserverMock {
    constructor(callback) { this.callback = callback; state.observers.push(this); }
    observe(node) {
      this.node = node;
      this.mutations = new dom.window.MutationObserver(() => {
        if (!node.isConnected) {
          state.removedTargets++;
          this.callback([{ isIntersecting: false, target: node }]);
        }
      });
      this.mutations.observe(dom.window.document.body, { childList: true, subtree: true });
      this.callback([{ isIntersecting: true, target: node }]);
    }
    disconnect() { this.mutations?.disconnect(); }
  }
  const previous = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
    IntersectionObserver: IntersectionObserverMock, __thumbnailLifecycleState: state,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {} });
  dom.window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,preview';
  state.pdfjs = {
    VerbosityLevel: { ERRORS: 0 },
    getDocument() {
      return {
        destroy: async () => {},
        promise: Promise.resolve({
          cleanup() {},
          async getPage() {
            return {
              getViewport: () => ({ width: 612, height: 792 }),
              render() { state.renders++; return { promise: Promise.resolve() }; },
              cleanup() {},
            };
          },
        }),
      };
    },
  };
  const componentUrl = new URL('../src/home/PdfPageThumb.jsx', import.meta.url);
  let source = await readFile(componentUrl, 'utf8');
  source = source
    .replace("from 'react'", `from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)}`)
    .replace("import { loadPdfjs, getPdfjsDocumentOptions } from '../utils/pdfWorkerConfig';", 'const loadPdfjs = async () => globalThis.__thumbnailLifecycleState.pdfjs; const getPdfjsDocumentOptions = () => ({});')
    .replace("import { readBlobAsArrayBuffer } from '../utils/blobArrayBuffer';", 'const readBlobAsArrayBuffer = async () => new ArrayBuffer(1);')
    .replace("import { checkedPreviewThumbCacheKey, thumbnailStore, thumbCacheKey } from '../services/thumbnailStore';", "const thumbnailStore = () => ({ get: async () => null, put: async () => true }); const thumbCacheKey = doc => doc?.file_path ? doc.id : null; const checkedPreviewThumbCacheKey = value => value?.cacheKey || null;")
    .replace("from './thumbnailRequestPolicy'", `from ${JSON.stringify(new URL('../src/home/thumbnailRequestPolicy.js', import.meta.url).href)}`);
  const transformed = await transformWithOxc(source, fileURLToPath(componentUrl), { lang: 'jsx' });
  const executable = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
  const PdfPageThumb = (await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}#${++moduleId}`)).default;
  const rootNode = document.getElementById('root');
  const root = createRoot(rootNode);
  const describeCloudPreview = async ({ documentId }) => {
    state.describes++;
    if (state.failDescribe) throw new Error('access revoked');
    return { actorUserId: 'actor', documentId, cacheKey: `generation:${state.describes}` };
  };
  const acquireCloudPreview = async descriptor => {
    state.acquires++;
    return { ...descriptor, blob: new Blob(['pdf']) };
  };
  let props = {
    doc: catalog ? { id: 'cloud-a' } : { id: 'cloud-a', file_path: 'owner/a.pdf' },
    variant: 'row', height: 30, priority,
    fallback: React.createElement('span', { 'data-placeholder': true }, 'PDF'),
    downloadDocument: async () => {
      state.downloads++;
      if (state.failDownload) throw new Error('offline');
      return new Blob();
    },
    ...(catalog ? { describeCloudPreview, acquireCloudPreview } : {}),
  };
  const render = async (next = {}) => {
    props = { ...props, ...next };
    await act(async () => {
      root.render(React.createElement(PdfPageThumb, props));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  };
  const hide = async () => act(async () => {
    root.render(null);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  await render();
  return { state, rootNode, render, hide };
}

test('deferred row keeps its observed host and can become a selected preview', async t => {
  const h = await mount(t);
  const observedHost = h.state.observers[0].node;
  assert.equal(h.state.downloads, 0);
  assert.equal(h.state.removedTargets, 0);
  assert.equal(h.rootNode.firstElementChild, observedHost);
  assert.ok(observedHost.querySelector('[data-placeholder]'));
  assert.equal(observedHost.style.height, '30px');
  await h.render({ priority: true });
  assert.equal(h.state.downloads, 1);
  assert.equal(h.state.renders, 1);
  assert.equal(h.state.removedTargets, 0);
  assert.equal(h.rootNode.firstElementChild, observedHost);
  assert.ok(observedHost.querySelector('img'));
  assert.equal(observedHost.querySelector('[data-placeholder]'), null);
});

test('failed preview keeps its observed host and a different document can load', async t => {
  const h = await mount(t, { priority: true, failDownload: true });
  const observedHost = h.state.observers[0].node;
  assert.equal(h.state.downloads, 1);
  assert.equal(h.state.removedTargets, 0);
  assert.equal(h.rootNode.firstElementChild, observedHost);
  assert.ok(observedHost.querySelector('[data-placeholder]'));
  h.state.failDownload = false;
  await h.render({ doc: { id: 'cloud-b', file_path: 'owner/b.pdf' } });
  assert.equal(h.state.downloads, 2);
  assert.equal(h.state.renders, 1);
  assert.equal(h.state.removedTargets, 0);
  assert.equal(h.rootNode.firstElementChild, observedHost);
  assert.ok(observedHost.querySelector('img'));
});

test('a catalog preview proves current access again before showing prior memory pixels', async t => {
  const h = await mount(t, { priority: true, catalog: true });
  assert.equal(h.state.describes, 1);
  assert.equal(h.state.acquires, 1);
  assert.ok(h.rootNode.querySelector('img'));
  await h.hide();
  h.state.failDescribe = true;
  await h.render();
  assert.equal(h.state.describes, 2, 'remount performs a fresh access/mode read');
  assert.equal(h.state.acquires, 1, 'revoked access cannot acquire bytes');
  assert.equal(h.rootNode.querySelector('img'), null, 'old in-memory pixels are not shown');
  assert.ok(h.rootNode.querySelector('[data-placeholder]'));
});
