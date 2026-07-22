import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSurveyMarkerEraserHitIds,
  surveyMarkerToEraserObject,
} from '../src/utils/surveyMarkerEraser.js';

const filledMarker = {
  annotationId: 'marker-filled',
  x: 10,
  y: 20,
  width: 40,
  height: 20,
  color: 'rgba(255,235,59,0.25)',
};

test('survey marker eraser returns a touched visible permitted marker exactly once', () => {
  const hits = getSurveyMarkerEraserHitIds({
    surveyMarkers: [filledMarker, { ...filledMarker }],
    visibleIds: new Set(['marker-filled']),
    eraserPoints: [{ x: 25, y: 30 }],
    eraserRadius: 4,
    canErase: () => true,
  });
  assert.deepEqual(hits, ['marker-filled']);
});

test('visible DOM ids are authoritative and permission denial fails closed', () => {
  const common = {
    surveyMarkers: [filledMarker],
    eraserPoints: [{ x: 25, y: 30 }],
    eraserRadius: 4,
  };
  assert.deepEqual(getSurveyMarkerEraserHitIds({
    ...common,
    visibleIds: new Set(),
    canErase: () => true,
  }), []);
  assert.deepEqual(getSurveyMarkerEraserHitIds({
    ...common,
    visibleIds: new Set(['marker-filled']),
    canErase: () => false,
  }), []);
});

test('survey marker geometry matches filled, dashed, and rotated presentation rects', () => {
  const filled = surveyMarkerToEraserObject(filledMarker);
  assert.equal(filled.type, 'rect');
  assert.equal(filled.fill, 'rgba(255,235,59,0.25)');

  const pending = surveyMarkerToEraserObject({
    annotationId: 'marker-pending',
    x: 0,
    y: 0,
    width: 40,
    height: 20,
    angle: 90,
    needsEntity: true,
  });
  assert.equal(pending.fill, 'transparent');
  assert.equal(pending.stroke, '#4A90E2');
  assert.equal(pending.strokeWidth, 2);
  assert.equal(pending.angle, 90);

  assert.deepEqual(getSurveyMarkerEraserHitIds({
    surveyMarkers: [{
      annotationId: 'marker-rotated',
      x: 0,
      y: 0,
      width: 40,
      height: 10,
      angle: 90,
      color: 'rgba(255,235,59,0.25)',
    }],
    visibleIds: new Set(['marker-rotated']),
    eraserPoints: [{ x: 20, y: 20 }],
    eraserRadius: 1,
    canErase: () => true,
  }), ['marker-rotated']);
});

test('excluded preview ids and geometry misses do not produce duplicate work', () => {
  assert.deepEqual(getSurveyMarkerEraserHitIds({
    surveyMarkers: [filledMarker],
    visibleIds: new Set(['marker-filled']),
    excludeIds: new Set(['marker-filled']),
    eraserPoints: [{ x: 25, y: 30 }],
    eraserRadius: 4,
    canErase: () => true,
  }), []);
  assert.deepEqual(getSurveyMarkerEraserHitIds({
    surveyMarkers: [filledMarker],
    visibleIds: new Set(['marker-filled']),
    eraserPoints: [{ x: 200, y: 200 }],
    eraserRadius: 4,
    canErase: () => true,
  }), []);
});
