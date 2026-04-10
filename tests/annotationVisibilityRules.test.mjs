import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ANNOTATION_VISIBILITY_SCOPE,
  PAGE_VISIBILITY_CONTROL_MODE,
  getActivePageRegionId,
  getAnnotationVisibilityScope,
  getPageAnnotationVisibilityState,
  getPageVisibilityControlMode,
  isAnnotationVisibleByPageControl,
  normalizeRegionVisibility,
} from '../src/utils/annotationVisibilityRules.js';

describe('getAnnotationVisibilityScope', () => {
  it('classifies canvas-scoped annotations', () => {
    assert.equal(
      getAnnotationVisibilityScope({ moduleId: null, regionId: null }),
      ANNOTATION_VISIBILITY_SCOPE.CANVAS
    );
  });

  it('classifies survey-scoped annotations', () => {
    assert.equal(
      getAnnotationVisibilityScope({ moduleId: 'module-1', regionId: null }),
      ANNOTATION_VISIBILITY_SCOPE.SURVEY
    );
  });

  it('classifies region-scoped annotations', () => {
    assert.equal(
      getAnnotationVisibilityScope({ moduleId: null, regionId: 'region-1' }),
      ANNOTATION_VISIBILITY_SCOPE.REGION
    );
  });

  it('classifies survey-region-scoped annotations', () => {
    assert.equal(
      getAnnotationVisibilityScope({ moduleId: 'module-1', regionId: 'region-1' }),
      ANNOTATION_VISIBILITY_SCOPE.SURVEY_REGION
    );
  });
});

describe('getPageVisibilityControlMode', () => {
  it('uses the survey control only when survey mode has a selected module', () => {
    assert.equal(
      getPageVisibilityControlMode({ showSurveyPanel: true, selectedModuleId: 'module-1' }),
      PAGE_VISIBILITY_CONTROL_MODE.SURVEY
    );
  });

  it('falls back to the canvas control outside survey context', () => {
    assert.equal(
      getPageVisibilityControlMode({ showSurveyPanel: true, selectedModuleId: null }),
      PAGE_VISIBILITY_CONTROL_MODE.CANVAS
    );
    assert.equal(
      getPageVisibilityControlMode({ showSurveyPanel: false, selectedModuleId: 'module-1' }),
      PAGE_VISIBILITY_CONTROL_MODE.CANVAS
    );
  });
});

describe('normalizeRegionVisibility', () => {
  it('mirrors legacy showBackgroundAnnotations into explicit canvas visibility', () => {
    const region = normalizeRegionVisibility({
      showBackgroundAnnotations: false,
      showSurveyAnnotations: true,
    });

    assert.equal(region.showCanvasAnnotations, false);
    assert.equal(region.showBackgroundAnnotations, false);
    assert.equal(region.showSurveyAnnotations, true);
  });

  it('defaults both page-level visibility states to true', () => {
    const region = normalizeRegionVisibility({});
    assert.equal(region.showCanvasAnnotations, true);
    assert.equal(region.showBackgroundAnnotations, true);
    assert.equal(region.showSurveyAnnotations, true);
  });
});

describe('getPageAnnotationVisibilityState', () => {
  it('reads separate canvas and survey visibility from the page', () => {
    const state = getPageAnnotationVisibilityState({
      regions: [{
        showCanvasAnnotations: false,
        showSurveyAnnotations: true,
      }],
    });

    assert.deepStrictEqual(state, {
      canvasVisible: false,
      surveyVisible: true,
    });
  });

  it('defaults to visible when the page has no regions yet', () => {
    assert.deepStrictEqual(getPageAnnotationVisibilityState({ regions: [] }), {
      canvasVisible: true,
      surveyVisible: true,
    });
  });
});

describe('getActivePageRegionId', () => {
  it('returns null when the page overlay is off', () => {
    assert.equal(
      getActivePageRegionId({
        activeSpaceId: 'space-1',
        pageId: 3,
        spaces: [{
          id: 'space-1',
          assignedPages: [{
            pageId: 3,
            regions: [{ regionId: 'region-3' }],
          }],
        }],
        isRegionOverlayEnabled: () => false,
      }),
      null
    );
  });

  it('returns the page region id when the overlay is on', () => {
    assert.equal(
      getActivePageRegionId({
        activeSpaceId: 'space-1',
        pageId: 3,
        spaces: [{
          id: 'space-1',
          assignedPages: [{
            pageId: 3,
            regions: [{ regionId: 'region-3' }],
          }],
        }],
        isRegionOverlayEnabled: () => true,
      }),
      'region-3'
    );
  });
});

describe('isAnnotationVisibleByPageControl', () => {
  it('hides only canvas-scoped annotations when the canvas control is off', () => {
    assert.equal(
      isAnnotationVisibleByPageControl({
        scope: ANNOTATION_VISIBILITY_SCOPE.CANVAS,
        canvasVisible: false,
        surveyVisible: true,
      }),
      false
    );

    assert.equal(
      isAnnotationVisibleByPageControl({
        scope: ANNOTATION_VISIBILITY_SCOPE.SURVEY,
        canvasVisible: false,
        surveyVisible: true,
      }),
      true
    );
  });

  it('hides only survey-scoped annotations when the survey control is off', () => {
    assert.equal(
      isAnnotationVisibleByPageControl({
        scope: ANNOTATION_VISIBILITY_SCOPE.SURVEY,
        canvasVisible: true,
        surveyVisible: false,
      }),
      false
    );

    assert.equal(
      isAnnotationVisibleByPageControl({
        scope: ANNOTATION_VISIBILITY_SCOPE.CANVAS,
        canvasVisible: true,
        surveyVisible: false,
      }),
      true
    );
  });

  it('never uses page visibility controls to hide region-scoped layers', () => {
    assert.equal(
      isAnnotationVisibleByPageControl({
        scope: ANNOTATION_VISIBILITY_SCOPE.REGION,
        canvasVisible: false,
        surveyVisible: false,
      }),
      true
    );

    assert.equal(
      isAnnotationVisibleByPageControl({
        scope: ANNOTATION_VISIBILITY_SCOPE.SURVEY_REGION,
        canvasVisible: false,
        surveyVisible: false,
      }),
      true
    );
  });
});
