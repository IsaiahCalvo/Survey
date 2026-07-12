import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isUndoKeyEvent,
  isRedoKeyEvent,
  isUndoRedoKeyEvent,
} from '../src/utils/undoRedoHotkeys.js';

const key = (partial) => ({
  key: '',
  code: '',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...partial,
});

test('isUndoKeyEvent accepts Cmd/Ctrl+Z without Shift', () => {
  assert.equal(isUndoKeyEvent(key({ metaKey: true, key: 'z' })), true);
  assert.equal(isUndoKeyEvent(key({ ctrlKey: true, code: 'KeyZ' })), true);
  assert.equal(isUndoKeyEvent(key({ ctrlKey: true, key: 'z', shiftKey: true })), false);
  assert.equal(isUndoKeyEvent(key({ ctrlKey: true, key: 'z', altKey: true })), false);
  assert.equal(isUndoKeyEvent(null), false);
});

test('isRedoKeyEvent accepts Shift+Z and Y variants', () => {
  assert.equal(isRedoKeyEvent(key({ metaKey: true, key: 'z', shiftKey: true })), true);
  assert.equal(isRedoKeyEvent(key({ ctrlKey: true, code: 'KeyZ', shiftKey: true })), true);
  assert.equal(isRedoKeyEvent(key({ metaKey: true, key: 'y' })), true);
  assert.equal(isRedoKeyEvent(key({ ctrlKey: true, code: 'KeyY' })), true);
  assert.equal(isRedoKeyEvent(key({ ctrlKey: true, key: 'y', altKey: true })), false);
});

test('isUndoRedoKeyEvent covers the whole family', () => {
  assert.equal(isUndoRedoKeyEvent(key({ ctrlKey: true, key: 'z' })), true);
  assert.equal(isUndoRedoKeyEvent(key({ ctrlKey: true, key: 'y' })), true);
  assert.equal(isUndoRedoKeyEvent(key({ key: 'z' })), false);
});
