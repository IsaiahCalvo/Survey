import test from 'node:test';
import assert from 'node:assert/strict';

import { getEraserOperation } from '../src/utils/eraserPolicy.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import { getSurveyMarkerEraserHitIds } from '../src/utils/surveyMarkerEraser.js';

const pen = {
  type: 'path',
  id: 'ink',
  annotationId: 'ink',
  tool: 'pen',
  path: [['M', 0, 50], ['L', 100, 50]],
  left: 0,
  top: 0,
  stroke: '#d11b2d',
  strokeWidth: 20,
  fill: null,
};

const rect = {
  type: 'rect',
  id: 'rect',
  annotationId: 'rect',
  tool: 'rect',
  left: 20,
  top: 20,
  width: 40,
  height: 40,
  fill: '#2563eb',
};

test('getEraserOperation returns skip for partial + non-ink', () => {
  assert.equal(getEraserOperation(pen, 'partial'), 'partial');
  assert.equal(getEraserOperation(rect, 'partial'), 'skip');
  assert.equal(getEraserOperation({ type: 'textbox', text: 'Note' }, 'partial'), 'skip');
  assert.equal(getEraserOperation(rect, 'entire'), 'entire');
});

test('page-space partial erase carves ink and leaves a touched shape', () => {
  const page = { objects: [rect, pen] };
  const result = erasePageAnnotations({
    pageAnnotations: page,
    eraserPoints: [{ x: 40, y: 50 }],
    eraserRadius: 8,
    mode: 'partial',
  });

  assert.equal(result.didChange, true);
  assert.deepEqual(result.deletedIds, []);
  assert.deepEqual(result.changedIds, ['ink']);
  assert.equal(result.pageAnnotations.objects[0], rect);
  assert.notEqual(result.pageAnnotations.objects[1], pen);
});

test('survey-marker hits stay empty in partial and remain available in entire', () => {
  const common = {
    surveyMarkers: [{
      annotationId: 'marker-filled',
      x: 10,
      y: 20,
      width: 40,
      height: 20,
      color: 'rgba(255,235,59,0.25)',
    }],
    visibleIds: new Set(['marker-filled']),
    eraserPoints: [{ x: 25, y: 30 }],
    eraserRadius: 4,
    canErase: () => true,
  };

  assert.deepEqual(getSurveyMarkerEraserHitIds({ ...common, mode: 'partial' }), []);
  assert.deepEqual(getSurveyMarkerEraserHitIds({ ...common, mode: 'entire' }), ['marker-filled']);
});
