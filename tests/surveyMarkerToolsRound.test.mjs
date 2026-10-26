// Survey marker round 2026-10-22 (owner): a freehand tap is a dot marker,
// the freehand width can change (next marker and a picked one), and a picked
// Survey Marker brings up the survey bar like a picked counter brings up its
// bar.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDotMarkerBounds,
  getMarkerShape,
  markerShapeHitTest,
  MARKER_STROKE_DEFAULT_WIDTH,
  MARKER_STROKE_WIDTHS,
  normalizeMarkerStrokeWidth,
  projectMarkerShape,
  restyleStrokeMarkerBounds,
  buildStrokeMarkerBounds,
  strokeMarkerWidth,
} from '../src/survey/markerShapes.js';
import { nextPickedSurveyMarker } from '../src/survey/usePickedSurveyMarker.js';
import { showsFormatRow, showsSurveyRow } from '../src/utils/toolbarRows.js';

test('a tap makes a round dot marker centred on the press, at the given width', () => {
  const bounds = buildDotMarkerBounds({ x: 100, y: 200 }, { width: 16 });
  assert.ok(getMarkerShape(bounds), 'a valid stroke shape');
  assert.equal(bounds.shape.type, 'stroke');
  assert.equal(bounds.shape.width, 16);
  // The box is the dot: the width each way (plus the hair-wide span).
  assert.equal(bounds.height, 16);
  assert.ok(bounds.width >= 16 && bounds.width <= 17);
  assert.equal(bounds.x + bounds.width / 2, 100);
  assert.equal(bounds.y + bounds.height / 2, 200);
  const projected = projectMarkerShape(bounds.shape, bounds);
  assert.ok(markerShapeHitTest(projected, [100, 200]));
  assert.ok(!markerShapeHitTest(projected, [100, 220]));
});

test('a dot takes [x, y] too and rejects junk', () => {
  assert.ok(buildDotMarkerBounds([5, 5]));
  assert.equal(buildDotMarkerBounds(null), null);
  assert.equal(buildDotMarkerBounds({ x: 'a', y: 1 }), null);
  assert.equal(buildDotMarkerBounds([1, 2], { width: -3 }).shape.width, MARKER_STROKE_DEFAULT_WIDTH);
});

test('stroke widths are safe numbers and the default is on the menu', () => {
  assert.ok(MARKER_STROKE_WIDTHS.includes(MARKER_STROKE_DEFAULT_WIDTH));
  assert.equal(normalizeMarkerStrokeWidth('24'), 24);
  assert.equal(normalizeMarkerStrokeWidth(0), MARKER_STROKE_DEFAULT_WIDTH);
  assert.equal(normalizeMarkerStrokeWidth('wide'), MARKER_STROKE_DEFAULT_WIDTH);
  assert.equal(normalizeMarkerStrokeWidth(9999), MARKER_STROKE_DEFAULT_WIDTH);
});

test('restyling a freehand marker keeps its stroke in place and changes only the width', () => {
  const drawn = buildStrokeMarkerBounds([[10, 10], [60, 10], [110, 40]], { width: 12 });
  const moved = { ...drawn, x: drawn.x + 50, y: drawn.y + 20, angle: 30 };
  assert.equal(strokeMarkerWidth(moved), 12);
  const wider = restyleStrokeMarkerBounds(moved, 24);
  assert.equal(strokeMarkerWidth(wider), 24);
  assert.equal(wider.angle, 30);
  // Same centre, so a rotated marker does not jump.
  const centre = (b) => [b.x + b.width / 2, b.y + b.height / 2];
  assert.deepEqual(centre(wider).map(Math.round), centre(moved).map(Math.round));
  // The box grew by the width change on each side.
  assert.equal(Math.round(wider.width - moved.width), 12);
  // The centreline did not move.
  const before = projectMarkerShape(moved.shape, moved).points;
  const after = projectMarkerShape(wider.shape, wider).points;
  before.forEach(([x, y], i) => {
    assert.ok(Math.abs(after[i][0] - x) < 0.02 && Math.abs(after[i][1] - y) < 0.02);
  });
});

