import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldApplyPersistedFormValue } from '../src/components/pdfjsFormLocalValueGuard.js';

test('stale cross-field persistence cannot overwrite a newer local checkbox edit', () => {
  const dirty = new Map([['checkbox-1', true]]);
  assert.equal(shouldApplyPersistedFormValue(dirty, 'checkbox-1', false), false);
  assert.equal(dirty.get('checkbox-1'), true, 'dirty value remains until acknowledged');
});

test('matching persistence acknowledges and releases the local form guard', () => {
  const dirty = new Map([['field-1', 'new value']]);
  assert.equal(shouldApplyPersistedFormValue(dirty, 'field-1', 'new value'), true);
  assert.equal(dirty.has('field-1'), false);
  assert.equal(shouldApplyPersistedFormValue(dirty, 'field-1', 'later remote value'), true);
});

test('unrelated persisted fields still apply while another field is dirty', () => {
  const dirty = new Map([['checkbox-1', true]]);
  assert.equal(shouldApplyPersistedFormValue(dirty, 'text-1', 'saved text'), true);
  assert.deepEqual([...dirty], [['checkbox-1', true]]);
});
