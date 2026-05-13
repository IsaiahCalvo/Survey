// tests/svgKeyboardHandlers.test.mjs
// Wave 0 scaffold for KBD-01 handler logic + focus-guard branches.
// Tests the PURE LOGIC of the focus guard — no React mount, no jsdom.
// The handler itself is defined inline below for testability; the real
// handler in SVGAnnotationLayer.jsx (Plan 14-02) imports/mirrors this shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Pure-logic isUserTyping — matches the SVGAnnotationLayer.jsx:194-206
// existing handler plus the Fabric hidden-textarea check from
// combined-tools Index.tsx:31-49 (see 14-RESEARCH.md Common Pitfalls).
function isUserTyping(activeElement) {
  if (!activeElement) return false;
  if (activeElement.tagName === 'INPUT') return true;
  if (activeElement.tagName === 'TEXTAREA') return true;
  if (activeElement.isContentEditable === true) return true;
  if (activeElement.contentEditable === 'true') return true;
  if (typeof activeElement.closest === 'function' &&
      activeElement.closest('.fabric-hidden-textarea')) return true;
  return false;
}

// Pure-logic delete dispatch — returns which callback was called, for
// assertions. Plan 14-02 inlines this in SVGAnnotationLayer.jsx effect.
function dispatchDelete({
  key,
  isTyping,
  selectedIds,
  selectedCalloutIds,
  deleteSelected,
  onDeleteSelectedCallouts,
  onBeginBatchDelete,
}) {
  if (key !== 'Delete' && key !== 'Backspace') return null;
  if (isTyping) return null;
  const hasAnnotations = selectedIds && selectedIds.length > 0;
  const hasCallouts = selectedCalloutIds && selectedCalloutIds.length > 0;
  if (hasAnnotations && hasCallouts) {
    onBeginBatchDelete?.(2, selectedCalloutIds);
  }
  if (hasAnnotations) {
    deleteSelected();
  }
  if (hasCallouts) {
    onDeleteSelectedCallouts(selectedCalloutIds);
  }
  if (hasAnnotations && hasCallouts) return 'batch';
  if (hasAnnotations) return 'annotations';
  if (hasCallouts) return 'callouts';
  return null;
}

test('isUserTyping returns true for INPUT', () => {
  assert.equal(isUserTyping({ tagName: 'INPUT' }), true);
});

test('isUserTyping returns true for TEXTAREA', () => {
  assert.equal(isUserTyping({ tagName: 'TEXTAREA' }), true);
});

test('isUserTyping returns true for contentEditable div (isContentEditable)', () => {
  assert.equal(isUserTyping({ tagName: 'DIV', isContentEditable: true }), true);
});

test('isUserTyping returns true for contentEditable div (contentEditable="true")', () => {
  assert.equal(isUserTyping({ tagName: 'DIV', contentEditable: 'true' }), true);
});

test('isUserTyping returns false for non-contentEditable div', () => {
  assert.equal(isUserTyping({ tagName: 'DIV', isContentEditable: false }), false);
});

test('isUserTyping returns false for null activeElement', () => {
  assert.equal(isUserTyping(null), false);
});

test('isUserTyping returns true for element inside fabric-hidden-textarea', () => {
  const el = {
    tagName: 'DIV',
    closest: (sel) => sel === '.fabric-hidden-textarea' ? {} : null,
  };
  assert.equal(isUserTyping(el), true);
});

test('dispatchDelete calls deleteSelected when annotations selected', () => {
  let called = false;
  const result = dispatchDelete({
    key: 'Delete',
    isTyping: false,
    selectedIds: [1],
    selectedCalloutIds: [],
    deleteSelected: () => { called = true; },
    onDeleteSelectedCallouts: () => {},
  });
  assert.equal(called, true);
  assert.equal(result, 'annotations');
});

test('dispatchDelete calls onDeleteSelectedCallouts when callouts selected', () => {
  let calledWith = null;
  const result = dispatchDelete({
    key: 'Backspace',
    isTyping: false,
    selectedIds: [],
    selectedCalloutIds: ['c1'],
    deleteSelected: () => {},
    onDeleteSelectedCallouts: (ids) => { calledWith = ids; },
  });
  assert.deepEqual(calledWith, ['c1']);
  assert.equal(result, 'callouts');
});

test('dispatchDelete starts mixed batch delete with selected callout ids', () => {
  let batchArgs = null;
  let annotationDeleted = false;
  let calloutsDeleted = null;
  const result = dispatchDelete({
    key: 'Delete',
    isTyping: false,
    selectedIds: ['shape-1'],
    selectedCalloutIds: ['callout-1', 'callout-2'],
    deleteSelected: () => { annotationDeleted = true; },
    onDeleteSelectedCallouts: (ids) => { calloutsDeleted = ids; },
    onBeginBatchDelete: (...args) => { batchArgs = args; },
  });
  assert.deepEqual(batchArgs, [2, ['callout-1', 'callout-2']]);
  assert.equal(annotationDeleted, true);
  assert.deepEqual(calloutsDeleted, ['callout-1', 'callout-2']);
  assert.equal(result, 'batch');
});

test('dispatchDelete is no-op when isTyping=true', () => {
  let fired = false;
  const result = dispatchDelete({
    key: 'Delete',
    isTyping: true,
    selectedIds: [1],
    selectedCalloutIds: [],
    deleteSelected: () => { fired = true; },
    onDeleteSelectedCallouts: () => {},
  });
  assert.equal(fired, false);
  assert.equal(result, null);
});

test('dispatchDelete is no-op when no selection', () => {
  let fired = false;
  const result = dispatchDelete({
    key: 'Delete',
    isTyping: false,
    selectedIds: [],
    selectedCalloutIds: [],
    deleteSelected: () => { fired = true; },
    onDeleteSelectedCallouts: () => { fired = true; },
  });
  assert.equal(fired, false);
  assert.equal(result, null);
});

test('dispatchDelete ignores non-Delete/Backspace keys', () => {
  let fired = false;
  const result = dispatchDelete({
    key: 'Enter',
    isTyping: false,
    selectedIds: [1],
    selectedCalloutIds: [],
    deleteSelected: () => { fired = true; },
    onDeleteSelectedCallouts: () => {},
  });
  assert.equal(fired, false);
  assert.equal(result, null);
});
