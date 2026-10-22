// Speed round 4 (2026-10-22): the open-tail thumbnail capture.
//
// A few seconds after a dense document opened, the viewer's page-1 thumbnail
// capture ran as one ~170ms main-thread task (hash page 1 twice, paint 667
// marks, toDataURL), and on a reopen it repainted and rewrote a thumbnail that
// was already current. These tests pin the fix:
//   * the sliced painter draws exactly what the one-shot painter draws, in the
//     same order, and gives the main thread back between marks;
//   * the sliced compose matches the one-shot compose and stops cleanly;
//   * the async encode keeps the WebP / JPEG-fallback contract;
//   * the capture hook checks the cached thumbnail before painting even when
//     the bare page was already rendered, and paints in slices when it must.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { transformWithOxc } from 'vite';
import {
  paintAnnotationCanvas,
  paintAnnotationCanvasInSlices,
} from '../src/utils/annotationCanvasPainter.js';
import {
  composeThumbnail,
  composeThumbnailInSlices,
  encodeThumbnailAsync,
} from '../src/services/thumbnailRender.js';
import { applyCalloutListToByPage, deriveCalloutsFromByPage } from '../src/utils/calloutAnnotationBridge.js';
import { computeThumbnailSignature } from '../src/services/thumbnailSignature.js';

const require = createRequire(import.meta.url);
const PAGE = { width: 612, height: 792 };

// Every call and property write, in order.
function recordingContext(log = []) {
  const target = {
    measureText: (text) => ({ width: String(text).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    getLineDash: () => [],
    createLinearGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    canvas: { width: 720, height: 480 },
  };
  const context = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) {
        const value = obj[prop];
        if (typeof value !== 'function') return value;
        return (...args) => { log.push([String(prop), JSON.stringify(args)]); return value(...args); };
      }
      return (...args) => { log.push([String(prop), JSON.stringify(args)]); };
    },
    set(obj, prop, value) {
      log.push([`=${String(prop)}`, JSON.stringify(value)]);
      obj[prop] = value;
      return true;
    },
  });
  return { context, log };
}

function denseMarkup(count = 60) {
  const objects = [];
  for (let i = 0; i < count; i += 1) {
    const left = 20 + ((i * 37) % 500);
    const top = 20 + ((i * 61) % 700);
    const id = `m${i}`;
    switch (i % 4) {
      case 0: {
        const path = [['M', left, top]];
        for (let k = 1; k < 12; k += 1) path.push(['Q', left + k * 2, top + (k % 9) * 3, left + k * 2 + 1, top + (k % 7) * 3]);
        objects.push({ type: 'path', path, left, top, width: 24, height: 30, stroke: '#d22', fill: null, strokeWidth: 3, data: { id, type: 'ink' } });
        break;
      }
      case 1:
        objects.push({ type: 'rect', left, top, width: 40, height: 30, stroke: '#1565c0', fill: 'transparent', strokeWidth: 2, data: { id } });
        break;
      case 2:
        objects.push({ type: 'ellipse', left, top, rx: 20, ry: 12, stroke: '#2e7d32', fill: 'transparent', strokeWidth: 2, data: { id } });
        break;
      default:
        objects.push({ type: 'line', x1: left, y1: top, x2: left + 50, y2: top + 20, left, top, width: 50, height: 20, stroke: '#333', strokeWidth: 2, data: { id } });
    }
  }
  let byPage = { 1: { objects } };
  byPage = applyCalloutListToByPage(byPage, [{
    id: 'c1', pageNumber: 1,
    arrowTip: { x: 0.5, y: 0.25 }, knee: { x: 0.3, y: 0.5 }, textBoxPosition: { x: 0.1, y: 0.6 },
    textBoxWidth: 0.2, textBoxHeight: 0.1, text: 'callout',
    style: { fontFamily: 'Arial', fontSize: 12, borderColor: '#00ff00', lineThickness: 2 },
  }], { 1: PAGE });
  // Put the callout's slot in the middle of the stack.
  const all = byPage[1].objects;
  const calloutAt = all.findIndex((o) => o?.data?.type === 'callout');
  const [projected] = all.splice(calloutAt, 1);
  all.splice(Math.floor(all.length / 2), 0, projected);
  return { objects: all, callouts: deriveCalloutsFromByPage(byPage) };
}

const paintOptions = ({ objects, callouts }) => ({
  canvasWidth: 720, canvasHeight: 480, drawScale: 720 / PAGE.width, drawScaleY: 480 / PAGE.height,
  displayScale: 720 / PAGE.width, pageWidth: PAGE.width, pageHeight: PAGE.height, objects, callouts,
});