test('a box marker has no stroke width to change', () => {
  const box = { x: 1, y: 2, width: 30, height: 40 };
  assert.equal(strokeMarkerWidth(box), null);
  assert.equal(restyleStrokeMarkerBounds(box, 24), null);
});

test('the picked marker follows the page layers’ selection news', () => {
  const marker = (id) => ({ id, typeKey: 'surveyMarker' });
  let picked = nextPickedSurveyMarker(null, { pageNumber: 2, items: [marker('m1')] });
  assert.deepEqual(picked, { pageNumber: 2, annotationId: 'm1' });
  // The same news again keeps the same object (no re-render).
  assert.equal(nextPickedSurveyMarker(picked, { pageNumber: 2, items: [marker('m1')] }), picked);
  // Another page clearing does not drop it.
  assert.equal(nextPickedSurveyMarker(picked, { pageNumber: 3, items: [] }), picked);
  // Its page clearing does.
  assert.equal(nextPickedSurveyMarker(picked, { pageNumber: 2, items: [] }), null);
  // A marker picked with a shape is a group, not a marker pick.
  assert.equal(nextPickedSurveyMarker(picked, { pageNumber: 2, items: [marker('m1'), { id: 'a', typeKey: 'rect' }] }), null);
  // A plain mark picked anywhere replaces it.
  assert.equal(nextPickedSurveyMarker(picked, { pageNumber: 5, items: [{ id: 'a', typeKey: 'rect' }] }), null);
  assert.equal(nextPickedSurveyMarker(picked, { pageNumber: 'x' }), picked);
});

test('a picked marker shows the survey bar; nothing else changes', () => {
  assert.equal(showsSurveyRow({ showSurveyPanel: true, activeTool: 'pan', surveyMarkerPicked: true }), true);
  assert.equal(showsSurveyRow({ showSurveyPanel: true, activeTool: 'select', surveyMarkerPicked: true }), true);
  assert.equal(showsSurveyRow({ showSurveyPanel: true, activeTool: 'pan' }), false);
  assert.equal(showsSurveyRow({ showSurveyPanel: false, activeTool: 'pan', surveyMarkerPicked: true }), false);
  assert.equal(showsSurveyRow({ showSurveyPanel: true, activeTool: 'region-edit', surveyMarkerPicked: true }), false);
  assert.equal(showsSurveyRow({ showSurveyPanel: true, activeTool: 'survey-marker' }), true);
  // The survey bar takes row 2's place.
  assert.equal(showsFormatRow({ showSurveyPanel: true, activeTool: 'select', contextTool: 'select', surveyMarkerPicked: true }), false);
});

test('the survey bar plans room for the Width pill, and folds it into More', async () => {
  const { SURVEY_BAR_PARTS, planSurveyBar, surveyBarCentreWidth } = await import('../src/utils/responsiveToolbar.js');
  const sizes = { moduleText: 60, categoryCount: 4 };
  const plain = surveyBarCentreWidth('full', sizes).centre;
  const withWidth = surveyBarCentreWidth('full', { ...sizes, markerWidth: true }).centre;
  assert.equal(withWidth - plain, SURVEY_BAR_PARTS.divider + SURVEY_BAR_PARTS.markerWidth);
  // Folded (module and Reuse in More), the pill goes with them.
  assert.equal(surveyBarCentreWidth('fold', { ...sizes, markerWidth: true }).centre, surveyBarCentreWidth('fold', sizes).centre);
  // A window where the bar just fits without the pill gives ground with it.
  const input = { barWidth: 900, centre: 450, templateText: 80, moduleText: 60, categoryCount: 4 };
  const without = planSurveyBar(input);
  const withPill = planSurveyBar({ ...input, markerWidth: true });
  assert.ok(withPill.index >= without.index);
});
