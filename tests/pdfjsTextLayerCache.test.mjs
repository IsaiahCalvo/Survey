// 2026-10-28 (Spaces speed): a page's text layer is kept when the page leaves
// and put back when it returns at the same size, and a layer that has to be
// built reaches pdf.js a slice per task (src/utils/pdfjsTextLayerCache.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  keepTextLayer,
  restoreTextLayer,
  textContentInSlices,
  textLayerKey,
} from '../src/utils/pdfjsTextLayerCache.js';

const { document } = new JSDOM('<!doctype html><body></body>').window;

function builtLayer(spans = 3) {
  const el = document.createElement('div');
  el.setAttribute('style', '--scale-factor: 1.5; width: 100px; height: 200px;');
  el.setAttribute('data-main-rotation', '90');
  for (let i = 0; i < spans; i += 1) {
    const span = document.createElement('span');
    span.textContent = `run ${i}`;
    el.append(span);
  }
  return el;
}

const content = (n) => ({ items: Array.from({ length: n }, (_, i) => ({ str: `run ${i}` })), styles: {}, lang: null });

test('a kept layer comes back as the same nodes, with the size pdf.js wrote, once', () => {
  const pdf = {};
  const el = builtLayer();
  const spans = [...el.children];
  const text = content(3);
  assert.equal(keepTextLayer(pdf, textLayerKey(4, 1.5, 0), el, text), true);
  assert.equal(el.childNodes.length, 0, 'moved out, not copied');

  const next = document.createElement('div');
  next.append(document.createElement('span'));
  assert.equal(restoreTextLayer(pdf, textLayerKey(4, 1.5, 0), next), text);
  assert.deepEqual([...next.children], spans, 'the same nodes: nothing measured again');
  assert.equal(next.getAttribute('style'), el.getAttribute('style'));
  assert.equal(next.getAttribute('data-main-rotation'), '90');
  assert.equal(restoreTextLayer(pdf, textLayerKey(4, 1.5, 0), document.createElement('div')), null, 'used once');
});

test('another scale, rotation, page or document builds its own', () => {
  const pdf = {};
  keepTextLayer(pdf, textLayerKey(4, 1.5, 0), builtLayer(), content(3));
  const el = document.createElement('div');
  assert.equal(restoreTextLayer(pdf, textLayerKey(4, 2, 0), el), null);
  assert.equal(restoreTextLayer(pdf, textLayerKey(4, 1.5, 90), el), null);
  assert.equal(restoreTextLayer(pdf, textLayerKey(5, 1.5, 0), el), null);
  assert.equal(restoreTextLayer({}, textLayerKey(4, 1.5, 0), el), null);
  assert.ok(restoreTextLayer(pdf, textLayerKey(4, 1.5, 0), el));
});

test('kept layers are capped, oldest out first', () => {
  const pdf = {};
  for (let page = 1; page <= 60; page += 1) keepTextLayer(pdf, textLayerKey(page, 1, 0), builtLayer(1), content(1));
  const el = document.createElement('div');
  assert.equal(restoreTextLayer(pdf, textLayerKey(1, 1, 0), el), null, 'the oldest went');
  assert.ok(restoreTextLayer(pdf, textLayerKey(60, 1, 0), el), 'the newest stayed');

  // Also by glyph runs: two big layers do not both stay.
  const big = {};
  keepTextLayer(big, 'a', builtLayer(1), content(40_000));
  keepTextLayer(big, 'b', builtLayer(1), content(40_000));
  assert.equal(restoreTextLayer(big, 'a', el), null);
  assert.ok(restoreTextLayer(big, 'b', el));
});

// Reads the stream the way pdf.js's TextLayer does: lay out a slice, then ask
// for the next one at once.
async function readLikeTextLayer(stream, layOut) {
  const reader = stream.getReader();
  const slices = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return slices;
    slices.push(value);
    layOut(value);
  }
}

test('a layer to build reaches pdf.js a slice per task, every item once, in order', async () => {
  const text = { items: content(1000).items, styles: { f1: { fontFamily: 'sans-serif' } }, lang: 'en' };
  let otherTaskRuns = 0;
  const timer = setInterval(() => { otherTaskRuns += 1; }, 0);
  const slices = await readLikeTextLayer(textContentInSlices(text), () => {});
  clearInterval(timer);
  assert.ok(slices.length > 1, 'more than one slice');
  assert.deepEqual(slices.flatMap((slice) => slice.items), text.items);
  assert.equal(slices[0].styles, text.styles, 'the fonts come with the first slice');
  assert.ok(slices.every((slice) => slice.lang === 'en'));
  assert.ok(otherTaskRuns > 0, 'other tasks ran between slices');
});

test('a slow slice makes the next one smaller', async () => {
  const text = content(2000);
  const sizes = [];
  await readLikeTextLayer(textContentInSlices(text), (slice) => {
    sizes.push(slice.items.length);
    const until = performance.now() + (sizes.length === 1 ? 32 : 0);
    while (performance.now() < until) { /* a slow PC laying out the slice */ }
  });
  assert.equal(sizes[0], 64);
  assert.ok(sizes[1] < sizes[0], `${sizes[1]} < ${sizes[0]}`);
});

test('an empty page and a cancelled build both finish', async () => {
  const empty = await readLikeTextLayer(textContentInSlices({ items: [] }), () => {});
  assert.equal(empty.length, 1);
  assert.equal(empty[0].items.length, 0);

  const reader = textContentInSlices(content(1000)).getReader();
  await reader.read();
  await reader.cancel(new Error('cancelled'));
  assert.deepEqual(await reader.read(), { value: undefined, done: true });
});