test('sliced paint draws exactly what the one-shot paint draws, and yields between marks', async () => {
  const markup = denseMarkup();
  const whole = recordingContext();
  const expected = paintAnnotationCanvas(whole.context, paintOptions(markup));
  assert.ok(whole.log.length > 200, 'the fixture paints something');

  // A clock that jumps past the budget on every read: a yield before every mark.
  const sliced = recordingContext();
  let clock = 0;
  let yields = 0;
  const result = await paintAnnotationCanvasInSlices(sliced.context, paintOptions(markup), {
    budgetMs: 10,
    now: () => { clock += 50; return clock; },
    yieldFn: async () => { yields += 1; },
  });
  assert.deepEqual(sliced.log, whole.log, 'same calls, same order');
  assert.deepEqual(result, expected);
  assert.ok(yields >= markup.objects.length - 1, `yielded between marks (${yields})`);

  // A budget the paint never reaches: no yields at all.
  const quick = recordingContext();
  let quickYields = 0;
  await paintAnnotationCanvasInSlices(quick.context, paintOptions(markup), {
    budgetMs: 1e9, yieldFn: async () => { quickYields += 1; },
  });
  assert.equal(quickYields, 0);
  assert.deepEqual(quick.log, whole.log);
});

test('sliced paint stops between marks once cancelled', async () => {
  const markup = denseMarkup();
  const { context, log } = recordingContext();
  let clock = 0;
  let yields = 0;
  const result = await paintAnnotationCanvasInSlices(context, paintOptions(markup), {
    budgetMs: 10,
    now: () => { clock += 50; return clock; },
    yieldFn: async () => { yields += 1; },
    isCancelled: () => yields >= 3,
  });
  assert.equal(result, null);
  const whole = recordingContext();
  paintAnnotationCanvas(whole.context, paintOptions(markup));
  assert.ok(log.length < whole.log.length / 4, 'stopped early');
});

function withCanvasDocument(t) {
  const canvases = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: {
      createElement(tag) {
        assert.equal(tag, 'canvas');
        const { context, log } = recordingContext();
        const canvas = { width: 300, height: 150, log, getContext: () => context };
        canvases.push(canvas);
        return canvas;
      },
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
  return canvases;
}

test('sliced compose paints the same overlay as the one-shot compose', async (t) => {
  const canvases = withCanvasDocument(t);
  const markup = denseMarkup();
  const base = { canvas: { width: 720, height: 480 }, pageWidth: PAGE.width, pageHeight: PAGE.height, aspect: PAGE.width / PAGE.height };

  composeThumbnail(base, markup);
  const [wholeOut, wholeOverlay] = canvases.splice(0);
  const out = await composeThumbnailInSlices(base, markup, { budgetMs: 0, yieldFn: async () => {} });
  const [slicedOverlay, slicedOut] = canvases.splice(0);
  assert.ok(out === slicedOut);
  const paints = (log) => log.filter(([name]) => name !== 'drawImage');
  assert.deepEqual(paints(slicedOverlay.log), paints(wholeOverlay.log));
  // Page first, then the markup layer, on the image that is returned.
  assert.deepEqual(slicedOut.log.map(([name]) => name), wholeOut.log.map(([name]) => name));
  assert.deepEqual(slicedOut.log.map(([name]) => name), ['drawImage', 'drawImage']);
  assert.equal(slicedOverlay.width, 1, 'overlay released');

  // Cancelled mid-paint (document closed): nothing returned, overlay released.
  let yields = 0;
  const cancelled = await composeThumbnailInSlices(base, markup, {
    budgetMs: 0, yieldFn: async () => { yields += 1; }, isCancelled: () => yields > 2,
  });
  assert.equal(cancelled, null);
  const [cancelledOverlay, ...rest] = canvases.splice(0);
  assert.equal(cancelledOverlay.width, 1);
  assert.equal(rest.length, 0, 'no output canvas allocated');
});

test('async encode keeps WebP, falls back to JPEG where WebP cannot be encoded', async (t) => {
  class FakeReader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
        this.onload();
      });
    }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'FileReader');
  Object.defineProperty(globalThis, 'FileReader', { configurable: true, writable: true, value: FakeReader });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'FileReader', previous);
    else delete globalThis.FileReader;
  });
  const requests = [];
  const canvas = (supportsWebp) => ({
    toBlob(callback, type, quality) {
      requests.push([type, quality]);
      const actual = type === 'image/webp' && !supportsWebp ? 'image/png' : type;
      setTimeout(() => callback(new Blob(['px'], { type: actual })), 0);
    },
    toDataURL() { throw new Error('the async path must not encode on the main thread'); },
  });
  assert.equal(await encodeThumbnailAsync(canvas(true)), `data:image/webp;base64,${Buffer.from('px').toString('base64')}`);
  assert.deepEqual(requests.splice(0), [['image/webp', 0.8]]);
  assert.match(await encodeThumbnailAsync(canvas(false)), /^data:image\/jpeg;base64,/);
  assert.deepEqual(requests.splice(0), [['image/webp', 0.8], ['image/jpeg', 0.82]]);
  // No toBlob (old WebViews): the synchronous encode.
  const legacy = { toDataURL: (type) => `data:${type};base64,AA` };
  assert.equal(await encodeThumbnailAsync(legacy), 'data:image/webp;base64,AA');
});

