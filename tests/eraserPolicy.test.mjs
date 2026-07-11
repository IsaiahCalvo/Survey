import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getEraserOperation,
  isPartialEraseEligible,
} from '../src/utils/eraserPolicy.js';

const path = (overrides = {}) => ({
  type: 'path',
  path: [['M', 0, 0], ['L', 20, 20]],
  stroke: '#111111',
  strokeWidth: 4,
  ...overrides,
});

test('native pen and highlighter paths support partial erase', () => {
  assert.equal(isPartialEraseEligible(path({ tool: 'pen' })), true);
  assert.equal(isPartialEraseEligible(path({ tool: 'highlighter' })), true);
  assert.equal(isPartialEraseEligible(path({ type: 'Path', tool: 'PEN' })), true);
});

test('imported PDF Ink supports partial erase', () => {
  assert.equal(isPartialEraseEligible(path({ pdfAnnotationType: 'Ink' })), true);
  assert.equal(isPartialEraseEligible(path({ pdfAnnotationType: '/Ink' })), true);
  assert.equal(isPartialEraseEligible(path({ data: { pdfAnnotationType: 'Ink' } })), true);
});

test('partially erased pen outlines remain partial-erase eligible', () => {
  assert.equal(isPartialEraseEligible(path({
    tool: 'pen',
    stroke: 'transparent',
    strokeWidth: 0,
    fill: '#111111',
    path: [['M', 0, 0], ['L', 20, 0], ['L', 20, 8], ['Z']],
  })), true);
});

test('generic paths and every non-path annotation require full erase', () => {
  assert.equal(isPartialEraseEligible(path()), false);
  assert.equal(isPartialEraseEligible(path({ tool: 'arrow' })), false);
  assert.equal(isPartialEraseEligible({ type: 'line', tool: 'pen' }), false);
  assert.equal(isPartialEraseEligible({ type: 'rect', tool: 'highlighter' }), false);
  assert.equal(isPartialEraseEligible({ type: 'textbox', text: 'Note' }), false);
  assert.equal(isPartialEraseEligible({ type: 'callout' }), false);
});

test('legacy open freehand paths are inferred conservatively', () => {
  const legacyInk = {
    tool: undefined,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    path: [['M', 0, 0], ['Q', 5, 8, 10, 10], ['L', 20, 20]],
  };
  assert.equal(isPartialEraseEligible(path({ ...legacyInk, fill: null })), true);
  assert.equal(isPartialEraseEligible(path({ ...legacyInk, fill: 'transparent' })), true);
  assert.equal(isPartialEraseEligible(path({ ...legacyInk, fill: '#111' })), false);
  assert.equal(isPartialEraseEligible(path({
    ...legacyInk,
    fill: null,
    tool: undefined,
    path: [['M', 0, 0], ['L', 20, 20], ['Z']],
  })), false);
});

test('legacy short round freehand strokes remain partially erasable', () => {
  assert.equal(isPartialEraseEligible(path({
    tool: undefined,
    fill: null,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    path: [['M', 4, 8], ['L', 24, 8]],
  })), true);
});

test('malformed or provenance-conflicting paths require full erase', () => {
  assert.equal(isPartialEraseEligible({ type: 'path', tool: 'pen', path: [] }), false);
  assert.equal(isPartialEraseEligible(path({ tool: 'pen', pdfAnnotationType: 'Line' })), false);
  assert.equal(isPartialEraseEligible(null), false);
});

test('requested full erase always wins and partial falls back per object', () => {
  const pen = path({ tool: 'pen' });
  const rectangle = { type: 'rect', width: 20, height: 10 };

  assert.equal(getEraserOperation(pen, 'entire'), 'entire');
  assert.equal(getEraserOperation(pen, 'partial'), 'partial');
  assert.equal(getEraserOperation(rectangle, 'partial'), 'entire');
  assert.equal(getEraserOperation(pen, 'unexpected'), 'entire');
});
