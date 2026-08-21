import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidPickerHex } from '../src/utils/pickerHex.js';

test('P1-39: hex gate accepts only 6-digit RGB', () => {
  assert.equal(isValidPickerHex('#FF0000'), true);
  assert.equal(isValidPickerHex('00ff80'), true);
  assert.equal(isValidPickerHex('#abcdef'), true);
  assert.equal(isValidPickerHex('zzzzzz'), false);
  assert.equal(isValidPickerHex('#fff'), false);
  assert.equal(isValidPickerHex(''), false);
  assert.equal(isValidPickerHex('rgb(1,2,3)'), false);
  assert.equal(isValidPickerHex('#GG0000'), false);
});