// ---------------------------------------------------------------------------
// The capture hook, mounted with its I/O stubbed.
// ---------------------------------------------------------------------------

let moduleId = 0;
const fileHref = (relative) => JSON.stringify(new URL(relative, import.meta.url).href);

async function loadHook() {
  const url = new URL('../src/hooks/useDocumentThumbnailCapture.js', import.meta.url);
  const original = await readFile(url, 'utf8');
  const replace = (text, from, to) => {
    assert.ok(text.includes(from), `hook source still has: ${from}`);
    return text.replace(from, to);
  };
  let source = original;
  source = replace(source, "from 'react'", `from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)}`);
  source = replace(source, "import { thumbnailStore, thumbCacheKey } from '../services/thumbnailStore';",
    'const thumbnailStore = () => globalThis.__thumbCapture.store; const thumbCacheKey = (doc) => `${doc.id}::${doc.content_sha256}`;');
  source = replace(source, "from '../services/thumbnailSignature'", `from ${fileHref('../src/services/thumbnailSignature.js')}`);
  source = replace(source, "import { publishThumbnailUpdate } from '../services/thumbnailEvents';", 'const publishThumbnailUpdate = () => {};');
  source = replace(source, "import { isUserBusy } from '../services/userActivity';", 'const isUserBusy = () => false;');
  source = replace(source, "import { preloadAnnotationImages } from '../utils/annotationImageCache.js';", 'const preloadAnnotationImages = async () => true;');
  const renderImport = source.slice(source.indexOf('import {\n  composeThumbnail,'), source.indexOf("} from '../services/thumbnailRender';") + "} from '../services/thumbnailRender';".length);
  assert.ok(renderImport.startsWith('import {'), 'thumbnailRender import found');
  source = source.replace(renderImport, `const {
    composeThumbnail, composeThumbnailInSlices, encodeThumbnail, encodeThumbnailAsync,
    releaseCanvas, renderPageToCanvas, selectPageOneMarkup,
  } = globalThis.__thumbCapture.render;`);
  // Test-speed delays (same order as the real ones).
  source = replace(source, 'export const THUMB_OPEN_DELAY_MS = 2500;', 'export const THUMB_OPEN_DELAY_MS = 20;');
  source = replace(source, 'export const THUMB_SETTLE_MS = 3000;', 'export const THUMB_SETTLE_MS = 40;');
  source = replace(source, 'const BUSY_RETRY_MS = 1500;', 'const BUSY_RETRY_MS = 10;');
  assert.ok(source.includes('setTimeout(prepare, 600);'));
  source = source.replaceAll('setTimeout(prepare, 600);', 'setTimeout(prepare, 5);');
  const transformed = await transformWithOxc(source, fileURLToPath(url), { lang: 'js' });
  return import(`data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}#${++moduleId}`);
}

async function mountCapture(t, { stored = null } = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
  const calls = { get: 0, put: [], renders: 0, sliced: 0, sync: 0, encodeAsync: 0, encodeSync: 0 };
  const harness = {
    store: {
      get: async () => { calls.get += 1; return stored; },
      put: async (key, value) => { calls.put.push({ key, value }); return true; },
    },
    render: {
      selectPageOneMarkup: (page, callouts = []) => ({ objects: page?.objects || [], callouts }),
      renderPageToCanvas: async () => {
        calls.renders += 1;
        return { canvas: { width: 720, height: 932 }, aspect: PAGE.width / PAGE.height, pageWidth: PAGE.width, pageHeight: PAGE.height, rotate: 0 };
      },
      composeThumbnail: () => { calls.sync += 1; return { width: 720, height: 932 }; },
      composeThumbnailInSlices: async () => { calls.sliced += 1; await harness.paintGate; return { width: 720, height: 932 }; },
      encodeThumbnail: () => { calls.encodeSync += 1; return 'data:image/webp;base64,SYNC'; },
      encodeThumbnailAsync: async () => { calls.encodeAsync += 1; return 'data:image/webp;base64,ASYNC'; },
      releaseCanvas: () => {},
    },
  };
  const previous = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true, __thumbCapture: harness,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { useDocumentThumbnailCapture } = await loadHook();
  const pdfDoc = { numPages: 3, getPage: async () => ({ getViewport: () => ({ ...PAGE }), rotate: 0 }) };
  const pdfFile = { id: 'doc-1', contentSha256: 'sha-1', size: 4096 };
  function Probe(props) { useDocumentThumbnailCapture(props); return null; }
  const root = createRoot(document.getElementById('root'));
  let props = { pdfFile, pdfDoc, pageOneAnnotations: { objects: [] }, callouts: [], hydrationReady: true };
  const render = async (next = {}) => {
    props = { ...props, ...next };
    await act(async () => { root.render(React.createElement(Probe, props)); });
  };
  const wait = (ms) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const signatureOf = (objects) => computeThumbnailSignature({
    fileStamp: 'doc-1::sha-1',
    pdf: { numPages: 3, width: PAGE.width, height: PAGE.height, rotate: 0, byteLength: 4096 },
    objects,
    callouts: [],
  });
  // The viewer mounts before page 1's marks hydrate.
  await render();
  return { calls, render, wait, signatureOf, harness };
}

