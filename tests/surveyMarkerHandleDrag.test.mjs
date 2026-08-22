import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Survey-marker handle drag leftover after counter nubbin / Shift-orbit.
// Live proof: debug/scenarios/e2e-survey-marker-handle-drag.spec.mjs
// Not Walls stamp-create, not Keep-active after-place, not notes.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('placed survey-marker chrome is body-move + 8 resize + mtr rotate', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const overlay = read('src/components/SVGSelectionOverlay.jsx');
  assert.match(layer, /mode: 'move'/);
  assert.match(layer, /mode: handleId === 'mtr' \? 'rotate' : 'resize'/);
  assert.match(layer, /handleSurveyMarkerHandlePointerDown/);
  assert.match(layer, /data-survey-marker-hit-target="true"/);
  assert.match(layer, /onHandleDrag=\{\(e, handleId\) => handleSurveyMarkerHandlePointerDown\(e, entry, handleId\)\}/);
  assert.match(layer, /if \(surveyMarkerDragRef\.current && updateSurveyMarkerDrag\(e, true\)\) return;/);
  assert.match(layer, /action: drag\.mode/);
  assert.match(overlay, /data-resize-handle=\{id\}/);
  assert.match(overlay, /data-rotation-handle="mtr"/);
  assert.match(overlay, /const cornerHandles = \['tl', 'tr', 'bl', 'br'\]/);
  const surveyChrome = layer.slice(
    layer.indexOf('const handleSurveyMarkerPointerDown'),
    layer.indexOf('const selectedSurveyMarkerEntry'),
  );
  assert.ok(surveyChrome.length > 200);
  assert.doesNotMatch(surveyChrome, /data-handle=\{`vertex-\$\{/);
  assert.doesNotMatch(surveyChrome, /data-counter-nubbin-handle/);
  assert.match(surveyChrome, /data-survey-marker-hit-target="true"/);
  assert.ok(layer.includes('viewBox={`0 0 ${width} ${height}`}'));
});

test('PDFViewer persists x/y/width/height/angle from handle commit', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const handleSurveyMarkerBoundsChange = useCallback/);
  assert.match(viewer, /addHistoryCheckpoint\(`survey-marker:\$\{meta\.action \|\| 'bounds'\}`/);
  assert.match(viewer, /angle: nextAngle/);
  assert.match(viewer, /canModifySurveyMarker/);
  assert.match(viewer, /canEnterBBoxEdit: !!\(selectedToolbarAnnotation && \(\(\) => \{/);
  assert.match(viewer, /annotation\?\.data\?\.type === 'counter'/);
  assert.doesNotMatch(viewer, /canEnterBBoxEdit[\s\S]{0,400}survey-marker/);
});

test('Keep-active stays armed; handle path is Select-only so drag does not stamp', () => {
  const keep = read('src/utils/surveyKeepActive.js');
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(keep, /nextTool: 'survey-marker'/);
  assert.match(layer, /if \(!isSelectTool \|\| !entry\?\.surveyMarker\?\.annotationId\) return;/);
  assert.match(layer, /pointerEvents: isSelectTool \? 'auto' : 'none'/);
  assert.match(layer, /if \(tool === 'survey-marker'\)/);
  assert.match(layer, /onSurveyMarkerCreated\(\{ x: left, y: top, width: markerWidth, height: markerHeight \}\)/);
});
