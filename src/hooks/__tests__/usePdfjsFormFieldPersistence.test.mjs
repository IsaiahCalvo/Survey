import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFormFieldObject } from '../usePdfjsFormFieldPersistence.js';

test('form-field carrier derives positive bounds from either rect direction', () => {
  const forward = buildFormFieldObject(2, { fieldId: 'f1', rect: [10, 20, 110, 70], value: 'x' }, null, 'u1');
  const reversed = buildFormFieldObject(2, { fieldId: 'f1', rect: [110, 70, 10, 20], value: 'x' }, null, 'u1');
  for (const object of [forward, reversed]) {
    assert.deepEqual([object.left, object.top, object.width, object.height], [10, 20, 100, 50]);
  }
});

test('form-field carrier keeps the original author and stable id', () => {
  const object = buildFormFieldObject(4, {
    fieldId: 'abc', fieldName: 'Name', fieldType: 'text', value: 'Bob', rect: [0, 0, 1, 1],
  }, 'alice', 'bob');
  assert.equal(object.data.id, 'form-field:4:abc');
  assert.equal(object.meta.authorId, 'alice');
  assert.equal(object.data.value, 'Bob');
});

test('form-field carrier defaults missing rect and metadata safely', () => {
  const object = buildFormFieldObject(1, { fieldId: 'f', value: 'v' }, null, null);
  assert.deepEqual([object.left, object.top, object.width, object.height], [0, 0, 0, 0]);
  assert.equal(object.data.rect, null);
  assert.equal(object.data.fieldName, null);
  assert.equal(object.data.fieldType, null);
  assert.equal(object.meta.authorId, null);
});