const marks = () => [
  { type: 'rect', left: 1, top: 2, width: 3, height: 4, stroke: '#f00', data: { id: 'a' } },
  { type: 'ellipse', left: 5, top: 6, rx: 7, ry: 8, stroke: '#0f0', data: { id: 'b' } },
];

test('reopen: an up-to-date cached thumbnail is not repainted, even with the page pre-rendered', async (t) => {
  const objects = marks();
  // Built before mounting, from what the hook will hash.
  const expected = computeThumbnailSignature({
    fileStamp: 'doc-1::sha-1',
    pdf: { numPages: 3, width: PAGE.width, height: PAGE.height, rotate: 0, byteLength: 4096 },
    objects,
    callouts: [],
  });
  const h = await mountCapture(t, { stored: { url: 'data:image/webp;base64,OLD', signature: expected } });
  // The marks hydrate after the viewer mounts: the hook renders the bare page
  // for a later flush, then captures once the markup settles.
  await h.render({ pageOneAnnotations: { objects } });
  await h.wait(200);
  assert.equal(h.calls.renders, 1, 'bare page rendered (for a later flush)');
  assert.ok(h.calls.get >= 1, 'the cached thumbnail was checked');
  assert.equal(h.calls.put.length, 0, 'nothing rewritten');
  assert.equal(h.calls.sliced + h.calls.sync, 0, 'nothing repainted');
});

test('stale thumbnail: painted in slices, encoded off the main thread, written once', async (t) => {
  const h = await mountCapture(t, { stored: null });
  const objects = marks();
  await h.render({ pageOneAnnotations: { objects } });
  await h.wait(200);
  assert.equal(h.calls.put.length, 1);
  assert.equal(h.calls.put[0].value.signature, h.signatureOf(objects));
  assert.equal(h.calls.put[0].value.url, 'data:image/webp;base64,ASYNC');
  assert.equal(h.calls.sliced, 1);
  assert.equal(h.calls.sync, 0);
  assert.equal(h.calls.encodeSync, 0);

  // An edit after that: no cache read (we wrote it), one more sliced write.
  const gets = h.calls.get;
  const edited = [...objects, { type: 'rect', left: 9, top: 9, width: 9, height: 9, stroke: '#00f', data: { id: 'c' } }];
  await h.render({ pageOneAnnotations: { objects: edited } });
  await h.wait(200);
  assert.equal(h.calls.get, gets);
  assert.equal(h.calls.put.length, 2);
  assert.equal(h.calls.put[1].value.signature, h.signatureOf(edited));
  assert.equal(h.calls.sliced, 2);
});

test('a leave-the-document flush is never overwritten by an older background capture', async (t) => {
  const h = await mountCapture(t, { stored: null });
  // Hold the background paint until the flush has written.
  let releasePaint;
  h.harness.paintGate = new Promise((resolve) => { releasePaint = resolve; });
  const objects = marks();
  await h.render({ pageOneAnnotations: { objects } });
  await h.wait(200);
  assert.equal(h.calls.sliced, 1, 'background capture is painting');
  // A newer edit, then the user leaves before it settles.
  const edited = [...objects, { type: 'rect', left: 9, top: 9, width: 9, height: 9, stroke: '#00f', data: { id: 'c' } }];
  await h.render({ pageOneAnnotations: { objects: edited } });
  await act(async () => { document.dispatchEvent(new window.Event('visibilitychange')); });
  assert.equal(h.calls.put.length, 1, 'the flush wrote');
  assert.equal(h.calls.put[0].value.signature, h.signatureOf(edited));
  releasePaint();
  await h.wait(100);
  assert.equal(h.calls.put.length, 1, 'the older capture did not overwrite it');
});
