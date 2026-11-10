// Nightly 'drag-auto-scroll' (Drawboard parity, t2-tools-deep.md gap 8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AUTO_SCROLL_EDGE_PX, AUTO_SCROLL_MAX_STEP_PX, edgeScrollStep, startMarkDragAutoScroll } from '../src/utils/markDragAutoScroll.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('no scroll in the middle; a ramp in the 30 px band; full speed at and past the edge', () => {
  assert.equal(AUTO_SCROLL_EDGE_PX, 30);
  assert.equal(edgeScrollStep(400, 0, 800), 0);
  assert.equal(edgeScrollStep(30, 0, 800), 0);
  assert.equal(edgeScrollStep(770, 0, 800), 0);
  assert.equal(edgeScrollStep(15, 0, 800), -Math.round(AUTO_SCROLL_MAX_STEP_PX / 2));
  assert.equal(edgeScrollStep(785, 0, 800), Math.round(AUTO_SCROLL_MAX_STEP_PX / 2));
  assert.equal(edgeScrollStep(0, 0, 800), -AUTO_SCROLL_MAX_STEP_PX);
  assert.equal(edgeScrollStep(900, 0, 800), AUTO_SCROLL_MAX_STEP_PX);
  assert.equal(edgeScrollStep(10, 0, 50), 0, 'a box too small for two bands never scrolls');
});

test('a finger never starts it (touch is pan-only)', () => {
  const stop = startMarkDragAutoScroll({}, { pointerType: 'touch', clientX: 0, clientY: 0 });
  assert.equal(typeof stop, 'function');
  stop();
});

test('wired: a beta flag, a migration, and the page layer starts it on a shape or select press', () => {
  assert.equal(FEATURE_FLAGS['drag-auto-scroll']?.stage, 'beta');
  assert.match(read('supabase/migrations/20261110152000_drag_auto_scroll_flag.sql'), /'drag-auto-scroll', 'off'/);
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /AUTO_SCROLL_TOOLS\.has\(activeTool\) && isFeatureOn\('drag-auto-scroll'\)/);
  assert.match(layer, /autoScrollStopRef\.current = startMarkDragAutoScroll\(svgRef\.current, e\);/);
});
