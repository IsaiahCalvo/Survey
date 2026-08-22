import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANNOTATION_VISIBILITY_SCOPE,
  getPageAnnotationVisibilityState,
  isAnnotationVisibleByPageControl,
} from '../src/utils/annotationVisibilityRules.js';

// Live proof: debug/scenarios/e2e-spaces-region-visibility.spec.mjs
// Unique leftover after Spaces region-row rename: Hide/Show canvas
// annotations (region-visibility-button). Distinct from overlay Hide/Show.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('SpacesPanel region-row light-bulb is distinct from the overlay switch', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  const start = panel.indexOf('className="region-visibility-button"');
  assert.ok(start > 0, 'region-visibility-button');
  const block = panel.slice(
    panel.indexOf('{isExpanded && (() => {'),
    panel.indexOf('className="region-delete-button"'),
  );
  assert.match(block, /className="region-visibility-button"/);
  assert.match(block, /Hide canvas annotations/);
  assert.match(block, /Show canvas annotations/);
  assert.match(block, /onToggleCanvasAnnotations/);
  assert.match(block, /getCanvasAnnotationVisibilityState/);
  assert.match(block, /isDisabled = !isActive \|\| activeSpaceId === null/);
  assert.match(block, /Toggle is only available when a space is active/);
  assert.doesNotMatch(block, /Hide overlay for this region/);
  assert.doesNotMatch(block, /data-region-overlay-toggle/);
  assert.doesNotMatch(block, /__e2eSpaces/);
});

test('handleToggleCanvasAnnotations checkpoints space:update only on a real flip', () => {
  const viewer = read('src/PDFViewer.jsx');
  const start = viewer.indexOf('const handleToggleCanvasAnnotations = useCallback');
  assert.ok(start > 0, 'handleToggleCanvasAnnotations');
  const block = viewer.slice(start, viewer.indexOf('const handleToggleSurveyAnnotations', start));
  assert.match(block, /getPageAnnotationVisibilityState\(livePage\)\.canvasVisible/);
  assert.match(block, /if \(current === value\) \{\s*return;/s);
  assert.match(block, /addHistoryCheckpoint\('space:update'/);
  assert.match(block, /updateKeys: \['assignedPages'\]/);
  assert.match(block, /setPageAnnotationVisibilityState\(spaceId, pageId, \{ canvasVisible: value \}\)/);
  assert.doesNotMatch(block, /__e2eSpaces/);
  assert.doesNotMatch(block, /file\.id/);

  const setter = viewer.slice(
    viewer.indexOf('const setPageAnnotationVisibilityState = useCallback'),
    viewer.indexOf('const handleToggleCanvasAnnotations'),
  );
  assert.match(setter, /all areas on the page share it/);
  assert.match(setter, /showCanvasAnnotations: updates\.canvasVisible/);
});

test('page visibility control hides canvas scope only; regions share the page flag', () => {
  assert.equal(
    isAnnotationVisibleByPageControl({
      scope: ANNOTATION_VISIBILITY_SCOPE.CANVAS,
      canvasVisible: false,
    }),
    false,
  );
  assert.equal(
    isAnnotationVisibleByPageControl({
      scope: ANNOTATION_VISIBILITY_SCOPE.REGION,
      canvasVisible: false,
    }),
    true,
  );
  assert.deepStrictEqual(
    getPageAnnotationVisibilityState({
      regions: [
        { showCanvasAnnotations: false },
        { showCanvasAnnotations: true },
      ],
    }),
    { canvasVisible: false, surveyVisible: true },
  );
});
