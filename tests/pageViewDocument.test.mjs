// Owner 2026-10-01 (instant page operations): the in-memory page view the
// viewer shows right after a page operation must be exactly what the
// background pdf-lib rewrite produces, operation for operation.
import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';

import {
  applyPageViewOperation,
  getPageViewBase,
  getPageViewSizes,
  pageViewKey,
  pageViewUprightKey,
} from '../src/utils/pageViewDocument.js';
import { mutatePdfPagesBatch } from '../src/utils/pdfPageMutation.js';

const WIDTHS = [100, 200, 300, 400, 500];
const HEIGHT = 700;

function fakeBase() {
  const pages = new Map();
  const getPage = async (n) => {
    if (!pages.has(n)) {
      const width = WIDTHS[n - 1];
      pages.set(n, {
        pageNumber: n,
        rotate: 0,
        view: [0, 0, width, HEIGHT],
        userUnit: 1,
        getViewport({ scale = 1, rotation = 0 } = {}) {
          const turned = ((rotation % 360) + 360) % 360 % 180 !== 0;
          return { width: (turned ? HEIGHT : width) * scale, height: (turned ? width : HEIGHT) * scale, rotation };
        },
      });
    }
    return pages.get(n);
  };
  return {
    numPages: WIDTHS.length,
    fingerprints: ['base-fp', null],
    getPage,
    getPageIndex: async (ref) => ref.index,
    destroyed: false,
    destroy() { this.destroyed = true; },
  };
}

async function basePagesByNumber(base) {
  const pages = {};
  for (let n = 1; n <= base.numPages; n += 1) pages[n] = await base.getPage(n);
  return pages;
}

async function viewSignature(view) {
  const out = [];
  for (let n = 1; n <= view.numPages; n += 1) {
    const page = await view.getPage(n);
    out.push({ width: Math.round(page.view[2] - page.view[0]), rotation: ((page.rotate % 360) + 360) % 360 });
  }
  return out;
}

async function bytesSignature(bytes) {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((page) => ({
    width: Math.round(page.getWidth()),
    rotation: page.getRotation().angle,
  }));
}

async function fixtureBytes() {
  const pdf = await PDFDocument.create();
  WIDTHS.forEach((width) => pdf.addPage([width, HEIGHT]));
  return pdf.save();
}

function randomOperation(count, random) {
  const page = () => 1 + Math.floor(random() * count);
  const kinds = count > 1
    ? ['move', 'delete', 'insert', 'duplicate', 'copy', 'rotate']
    : ['move', 'insert', 'duplicate', 'copy', 'rotate'];
  const type = kinds[Math.floor(random() * kinds.length)];
  if (type === 'move') return { type, from: page(), to: page() };
  if (type === 'delete') return { type, page: page() };
  // Slot 0 = above the first page (insert / paste above page 1).
  const slot = () => Math.floor(random() * (count + 1));
  if (type === 'insert') return { type, afterPage: slot() };
  if (type === 'duplicate') return { type, page: page() };
  if (type === 'copy') return { type, source: page(), afterPage: slot() };
  return { type, page: page(), delta: random() < 0.5 ? 90 : -90 };
}

function seeded(seed) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

test('page view matches the pdf-lib rewrite for random operation sequences', async () => {
  const original = await fixtureBytes();
  for (let seed = 1; seed <= 25; seed += 1) {
    const random = seeded(seed);
    const base = fakeBase();
    const pagesByNumber = await basePagesByNumber(base);
    let view = base;
    const operations = [];
    for (let step = 0; step < 6; step += 1) {
      const operation = randomOperation(view.numPages, random);
      operations.push(operation);
      view = applyPageViewOperation(view, operation, { pagesByNumber });
    }
    const bytes = await mutatePdfPagesBatch(original, operations);
    assert.deepEqual(
      await viewSignature(view),
      await bytesSignature(bytes),
      `seed ${seed}: ${JSON.stringify(operations)}`,
    );
    assert.equal(getPageViewBase(view), base);
  }
});

test('a page view reuses the base pages and never destroys the base document', async () => {
  const base = fakeBase();
  const pageOne = await base.getPage(1);
  const view = applyPageViewOperation(base, { type: 'move', from: 1, to: 3 });
  assert.equal(view.numPages, 5);
  const moved = await view.getPage(3);
  assert.equal(moved.view, pageOne.view);
  assert.equal(moved.pageNumber, 3);
  assert.equal(pageViewKey(view, 2), '0');
  await view.destroy();
  assert.equal(base.destroyed, false);
  // Fingerprints are versioned so page-number keyed caches never alias.
  assert.notEqual(view.fingerprints[0], base.fingerprints[0]);
});

test('rotation turns the viewport and swaps the known size', async () => {
  const base = fakeBase();
  const view = applyPageViewOperation(base, { type: 'rotate', page: 2, delta: 90 }, {
    sizesByPage: { 1: { width: 100, height: 700 }, 2: { width: 200, height: 700 } },
  });
  const page = await view.getPage(2);
  assert.equal(page.rotate, 90);
  assert.deepEqual(page.getViewport({ scale: 1 }), { width: 700, height: 200, rotation: 90 });
  assert.deepEqual(getPageViewSizes(view)[2], { width: 700, height: 200 });
  assert.deepEqual(pageViewUprightKey(view, 1), { key: '1', rotation: 90 });
  assert.equal(pageViewKey(view, 1), '1r90');
});

test('links into a moved page resolve to its new number; a deleted target rejects', async () => {
  const base = fakeBase();
  const moved = applyPageViewOperation(base, { type: 'move', from: 4, to: 1 });
  assert.equal(await moved.getPageIndex({ index: 3 }), 0);
  const removed = applyPageViewOperation(moved, { type: 'delete', page: 1 });
  await assert.rejects(removed.getPageIndex({ index: 3 }));
});

test('an inserted blank page renders white and has no text', async () => {
  const base = fakeBase();
  const pagesByNumber = await basePagesByNumber(base);
  const view = applyPageViewOperation(base, { type: 'insert', afterPage: 2 }, { pagesByNumber });
  const blank = await view.getPage(3);
  assert.deepEqual(blank.view, [0, 0, 200, 700]);
  const text = await blank.getTextContent();
  assert.deepEqual(text.items, []);
  assert.deepEqual(await blank.getAnnotations(), []);
  const calls = [];
  const ctx = {
    canvas: { width: 10, height: 20 },
    save() {}, restore() {}, setTransform() {},
    fillRect: (...args) => calls.push(args),
    set fillStyle(value) { calls.push(value); },
  };
  await blank.render({ canvasContext: ctx, viewport: blank.getViewport({ scale: 1 }) }).promise;
  assert.deepEqual(calls, ['#ffffff', [0, 0, 10, 20]]);
});
