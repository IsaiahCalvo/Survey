import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnnotationSelectionContextKey,
  didAnnotationSelectionContextChange,
} from '../src/utils/annotationSelectionContext.js';

test('annotation selection context changes when survey mode changes', () => {
  const normal = buildAnnotationSelectionContextKey({
    showSurveyPanel: false,
    selectedModuleId: null,
    selectedSpaceId: null,
    activeSpaceId: null,
    activeRegionId: null,
    showRegionSelection: false,
    regionSelectionPage: null,
  });

  const survey = buildAnnotationSelectionContextKey({
    showSurveyPanel: true,
    selectedModuleId: 'module-1',
    selectedSpaceId: null,
    activeSpaceId: null,
    activeRegionId: null,
    showRegionSelection: false,
    regionSelectionPage: null,
  });

  assert.equal(didAnnotationSelectionContextChange(normal, survey), true);
  assert.equal(didAnnotationSelectionContextChange(survey, normal), true);
});

test('annotation selection context changes when region state changes', () => {
  const regular = buildAnnotationSelectionContextKey({
    showSurveyPanel: false,
    selectedModuleId: null,
    selectedSpaceId: null,
    activeSpaceId: null,
    activeRegionId: null,
    showRegionSelection: false,
    regionSelectionPage: null,
  });

  const regionOpen = buildAnnotationSelectionContextKey({
    showSurveyPanel: false,
    selectedModuleId: null,
    selectedSpaceId: 'space-1',
    activeSpaceId: 'space-1',
    activeRegionId: null,
    showRegionSelection: false,
    regionSelectionPage: null,
  });

  const regionDrawing = buildAnnotationSelectionContextKey({
    showSurveyPanel: false,
    selectedModuleId: null,
    selectedSpaceId: 'space-1',
    activeSpaceId: 'space-1',
    activeRegionId: null,
    showRegionSelection: true,
    regionSelectionPage: 2,
  });

  assert.equal(didAnnotationSelectionContextChange(regular, regionOpen), true);
  assert.equal(didAnnotationSelectionContextChange(regionOpen, regionDrawing), true);
});

test('initial annotation selection context does not request cleanup', () => {
  const key = buildAnnotationSelectionContextKey({ showSurveyPanel: false });

  assert.equal(didAnnotationSelectionContextChange(null, key), false);
  assert.equal(didAnnotationSelectionContextChange(undefined, key), false);
  assert.equal(didAnnotationSelectionContextChange(key, key), false);
});
