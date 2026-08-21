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

test('every shape, text, and other atomic annotation is skipped in partial mode', () => {
  const atomicAnnotations = [
    path(),
    path({ tool: 'line' }),
    path({ tool: 'arrow' }),
    path({ tool: 'rect' }),
    path({ tool: 'ellipse' }),
    path({ tool: 'polygon' }),
    path({ tool: 'cloud' }),
    path({ tool: 'text' }),
    path({ tool: 'callout' }),
    path({ tool: 'stamp' }),
    path({ tool: 'survey-marker' }),
    path({ data: { type: 'counter' } }),
    path({ pdfAnnotationType: 'Line' }),
    path({ pdfAnnotationType: 'Square' }),
    path({ pdfAnnotationType: 'Circle' }),
    path({ pdfAnnotationType: 'Polygon' }),
    path({ pdfAnnotationType: 'FreeText' }),
    path({ pdfAnnotationType: 'Highlight', tool: 'highlighter' }),
    { type: 'line', tool: 'pen' },
    { type: 'rect', tool: 'highlighter' },
    { type: 'ellipse' },
    { type: 'polygon' },
    { type: 'textbox', text: 'Note' },
    { type: 'callout' },
    { type: 'image' },
  ];

  for (const annotation of atomicAnnotations) {
    assert.equal(isPartialEraseEligible(annotation), false, JSON.stringify(annotation));
    assert.equal(getEraserOperation(annotation, 'partial'), 'skip', JSON.stringify(annotation));
  }
});

test('unlabeled rounded paths without the historical PencilBrush fingerprint are atomic', () => {
  const legacyLookingPath = path({
    tool: undefined,
    fill: null,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    path: [['M', 0, 0], ['Q', 5, 8, 10, 10], ['L', 20, 20]],
  });

  assert.equal(isPartialEraseEligible(legacyLookingPath), false);
  assert.equal(getEraserOperation(legacyLookingPath, 'partial'), 'skip');
});

test('historical Fabric PencilBrush pen/highlighter saves remain partial-erase eligible', () => {
  const legacyInk = path({
    tool: undefined,
    fill: null,
    stroke: '#e11d48',
    strokeWidth: 7,
    strokeUniform: true,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    strokeMiterLimit: 10,
    strokeDashArray: null,
    path: [['M', 0, 0], ['Q', 5, 8, 10, 10], ['Q', 15, 12, 20, 20], ['L', 22, 22]],
  });

  assert.equal(isPartialEraseEligible(legacyInk), true);
  assert.equal(isPartialEraseEligible({
    ...legacyInk,
    globalCompositeOperation: 'multiply',
  }), true, 'old highlighter saves share the PencilBrush fingerprint');
});

test('legacy fingerprint refuses curved shapes, imported marks, and closed paths', () => {
  const legacyInk = path({
    tool: undefined,
    fill: null,
    stroke: '#111111',
    strokeWidth: 5,
    strokeUniform: true,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    strokeMiterLimit: 10,
    strokeDashArray: null,
    path: [['M', 0, 0], ['Q', 5, 8, 10, 10], ['L', 20, 20]],
  });

  assert.equal(isPartialEraseEligible({ ...legacyInk, data: { isCurved: true } }), false);
  assert.equal(isPartialEraseEligible({ ...legacyInk, data: { type: 'callout' } }), false);
  assert.equal(isPartialEraseEligible({ ...legacyInk, annotationId: 'survey-marker' }), false);
  assert.equal(isPartialEraseEligible({ ...legacyInk, isPdfImported: true }), false);
  assert.equal(isPartialEraseEligible({
    ...legacyInk,
    path: [['M', 0, 0], ['Q', 5, 8, 10, 10], ['L', 20, 20], ['Z']],
  }), false);
});

test('known filled-outline ink stays partial-eligible without a tool tag', () => {
  assert.equal(isPartialEraseEligible(path({
    tool: undefined,
    paperInkGeometry: 'v1',
    polygons: [[[[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]]]],
  })), true);
});

test('known pen outline geometry remains partial-eligible without Fabric path commands', () => {
  const polygonOutline = {
    type: 'path',
    tool: 'pen',
    polygons: [[[[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]]]],
  };
  const commandOutline = {
    type: 'path',
    tool: 'highlighter',
    cmds: [['M', 0, 0], ['L', 20, 0], ['L', 20, 10], ['Z']],
  };
  assert.equal(isPartialEraseEligible(polygonOutline), true);
  assert.equal(isPartialEraseEligible(commandOutline), true);
});

test('malformed or provenance-conflicting paths require full erase', () => {
  assert.equal(isPartialEraseEligible({ type: 'path', tool: 'pen', path: [] }), false);
  assert.equal(isPartialEraseEligible(path({ tool: 'pen', pdfAnnotationType: 'Line' })), false);
  assert.equal(isPartialEraseEligible(null), false);
});

test('requested full erase always wins and partial skips non-ink', () => {
  const pen = path({ tool: 'pen' });
  const rectangle = { type: 'rect', width: 20, height: 10 };

  assert.equal(getEraserOperation(pen, 'entire'), 'entire');
  assert.equal(getEraserOperation(pen, 'partial'), 'partial');
  assert.equal(getEraserOperation(rectangle, 'partial'), 'skip');
  assert.equal(getEraserOperation(rectangle, 'entire'), 'entire');
  assert.equal(getEraserOperation(pen, 'unexpected'), 'entire');
});
