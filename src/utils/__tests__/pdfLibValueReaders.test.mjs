import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePdfLineEndings,
  normalizePdfNameToken,
  readPdfLibDashArray,
  readPdfLibNameArray,
  readPdfLibNumber,
  readPdfLibNumberArray,
  readPdfLibText,
  toUint8Array,
} from '../pdfLibValueReaders.js';

const num = (value) => ({ asNumber: () => value });
const text = (value) => ({ decodeText: () => value });
const array = (items) => ({ asArray: () => items });

test('PDF byte reader accepts buffers and typed arrays', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  assert.equal(toUint8Array(bytes), bytes);
  assert.deepEqual([...toUint8Array(bytes.buffer)], [1, 2, 3]);
  assert.ok(toUint8Array(new Int16Array([7])) instanceof Uint8Array);
  assert.equal(toUint8Array('nope'), null);
});

test('PDF number readers reject malformed values', () => {
  assert.equal(readPdfLibNumber(num(3.5)), 3.5);
  assert.equal(readPdfLibNumber(num(Infinity)), null);
  assert.deepEqual(readPdfLibNumberArray(array([num(1), num(2)])), [1, 2]);
  assert.equal(readPdfLibNumberArray(array([num(1), num(NaN)])), null);
});

test('PDF text and name readers normalize values', () => {
  assert.equal(readPdfLibText(text('hello')), 'hello');
  assert.equal(normalizePdfNameToken('  /Ink  '), 'Ink');
  assert.deepEqual(readPdfLibNameArray(array([text('/A'), text('B')])), ['A', 'B']);
  assert.deepEqual(readPdfLibNameArray(text('/OpenArrow')), ['OpenArrow']);
});

test('PDF dash arrays and line endings normalize supported forms', () => {
  assert.deepEqual(readPdfLibDashArray(array([num(3), num(2)])), [3, 2]);
  assert.deepEqual(readPdfLibDashArray(array([array([num(4), num(1)])])), [4, 1]);
  assert.deepEqual(normalizePdfLineEndings('/OpenArrow'), ['OpenArrow', 'None']);
  assert.deepEqual(normalizePdfLineEndings(['/Diamond', '/Circle']), ['Diamond', 'Circle']);
});
