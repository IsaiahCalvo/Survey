import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ANNOTATION_VISIBILITY_SCOPE,
  PAGE_VISIBILITY_CONTROL_MODE,
  getActivePageRegionId,
  getAnnotationVisibilityScope,
  getPageAnnotationVisibilityState,
  getPageVisibilityControlMode,
  getSpaceIdForRegionFromSpaces,
  isAnnotationVisibleByPageControl,
  isAnnotationVisibleInContext,
  normalizePageRegions,
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

describe('normalizePageRegions', () => {
  it('drops null region entries restored from stale PDF app metadata', () => {
    const regions = normalizePageRegions([
      null,
      { regionId: 'region-1', showBackgroundAnnotations: false },
      undefined,
    ]);

    assert.deepEqual(regions.map((region) => region.regionId), ['region-1']);
    assert.equal(regions[0].showCanvasAnnotations, false);
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

  it('ignores null region entries before reading page visibility', () => {
    const state = getPageAnnotationVisibilityState({
      regions: [
        null,
        {
          showCanvasAnnotations: false,
          showSurveyAnnotations: true,
        },
      ],
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

describe('isAnnotationVisibleInContext', () => {
  const spaces = [{
    id: 'space-1',
    assignedPages: [{
      pageId: 1,
      regions: [{ regionId: 'region-1' }],
    }],
  }];

  it('uses the shared survey filter for regular and survey-scoped annotations', () => {
    assert.equal(
      isAnnotationVisibleInContext({
        annotation: { moduleId: null, regionId: null },
        pageNumber: 1,
        selectedSpaceId: 'space-1',
        selectedModuleId: 'module-1',
        showSurveyPanel: true,
      }),
      false
    );

    assert.equal(
      isAnnotationVisibleInContext({
        annotation: { moduleId: 'module-1', regionId: null },
        pageNumber: 1,
        selectedSpaceId: 'space-1',
        selectedModuleId: 'module-1',
        showSurveyPanel: true,
      }),
      true
    );
  });

  it('uses page visibility controls for canvas and survey annotations', () => {
    assert.equal(
      isAnnotationVisibleInContext({
        annotation: { moduleId: null, regionId: null },
        pageNumber: 1,
        selectedSpaceId: 'space-1',
        getCanvasAnnotationVisibilityState: () => false,
      }),
      false
    );

    assert.equal(
      isAnnotationVisibleInContext({
        annotation: { moduleId: 'module-1', regionId: null },
        pageNumber: 1,
        selectedSpaceId: 'space-1',
        selectedModuleId: 'module-1',
        showSurveyPanel: true,
        getSurveyAnnotationVisibilityState: () => false,
      }),
      false
    );
  });

  it('keeps region annotations scoped to the active space', () => {
    assert.equal(getSpaceIdForRegionFromSpaces('region-1', spaces), 'space-1');

    assert.equal(
      isAnnotationVisibleInContext({
        annotation: { moduleId: null, regionId: 'region-1' },
        pageNumber: 1,
        selectedSpaceId: 'space-1',
        activeSpaceId: 'space-1',
        activeRegionId: 'region-1',
        spaces,
      }),
      true
    );

    assert.equal(
      isAnnotationVisibleInContext({
        annotation: { moduleId: null, regionId: 'region-1' },
        pageNumber: 1,
        selectedSpaceId: 'space-1',
        activeSpaceId: 'space-2',
        activeRegionId: 'region-1',
        spaces,
      }),
      false
    );
  });

  it('ignores null active regions when deciding scoped visibility', () => {
    assert.equal(
      isAnnotationVisibleInContext({
        annotation: { moduleId: null, regionId: 'region-1' },
        pageNumber: 1,
        selectedSpaceId: 'space-1',
        activeSpaceId: 'space-1',
        activeRegions: [null],
        activeRegionId: 'region-1',
        spaces,
        isRegionOverlayEnabled: () => true,
      }),
      true
    );
  });

  it('does not treat the transient Fabric visible flag as a visibility rule', () => {
    assert.equal(
      isAnnotationVisibleInContext({
        annotation: { moduleId: null, regionId: null, visible: false },
        pageNumber: 1,
        selectedSpaceId: 'space-1',
      }),
      true
    );
  });

  it('applies the same page visibility rules to callout-shaped annotations', () => {
    const callout = {
      id: 'callout-1',
      pageNumber: 1,
      moduleId: null,
      regionId: null,
      arrowTip: { x: 0.1, y: 0.1 },
      knee: { x: 0.2, y: 0.1 },
      textBoxPosition: { x: 0.25, y: 0.1 },
      textBoxWidth: 0.2,
      textBoxHeight: 0.08,
    };

    assert.equal(
      isAnnotationVisibleInContext({
        annotation: callout,
        pageNumber: 1,
        selectedSpaceId: 'space-1',
        getCanvasAnnotationVisibilityState: () => false,
      }),
      false
    );
  });

  it('applies the same region rules to callout-shaped annotations', () => {
    assert.equal(
      isAnnotationVisibleInContext({
        annotation: {
          id: 'callout-region-1',
          moduleId: null,
          regionId: 'region-1',
          arrowTip: { x: 0.1, y: 0.1 },
          knee: { x: 0.2, y: 0.1 },
          textBoxPosition: { x: 0.25, y: 0.1 },
          textBoxWidth: 0.2,
          textBoxHeight: 0.08,
        },
        pageNumber: 1,
        selectedSpaceId: 'space-1',
        activeSpaceId: 'space-1',
        activeRegionId: 'region-2',
        spaces,
      }),
      false
    );
  });

  it('keeps normal annotations visible outside survey mode even when a survey module is selected', () => {
    assert.equal(
      isAnnotationVisibleInContext({
        annotation: { moduleId: null, regionId: null },
        pageNumber: 1,
        selectedSpaceId: 'space-1',
        selectedModuleId: 'module-1',
        showSurveyPanel: false,
      }),
      true
    );
  });

  it('requires both survey context and matching region context for survey-region annotations', () => {
    const annotation = { moduleId: 'module-1', regionId: 'region-1' };
    const baseContext = {
      annotation,
      pageNumber: 1,
      selectedSpaceId: 'space-1',
      activeSpaceId: 'space-1',
      activeRegionId: 'region-1',
      spaces,
    };

    assert.equal(
      isAnnotationVisibleInContext({
        ...baseContext,
        selectedModuleId: 'module-1',
        showSurveyPanel: true,
      }),
      true
    );

    assert.equal(
      isAnnotationVisibleInContext({
        ...baseContext,
        selectedModuleId: 'module-1',
        showSurveyPanel: false,
      }),
      false
    );

    assert.equal(
      isAnnotationVisibleInContext({
        ...baseContext,
        selectedModuleId: 'module-2',
        showSurveyPanel: true,
      }),
      false
    );

    assert.equal(
      isAnnotationVisibleInContext({
        ...baseContext,
        activeRegionId: 'region-2',
        selectedModuleId: 'module-1',
        showSurveyPanel: true,
      }),
      false
    );
  });
});
