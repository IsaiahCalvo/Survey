import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUndoKeyEvent, isRedoKeyEvent, isUndoRedoBlocked } from '../undoRedoHotkeys.js';

// --- predicate sanity (the four-chord contract) --------------------------------
test('isUndoKeyEvent: Cmd+Z and Ctrl+Z (no shift) are undo; Shift+Z is not', () => {
  assert.equal(isUndoKeyEvent({ metaKey: true, key: 'z' }), true);
  assert.equal(isUndoKeyEvent({ ctrlKey: true, key: 'z' }), true);
  assert.equal(isUndoKeyEvent({ metaKey: true, shiftKey: true, key: 'z' }), false);
  assert.equal(isUndoKeyEvent({ key: 'z' }), false);
});

test('isRedoKeyEvent: all four redo chords', () => {
  assert.equal(isRedoKeyEvent({ metaKey: true, shiftKey: true, key: 'z' }), true);
  assert.equal(isRedoKeyEvent({ ctrlKey: true, shiftKey: true, key: 'z' }), true);
  assert.equal(isRedoKeyEvent({ metaKey: true, key: 'y' }), true);
  assert.equal(isRedoKeyEvent({ ctrlKey: true, key: 'y' }), true);
  assert.equal(isRedoKeyEvent({ metaKey: true, key: 'z' }), false);
});

// --- isUndoRedoBlocked: the execution-site guards ------------------------------
const fakeDoc = ({ readonly = false, regionUI = false, active = null } = {}) => ({
  body: { getAttribute: (name) => (name === 'data-readonly' && readonly ? 'true' : null) },
  querySelector: (sel) => (sel === '[data-region-selection-ui="true"]' && regionUI ? {} : null),
  activeElement: active,
});

test('isUndoRedoBlocked: not blocked in a normal editable document', () => {
  assert.equal(isUndoRedoBlocked(fakeDoc()), false);
});

test('isUndoRedoBlocked: blocked when the document is read-only', () => {
  assert.equal(isUndoRedoBlocked(fakeDoc({ readonly: true })), true);
});

test('isUndoRedoBlocked: blocked while the region-edit overlay is mounted', () => {
  assert.equal(isUndoRedoBlocked(fakeDoc({ regionUI: true })), true);
});

test('isUndoRedoBlocked: blocked while typing in INPUT / TEXTAREA / contentEditable', () => {
  assert.equal(isUndoRedoBlocked(fakeDoc({ active: { tagName: 'INPUT' } })), true);
  assert.equal(isUndoRedoBlocked(fakeDoc({ active: { tagName: 'TEXTAREA' } })), true);
  assert.equal(isUndoRedoBlocked(fakeDoc({ active: { tagName: 'DIV', isContentEditable: true } })), true);
});

test('isUndoRedoBlocked: NOT blocked when focus is on a non-editable element (e.g. a button)', () => {
  assert.equal(isUndoRedoBlocked(fakeDoc({ active: { tagName: 'BUTTON' } })), false);
});

test('isUndoRedoBlocked: nullish document is treated as not-blocked (defensive)', () => {
  assert.equal(isUndoRedoBlocked(null), false);
  assert.equal(isUndoRedoBlocked(undefined), false);
});
