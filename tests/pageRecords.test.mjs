// Pages as records (Nightly 'page-records', src/utils/pageRecords.js): the
// PDF built on the way out (base bytes + the page list) must show exactly
// the pages the viewer showed, in order, at the same turn.
import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, degrees } from 'pdf-lib';

import {
  isIdentityPageRecords,
  normalizePageRecords,
  pageRecordsFitBase,
  pageRecordsToOperations,
  pageRecordsValue,
} from '../src/utils/pageRecords.js';
import {
  applyPageViewOperation,
  pageViewFromRecords,
  pageViewRecords,
} from '../src/utils/pageViewDocument.js';
import { mutatePdfPagesBatch } from '../src/utils/pdfPageMutation.js';

const BASE_COUNT = 6;
const sizeOf = (n) => ({ width: 100 + n * 10, height: 300 + n * 7 });
const ownTurn = (n) => (n === 3 ? 90 : 0);

async function basePdf() {
  const pdf = await PDFDocument.create();
  for (let n = 1; n <= BASE_COUNT; n += 1) {
    const { width, height } = sizeOf(n);
    const page = pdf.addPage([width, height]);
    page.setRotation(degrees(ownTurn(n)));
  }
  return pdf.save();
}

async function describe(bytes) {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((page) => {
    const { width, height } = page.getSize();
    return { width: Math.round(width), height: Math.round(height), turn: page.getRotation().angle % 360 };
  });
}

function expected(records) {
  return records.map((record) => (record.blank
    ? { width: record.blank.width, height: record.blank.height, turn: record.rot % 360 }
    : { ...sizeOf(record.src), turn: (ownTurn(record.src) + record.rot) % 360 }));
}

async function build(baseBytes, records) {
  const { operations, needsBaseBytes } = pageRecordsToOperations(records, BASE_COUNT);
  const steps = needsBaseBytes
    ? operations.map((op) => (op.type === 'restore' && !op.entry.blank ? { ...op, baseBytes: baseBytes.slice(0) } : op))
    : operations;
  return { bytes: await mutatePdfPagesBatch(baseBytes.slice(0), steps), operations };
}

test('the built PDF matches the list: moves, deletes, turns, copies and blanks', async () => {
  const base = await basePdf();
  const cases = [
    [{ src: 1, rot: 0 }, { src: 2, rot: 0 }, { src: 3, rot: 0 }, { src: 4, rot: 0 }, { src: 5, rot: 0 }, { src: 6, rot: 0 }],
    [{ src: 2, rot: 0 }, { src: 3, rot: 0 }, { src: 4, rot: 0 }, { src: 5, rot: 0 }, { src: 6, rot: 0 }],
    [{ src: 6, rot: 90 }, { src: 1, rot: 0 }, { src: 3, rot: 270 }],
    [{ src: 2, rot: 0 }, { src: 2, rot: 180 }, { src: 5, rot: 0 }],
    [{ src: null, rot: 0, blank: { width: 612, height: 792 } }, { src: 4, rot: 90 }],
    [{ src: null, rot: 90, blank: { width: 200, height: 400 } }],
    [{ src: 1, rot: 0 }, { src: 1, rot: 0 }, { src: 1, rot: 0 }],
  ];
  for (const records of cases) {
    const { bytes } = await build(base, records);
    assert.deepEqual(await describe(bytes), expected(records.map((r) => ({ blank: null, ...r }))), JSON.stringify(records));
  }
});

test('random lists made by page operations build the PDF the view shows', async () => {
  const base = await basePdf();
  // A stand-in pdf.js document: only numPages is read by the view.
  const doc = { numPages: BASE_COUNT, getPage: async () => ({}) };
  let seed = 7;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let round = 0; round < 25; round += 1) {
    let view = doc;
    for (let step = 0; step < 6; step += 1) {
      const count = view.numPages;
      const kind = rand(5);
      let op;
      if (kind === 0 && count > 1) op = { type: 'delete', page: rand(count) + 1 };
      else if (kind === 1) op = { type: 'move', from: rand(count) + 1, to: rand(count) + 1 };
      else if (kind === 2) op = { type: 'rotate', page: rand(count) + 1, delta: [90, -90, 180][rand(3)] };
      else if (kind === 3) op = { type: 'duplicate', page: rand(count) + 1 };
      else op = { type: 'restore', afterPage: rand(count + 1), entry: { src: null, rot: 0, blank: { width: 250, height: 350 } } };
      view = applyPageViewOperation(view, op);
    }
    const records = pageViewRecords(view);
    const { bytes } = await build(base, records);
    assert.deepEqual(await describe(bytes), expected(records), `round ${round}: ${JSON.stringify(records)}`);
  }
});

test('pages that only stay or move are moved, never copied', () => {
  const { operations, needsBaseBytes } = pageRecordsToOperations(
    [{ src: 3, rot: 0 }, { src: 1, rot: 0 }, { src: 2, rot: 90 }, { src: 4, rot: 0 }, { src: 5, rot: 0 }, { src: 6, rot: 0 }],
    BASE_COUNT,
  );
  assert.equal(needsBaseBytes, false);
  assert.deepEqual(operations, [{ type: 'move', from: 3, to: 1 }, { type: 'rotate', page: 3, delta: 90 }]);
  // Deleting page 1 is one step, not a move of every page after it.
  const del = pageRecordsToOperations([2, 3, 4, 5, 6].map((src) => ({ src, rot: 0 })), BASE_COUNT);
  assert.deepEqual(del.operations, [{ type: 'delete', page: 1 }]);
});

test('a list is only used over the bytes it was made for', () => {
  const value = pageRecordsValue({ writer: 'w1', sha: 'abc', path: 'u/d.pdf', pages: [{ src: 2, rot: 90 }, { src: 1, rot: 0 }] });
  assert.equal(pageRecordsFitBase(value, 'abc', 2), true);
  assert.equal(pageRecordsFitBase(value, 'other', 2), false);
  assert.equal(pageRecordsFitBase(value, 'abc', 1), false, 'names page 2 of a one-page PDF');
  assert.equal(normalizePageRecords({ ...value, pages: [{ src: 1, rot: 45 }] }), null);
  assert.equal(normalizePageRecords({ ...value, base: {} }), null);
  assert.equal(isIdentityPageRecords([{ src: 1, rot: 0 }, { src: 2, rot: 0 }], 2), true);
  assert.equal(isIdentityPageRecords([{ src: 1, rot: 90 }, { src: 2, rot: 0 }], 2), false);
});

test('another window\'s list shows over this window\'s base, with sizes carried over', () => {
  const doc = { numPages: 3, getPage: async () => ({}) };
  const sizes = { 1: { width: 100, height: 200 }, 2: { width: 300, height: 400 }, 3: { width: 500, height: 600 } };
  const turned = applyPageViewOperation(doc, { type: 'rotate', page: 2, delta: 90 }, { sizesByPage: sizes });
  const view = pageViewFromRecords(turned, [{ src: 2, rot: 0 }, { src: 1, rot: 90 }, { src: null, rot: 0, blank: { width: 50, height: 60 } }]);
  assert.equal(view.numPages, 3);
  assert.deepEqual(pageViewRecords(view), [
    { src: 2, rot: 0, blank: null },
    { src: 1, rot: 90, blank: null },
    { src: null, rot: 0, blank: { width: 50, height: 60 } },
  ]);
  assert.throws(() => pageViewFromRecords(doc, [{ src: 4, rot: 0 }]), /not in this PDF/);
});
