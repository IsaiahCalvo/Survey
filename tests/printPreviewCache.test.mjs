import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPrintPreviewCache } from '../src/utils/printPreviewCache.js';
import React, { act, useRef, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const start = source.indexOf('  const printPanelGetThumbnail = useCallback(');
const end = source.indexOf('\n  }, [pdfDoc]);', start) + '\n  }, [pdfDoc]);'.length;
assert.ok(start >= 0 && end > start);
const callbackSource = source.slice(start, end);

function setup({ fail = false, maxBytes, renderGate = null } = {}) {
  const cache = createPrintPreviewCache({ maxBytes });
  const inflight = new Map();
  const calls = { renders: 0, pages: 0 };
  const pdfDoc = { getPage() {
    calls.pages++;
    if (fail) { fail = false; throw new Error('temporary getPage failure'); }
    return Promise.resolve({ rotate: 0,
      getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
      render: () => { calls.renders++; return { promise: renderGate || Promise.resolve() }; },
    });
  } };
  const deps = {
    useCallback: (fn) => fn,
    printPanelRenderCacheRef: { current: cache },
    printPanelInflightRef: { current: inflight },
    printPanelRenderSourceRef: { current: pdfDoc },
    pdfDoc,
    document: { createElement: () => ({ getContext: () => ({ fillRect() {}, translate() {}, scale() {},
      drawImage() {}, setTransform() {}, clearRect() {} }),
      toDataURL: () => 'data:image/jpeg;base64,' + 'a'.repeat(1000) }) },
    console: { log() {}, warn() {} },
  };
  const render = new Function(...Object.keys(deps), `${callbackSource}\nreturn printPanelGetThumbnail;`)(...Object.values(deps));
  return { cache, inflight, calls, render, deps, pdfDoc };
}

test('print preview retains at most 32 entries and rerenders an evicted page', async () => {
  const h = setup();
  const first = await h.render(1);
  for (let n = 2; n <= 33; n++) await h.render(n);
  assert.ok(h.cache.size <= 32);
  assert.equal(first.src.length, 1023, 'eviction must not clear a result already returned to a consumer');
  await h.render(1);
  assert.equal(h.calls.renders, 34);
});

test('simultaneous equal requests rasterize once', async () => {
  const h = setup();
  const images = await Promise.all(Array.from({ length: 10 }, () => h.render(1)));
  assert.equal(h.calls.renders, 1);
  assert.ok(images.every((image) => image === images[0]));
});

test('synchronous page failure does not retain a settled empty in-flight promise', async () => {
  const h = setup({ fail: true });
  assert.equal(await h.render(1), null);
  assert.equal(h.inflight.size, 0);
  assert.ok(await h.render(1));
  assert.equal(h.calls.pages, 2);
});

test('LRU touches and replacements preserve an exact byte budget', () => {
  const cache = createPrintPreviewCache({ maxBytes: 12, maxEntries: 10 });
  const a = { src: 'aaa' }, b = { src: 'bbb' }, c = { src: 'ccc' };
  cache.set('a', a);
  cache.set('b', b);
  assert.equal(cache.get('a'), a);
  cache.set('c', c);
  assert.equal(cache.get('b'), undefined, 'least recently used image was evicted');
  assert.equal(cache.bytes, 12);
  cache.set('a', { src: 'a' });
  assert.equal(cache.bytes, 8, 'replacement subtracts the old image bytes');
  cache.clear();
  assert.equal(cache.bytes, 0);
  assert.equal(cache.size, 0);
  assert.equal(a.src, 'aaa');
});

test('oversized results reach consumers without entering the cache or poisoning future requests', async () => {
  const h = setup({ maxBytes: 10 });
  const first = await h.render(1);
  assert.ok(first?.src);
  assert.equal(h.cache.size, 0);
  assert.equal(h.cache.bytes, 0);
  assert.ok(await h.render(1));
  assert.equal(h.calls.renders, 2);
});

test('rotation, mirror, annotation mode and resolution each keep distinct rendered results', async () => {
  const h = setup();
  const options = [{}, { rotation: 90 }, { mirrorH: true }, { mirrorV: true },
    { withAnnotations: false }, { targetWidth: 1600 }];
  const images = await Promise.all(options.map((opts) => h.render(1, opts)));
  assert.equal(h.calls.renders, options.length);
  for (let i = 0; i < options.length; i++) assert.equal(await h.render(1, options[i]), images[i]);
  assert.equal(h.calls.renders, options.length);
});

test('mounted document changes clear old entries and reject old callbacks and late renders', async (t) => {
  const dom = new JSDOM('<div id="root"></div>');
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const initStart = source.indexOf('  const printPanelRenderCacheRef =');
  const initEnd = source.indexOf('  // Reset the Auto-rotation cache', initStart);
  const hook = new Function('useRef', 'useEffect', 'useCallback', 'createPrintPreviewCache', 'pdfDoc', 'document', 'console',
    `${source.slice(initStart, initEnd)}\n${callbackSource}\nreturn { render: printPanelGetThumbnail, cache: printPanelRenderCacheRef.current };`);
  let latest;
  const h = setup();
  function Probe({ pdfDoc }) {
    latest = hook(useRef, useEffect, useCallback, createPrintPreviewCache, pdfDoc, h.deps.document, h.deps.console);
    return null;
  }
  const root = createRoot(dom.window.document.getElementById('root'));
  let release;
  t.after(async () => {
    release?.();
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Probe, { pdfDoc: h.pdfDoc }))));
  assert.ok(await latest.render(1), 'StrictMode cleanup/setup leaves the current document usable');
  const old = latest;
  const originalGetPage = h.pdfDoc.getPage;
  h.pdfDoc.getPage = async (...args) => {
    await new Promise((resolve) => { release = resolve; });
    return originalGetPage(...args);
  };
  const pending = old.render(2);
  await act(async () => {});
  const next = setup();
  await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Probe, { pdfDoc: next.pdfDoc }))));
  assert.equal(old.cache.size, 0);
  assert.equal(latest.cache.size, 0);
  assert.equal(await old.render(1), null, 'retired callback cannot read or write the current document cache');
  release();
  assert.equal(await pending, null);
  assert.equal(latest.cache.size, 0, 'late old render did not populate new source cache');
  assert.ok(await latest.render(1));
  assert.equal(next.calls.renders, 1);
});
