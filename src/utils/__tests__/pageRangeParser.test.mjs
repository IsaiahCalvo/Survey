import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as pageRangeParser from '../pageRangeParser.js';

const sanitizePageRangeInput = (value) => {
  assert.equal(typeof pageRangeParser.sanitizePageRangeInput, 'function');
  return pageRangeParser.sanitizePageRangeInput(value);
};

describe('sanitizePageRangeInput', () => {
  it('keeps only digits, commas, and dashes', () => {
    assert.equal(sanitizePageRangeInput('a1 b2,2;x-3_4'), '12,2-34');
  });

  it('allows zeros after a non-zero digit', () => {
    assert.equal(sanitizePageRangeInput('100,200,300,105'), '100,200,300,105');
  });

  it('removes zeros that start a number', () => {
    assert.equal(sanitizePageRangeInput('0'), '');
    assert.equal(sanitizePageRangeInput('01'), '1');
    assert.equal(sanitizePageRangeInput('1,02'), '1,2');
    assert.equal(sanitizePageRangeInput('1-02'), '1-2');
  });
});
