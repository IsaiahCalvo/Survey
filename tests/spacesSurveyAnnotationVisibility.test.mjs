import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANNOTATION_VISIBILITY_SCOPE,
  PAGE_VISIBILITY_CONTROL_MODE,
  getPageAnnotationVisibilityState,
  getPageVisibilityControlMode,
  isAnnotationVisibleByPageControl,
} from '../src/utils/annotationVisibilityRules.js';

// Live proof: debug/scenarios/e2e-spaces-survey-annotation-visibility.spec.mjs
// Unique leftover after Spaces space-card reorder: region-row Hide/Show
// survey annotations (aria-label="Hide survey annotations" /
// onToggleSurveyAnnotations). Sibling of canvas Hide/Show. Survey-context
// only. Not leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('SpacesPanel survey light-bulb is survey-context only and distinct from canvas', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  const block = panel.slice(
    panel.indexOf('{isExpanded && (() => {'),
    panel.indexOf('className="region-delete-button"'),
  );
  assert.match(block, /className="region-visibility-button"/);
  assert.match(block, /Hide survey annotations/);
  assert.match(block, /Show survey annotations/);
  assert.match(block, /onToggleSurveyAnnotations/);
  assert.match(block, /getSurveyAnnotationVisibilityState/);
  assert.match(block, /PAGE_VISIBILITY_CONTROL_MODE\.SURVEY/);
  assert.match(block, /isDisabled = !isActive \|\| activeSpaceId === null/);
  assert.match(block, /Toggle is only available when a space is active/);
  assert.doesNotMatch(block, /Hide overlay for this region/);
  assert.doesNotMatch(block, /data-region-overlay-toggle/);
  assert.doesNotMatch(block, /__e2eSpaces/);
  assert.equal(
    getPageVisibilityControlMode({ showSurveyPanel: false, selectedModuleId: 'm1' }),
    PAGE_VISIBILITY_CONTROL_MODE.CANVAS,
  );
  assert.equal(
    getPageVisibilityControlMode({ showSurveyPanel: true, selectedModuleId: 'm1' }),
    PAGE_VISIBILITY_CONTROL_MODE.SURVEY,
  );
  assert.equal(
    getPageVisibilityControlMode({ showSurveyPanel: true, selectedModuleId: null }),
    PAGE_VISIBILITY_CONTROL_MODE.CANVAS,
  );
});

test('handleToggleSurveyAnnotations checkpoints space:update only on a real flip', () => {
  const viewer = read('src/PDFViewer.jsx');
  const start = viewer.indexOf('const handleToggleSurveyAnnotations = useCallback');
  assert.ok(start > 0, 'handleToggleSurveyAnnotations');
  const block = viewer.slice(start, viewer.indexOf('// UX 2026-04-23: Cmd/Ctrl+P', start));
  assert.match(block, /getPageAnnotationVisibilityState\(livePage\)\.surveyVisible/);
  assert.match(block, /if \(current === value\) \{\s*return;/s);
  assert.match(block, /addHistoryCheckpoint\('space:update'/);
  assert.match(block, /updateKeys: \['assignedPages'\]/);
  assert.match(block, /setPageAnnotationVisibilityState\(spaceId, pageId, \{ surveyVisible: value \}\)/);
  assert.doesNotMatch(block, /__e2eSpaces/);
  assert.doesNotMatch(block, /file\.id/);

  const setter = viewer.slice(
    viewer.indexOf('const setPageAnnotationVisibilityState = useCallback'),
    viewer.indexOf('const handleToggleCanvasAnnotations'),
  );
  assert.match(setter, /all areas on the page share it/);
  assert.match(setter, /showSurveyAnnotations: updates\.surveyVisible/);
});

test('page visibility control hides survey scope only; canvas and region scopes stay', () => {
  assert.equal(
    isAnnotationVisibleByPageControl({
      scope: ANNOTATION_VISIBILITY_SCOPE.SURVEY,
      surveyVisible: false,
    }),
    false,
  );
  assert.equal(
    isAnnotationVisibleByPageControl({
      scope: ANNOTATION_VISIBILITY_SCOPE.CANVAS,
      surveyVisible: false,
    }),
    true,
  );
  assert.equal(
    isAnnotationVisibleByPageControl({
      scope: ANNOTATION_VISIBILITY_SCOPE.SURVEY_REGION,
      surveyVisible: false,
    }),
    true,
  );
  assert.deepStrictEqual(
    getPageAnnotationVisibilityState({
      regions: [
        { showSurveyAnnotations: false },
        { showSurveyAnnotations: true },
      ],
    }),
    { canvasVisible: true, surveyVisible: false },
  );
});
