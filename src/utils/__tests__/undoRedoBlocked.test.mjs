import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUndoRedoBlocked } from '../undoRedoHotkeys.js';

const fakeDocument = ({ readonly = false, regionUI = false, active = null } = {}) => ({
  body: { getAttribute: (name) => (name === 'data-readonly' && readonly ? 'true' : null) },
  querySelector: (selector) => (selector === '[data-region-selection-ui="true"]' && regionUI ? {} : null),
  activeElement: active,
});

test('undo/redo is blocked for locked documents and region editing', () => {
  assert.equal(isUndoRedoBlocked(fakeDocument({ readonly: true })), true);
  assert.equal(isUndoRedoBlocked(fakeDocument({ regionUI: true })), true);
});

test('undo/redo is blocked while typing but allowed on ordinary controls', () => {
  assert.equal(isUndoRedoBlocked(fakeDocument({ active: { tagName: 'INPUT' } })), true);
  assert.equal(isUndoRedoBlocked(fakeDocument({ active: { tagName: 'TEXTAREA' } })), true);
  assert.equal(isUndoRedoBlocked(fakeDocument({ active: { tagName: 'DIV', isContentEditable: true } })), true);
  assert.equal(isUndoRedoBlocked(fakeDocument({ active: { tagName: 'BUTTON' } })), false);
});

test('undo/redo blocker handles missing documents defensively', () => {
  assert.equal(isUndoRedoBlocked(null), false);
  assert.equal(isUndoRedoBlocked(fakeDocument()), false);
});
