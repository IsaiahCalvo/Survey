import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toUint8Array,
  readPdfLibNumber,
  readPdfLibNumberArray,
  readPdfLibText,
  normalizePdfNameToken,
  readPdfLibNameArray,
  readPdfLibDashArray,
  normalizePdfLineEndings,
} from '../pdfLibValueReaders.js';

// Minimal pdf-lib PDFObject-like mocks
const num = (n) => ({ asNumber: () => n });
const txt = (s) => ({ decodeText: () => s });
const arr = (items) => ({ asArray: () => items });

test('toUint8Array: passes Uint8Array through, wraps ArrayBuffer & views, else null', () => {
  const u = new Uint8Array([1, 2, 3]);
  assert.equal(toUint8Array(u), u);
  const fromBuf = toUint8Array(u.buffer);
  assert.ok(fromBuf instanceof Uint8Array);
  assert.deepEqual([...fromBuf], [1, 2, 3]);
  const view = new Int16Array([7, 8]);
  assert.ok(toUint8Array(view) instanceof Uint8Array);
  assert.equal(toUint8Array(null), null);
  assert.equal(toUint8Array('nope'), null);
});

test('readPdfLibNumber: asNumber() value, non-finite -> null, falsy -> null', () => {
  assert.equal(readPdfLibNumber(num(3.5)), 3.5);
  assert.equal(readPdfLibNumber(num(Infinity)), null);
  assert.equal(readPdfLibNumber(num(NaN)), null);
  assert.equal(readPdfLibNumber(null), null);
  // asNumber throws -> falls back to Number(String(value))
  assert.equal(readPdfLibNumber({ asNumber() { throw new Error('x'); }, toString() { return '7'; } }), 7);
});

test('readPdfLibNumberArray: all-numeric array, else null on any non-number or empty', () => {
  assert.deepEqual(readPdfLibNumberArray(arr([num(1), num(2), num(3)])), [1, 2, 3]);
  assert.equal(readPdfLibNumberArray(arr([])), null);
  assert.equal(readPdfLibNumberArray(null), null);
  // one element unreadable -> length mismatch -> null
  assert.equal(readPdfLibNumberArray(arr([num(1), num(NaN)])), null);
});

test('readPdfLibText: decodeText() non-empty, empty -> null, fallback to String().trim()', () => {
  assert.equal(readPdfLibText(txt('hello')), 'hello');
  assert.equal(readPdfLibText(txt('')), null);
  assert.equal(readPdfLibText(null), null);
  assert.equal(readPdfLibText({ toString() { return '  spaced  '; } }), 'spaced');
});

test('normalizePdfNameToken: strips leading slash, trims, non-string/empty -> null', () => {
  assert.equal(normalizePdfNameToken('/Circle'), 'Circle');
  assert.equal(normalizePdfNameToken('Square'), 'Square');
  assert.equal(normalizePdfNameToken('  /Ink  '), 'Ink');
  assert.equal(normalizePdfNameToken(''), null);
  assert.equal(normalizePdfNameToken(42), null);
});

test('readPdfLibNameArray: normalizes each name; all-or-null', () => {
  assert.deepEqual(readPdfLibNameArray(arr([txt('/A'), txt('B')])), ['A', 'B']);
  assert.equal(readPdfLibNameArray(arr([])), null);
});

test('readPdfLibDashArray: flat numbers, and nested-first-element array form', () => {
  assert.deepEqual(readPdfLibDashArray(arr([num(3), num(2)])), [3, 2]);
  // first element is itself an array -> read that
  assert.deepEqual(readPdfLibDashArray(arr([arr([num(4), num(1)])])), [4, 1]);
  assert.equal(readPdfLibDashArray(null), null);
});

test('normalizePdfLineEndings: single -> [x, None], pair -> [a,b], nullish -> null', () => {
  assert.deepEqual(normalizePdfLineEndings('/OpenArrow'), ['OpenArrow', 'None']);
  assert.deepEqual(normalizePdfLineEndings(['/Diamond', '/Circle']), ['Diamond', 'Circle']);
  assert.equal(normalizePdfLineEndings(null), null);
});
