import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFormFieldObject } from '../usePdfjsFormFieldPersistence.js';

test('buildFormFieldObject: derives left/top/width/height from rect', () => {
  const o = buildFormFieldObject(2, { fieldId: 'f1', rect: [10, 20, 110, 70], value: 'x' }, null, 'u1');
  assert.equal(o.left, 10);
  assert.equal(o.top, 20);
  assert.equal(o.width, 100);
  assert.equal(o.height, 50);
});

test('buildFormFieldObject: reversed rect still yields positive bounds', () => {
  const o = buildFormFieldObject(1, { fieldId: 'f', rect: [110, 70, 10, 20], value: '' }, null, null);
  assert.equal(o.left, 10);
  assert.equal(o.top, 20);
  assert.equal(o.width, 100);
  assert.equal(o.height, 50);
});

test('buildFormFieldObject: no rect -> all bounds 0 and data.rect null', () => {
  const o = buildFormFieldObject(3, { fieldId: 'f', value: 'v' }, null, 'u');
  assert.equal(o.left, 0);
  assert.equal(o.top, 0);
  assert.equal(o.width, 0);
  assert.equal(o.height, 0);
  assert.equal(o.data.rect, null);
});

test('buildFormFieldObject: authorId is write-once (existing wins over current user)', () => {
  const kept = buildFormFieldObject(1, { fieldId: 'f' }, 'alice', 'bob');
  assert.equal(kept.meta.authorId, 'alice', 'existing author preserved');
  const fresh = buildFormFieldObject(1, { fieldId: 'f' }, null, 'bob');
  assert.equal(fresh.meta.authorId, 'bob', 'new field gets current user');
  const anon = buildFormFieldObject(1, { fieldId: 'f' }, null, null);
  assert.equal(anon.meta.authorId, null, 'no author available -> null');
});

test('buildFormFieldObject: data payload mapping + stable id key', () => {
  const o = buildFormFieldObject(4, { fieldId: 'abc', fieldName: 'Name', fieldType: 'text', value: 'Bob', rect: [0, 0, 1, 1] }, null, 'u');
  assert.equal(o.type, 'form-field');
  assert.equal(o.data.id, 'form-field:4:abc');
  assert.equal(o.data.fieldId, 'abc');
  assert.equal(o.data.fieldName, 'Name');
  assert.equal(o.data.fieldType, 'text');
  assert.equal(o.data.value, 'Bob');
  assert.equal(o.data.pageNumber, 4);
});

test('buildFormFieldObject: missing fieldName/fieldType default to null (not undefined)', () => {
  const o = buildFormFieldObject(1, { fieldId: 'f', value: 'v' }, null, 'u');
  assert.equal(o.data.fieldName, null);
  assert.equal(o.data.fieldType, null);
});
