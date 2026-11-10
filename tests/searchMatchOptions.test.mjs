import test from 'node:test';
import assert from 'node:assert/strict';
import { searchMatchLength, searchMatchStarts } from '../src/utils/searchMatchOptions.js';

const text = 'Door D1, door D10 and DOOR-2; outdoor doors.';

test('both options off: the old rule (case folded, every start)', () => {
  assert.deepEqual(searchMatchStarts(text, 'door'), [0, 9, 22, 33, 38]);
  assert.deepEqual(searchMatchStarts('aaa', 'aa'), [0, 1]);
});

test('Match case keeps only the same letters', () => {
  assert.deepEqual(searchMatchStarts(text, 'door', { matchCase: true }), [9, 33, 38]);
  assert.deepEqual(searchMatchStarts(text, 'DOOR', { matchCase: true }), [22]);
});

test('Whole word skips hits inside longer words, numbers included', () => {
  assert.deepEqual(searchMatchStarts(text, 'door', { wholeWord: true }), [0, 9, 22]);
  assert.deepEqual(searchMatchStarts(text, 'D1', { wholeWord: true }), [5]);
  assert.deepEqual(searchMatchStarts(text, 'door', { matchCase: true, wholeWord: true }), [9]);
});

test('match length follows the case rule', () => {
  assert.equal(searchMatchLength('Door'), 4);
});
