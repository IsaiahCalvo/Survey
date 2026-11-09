/**
 * Smooth jump to a search hit or a Survey Marker (owner 2026-11-09): "it's
 * just snapping ... I want it to be an animation. If it's on different pages,
 * it should scroll to it ... [a survey] should pan and zoom to it."
 *
 * Part 1 unit-tests the pure rules in src/utils/viewerFlyTo.js and the glide
 * length option in src/utils/zoomGlide.js. Part 2 guards the wiring in the
 * viewer (source-assertion style, like the other viewer contract tests).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FLY_MAX_MS,
  FLY_MIN_MS,
  flyDurationMs,
  flyPanAt,
  isPointInBand,
} from '../src/utils/viewerFlyTo.js';
import {
  ZOOM_GLIDE_MS,
  createZoomGlide,
  retargetZoomGlide,
  stepZoomGlide,
} from '../src/utils/zoomGlide.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// ------------------------------------------------------------- pure rules

test('a target on screen flies straight there; one off screen scrolls first', () => {
  const band = { left: 300, top: 60, width: 900, height: 700 };
  assert.equal(isPointInBand(700, 400, band), true);
  assert.equal(isPointInBand(700, 2400, band), false, 'a page further down');
  assert.equal(isPointInBand(100, 400, band), false, 'under the left panel');
  assert.equal(isPointInBand(700, 30, band), false, 'under the tool strip');
  assert.equal(isPointInBand(NaN, 400, band), false);
});

test('the fly step lasts longer for a bigger zoom or pan, inside fixed limits', () => {
  const still = flyDurationMs({ fromScale: 1, toScale: 1, panPx: 0, screenPx: 800 });
  assert.equal(still, FLY_MIN_MS);
  const small = flyDurationMs({ fromScale: 1, toScale: 1.4, panPx: 200, screenPx: 800 });
  const big = flyDurationMs({ fromScale: 0.4, toScale: 2.4, panPx: 700, screenPx: 800 });
  assert.ok(small > FLY_MIN_MS && small < big, `${small} < ${big}`);
  assert.ok(big <= FLY_MAX_MS);
  assert.equal(flyDurationMs({ fromScale: 0.1, toScale: 8, panPx: 9000, screenPx: 800 }), FLY_MAX_MS);
  // Zooming out costs the same as zooming in by the same factor.
  assert.equal(
    flyDurationMs({ fromScale: 2, toScale: 1, screenPx: 800 }),
    flyDurationMs({ fromScale: 1, toScale: 2, screenPx: 800 }),
  );
});

test('the target slides on the same ease-out the zoom uses and lands exactly', () => {
  const pan = { fromX: 100, fromY: 900, toX: 600, toY: 400, t0: 1000, durationMs: 400 };
  assert.deepEqual(flyPanAt(pan, 1000), { x: 100, y: 900, done: false });
  const mid = flyPanAt(pan, 1200);
  // easeOutCubic(0.5) = 0.875: most of the move is in the first half.
  assert.ok(Math.abs(mid.x - (100 + 500 * 0.875)) < 1e-9);
  assert.ok(Math.abs(mid.y - (900 - 500 * 0.875)) < 1e-9);
  assert.deepEqual(flyPanAt(pan, 1400), { x: 600, y: 400, done: true });
  assert.deepEqual(flyPanAt(pan, 99999), { x: 600, y: 400, done: true });
  assert.equal(flyPanAt(null, 0), null);
  // The zoom tween at the same moment has covered the same share (log space).
  const glide = createZoomGlide({ from: 1, to: 4, now: 1000, durationMs: 400 });
  const shown = stepZoomGlide(glide, 1200).shown;
  assert.ok(Math.abs(Math.log(shown) / Math.log(4) - 0.875) < 1e-9);
});

test('a zoom glide can be given its own length; buttons keep the old one', () => {
  const button = createZoomGlide({ from: 1, to: 2, now: 0 });
  assert.equal(button.durationMs, ZOOM_GLIDE_MS);
  assert.equal(stepZoomGlide(button, ZOOM_GLIDE_MS).done, true);
  const jump = createZoomGlide({ from: 1, to: 2, now: 0, durationMs: 450 });
  assert.equal(stepZoomGlide(jump, ZOOM_GLIDE_MS).done, false);
  assert.equal(stepZoomGlide(jump, 450).done, true);
  assert.equal(stepZoomGlide(jump, 450).shown, 2);
});

test('a press or wheel notch during a jump turns it into an ordinary zoom', () => {
  const jump = createZoomGlide({ from: 1, to: 2, now: 0, durationMs: 450 });
  jump.pan = { fromX: 0, fromY: 0, toX: 10, toY: 10, t0: 0, durationMs: 450 };
  const mid = stepZoomGlide(jump, 100);
  assert.ok(mid.pan, 'stepping keeps the pan');
  const pressed = retargetZoomGlide(mid, { to: 3, now: 100, mode: 'tween' });
  assert.equal(pressed.pan, null);
  assert.equal(pressed.durationMs, ZOOM_GLIDE_MS);
});

// ---------------------------------------------------------------- wiring

const container = read('../src/components/PdfjsViewerContainer.jsx');
const viewer = read('../src/PDFViewer.jsx');
const focus = container.slice(
  container.indexOf('const focusPageRect = useCallback('),
  container.indexOf('const glideScrollTopTo = useCallback('),
);

test('focusPageRect `animate`: scroll when off screen, then pan + zoom on the live-zoom glide', () => {
  assert.match(focus, /options\.animate === true/);
  assert.match(focus, /!prefersReducedMotion\(\)/, 'reduced motion lands at once');
  assert.match(focus, /isPointInBand\(/);
  assert.match(focus, /glideFlight\(getHorizontalScrollMax, p0\.x - viewCx, p0\.y - viewCy, bandW, bandH, token, fly\)/);
  // The zoomGeneration contract: the zoom start is signalled as for any zoom.
  assert.match(focus, /onZoomPhase\?\.\('gesture-start'/);
  assert.match(focus, /createZoomGlide\(\{ from: s0, to: finalScale, now, mode: 'tween', durationMs \}\)/);
  assert.match(focus, /glide\.pan = \{ fromX: sx, fromY: sy, toX: viewCx, toY: viewCy, t0: now, durationMs \}/);
  // A newer jump lands the older one where it is shown, then moves on.
  assert.match(focus, /cancelFlight\(\);\s*if \(options\.animate === true\) zoomGlideFinishRef\.current\?\.\(\);/);
});

test('the zoom glide frame moves the target while the page grows', () => {
  const step = container.slice(container.indexOf('zoomGlideStepRef.current = (now) => {'));
  assert.match(step.slice(0, 1400), /if \(next\.pan\) \{[\s\S]*?flyPanAt\(next\.pan, now\)[\s\S]*?currentCursorX/);
});

test('the scroll step stops when the person scrolls, zooms or pinches', () => {
  const glide = container.slice(container.indexOf('const glideFlight = useCallback('));
  assert.match(glide.slice(0, 2400), /shouldStop: \(\) => Math\.abs\(scaleRef\.current - startScale\) > 1e-4/);
  assert.match(glide.slice(0, 2400), /if \(failed\) \{ cancelFlight\(\); return; \}/);
});

test('Locate on page animates and zooms less than before (owner 2026-11-09)', () => {
  assert.match(viewer, /const SURVEY_LOCATE_FILL = 0\.2;/);
  assert.match(viewer, /const SURVEY_LOCATE_MAX_FIT_MULTIPLE = 3;/);
  assert.doesNotMatch(viewer, /SURVEY_LOCATE_MAX_SCALE/);
  const locate = viewer.slice(viewer.indexOf('const handleLocateItemOnPDF = useCallback('));
  assert.match(locate.slice(0, 3000), /maxFitMultiple: SURVEY_LOCATE_MAX_FIT_MULTIPLE,\s*animate: true,/);
  // An animated move does not cut to the page first.
  const markFocus = viewer.slice(viewer.indexOf('const focusHistoryMark = useCallback('));
  assert.match(markFocus.slice(0, 900), /options\.animate !== true/);
});
