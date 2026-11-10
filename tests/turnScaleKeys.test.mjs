// Nightly 'turn-scale-keys': Ctrl / Cmd + arrows turn and scale the picked
// mark (Drawboard Projects KS-01 / KS-02).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scaleObjectBy, turnScaleKeyStep } from '../src/utils/selectionProperties.js';
import { getAnnotationBBox } from '../src/utils/svgBoundingBox.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const centre = (o) => { const b = getAnnotationBBox(o); return [b.left + b.width / 2, b.top + b.height / 2]; };

test('the keys: Ctrl / Cmd + Left / Right turn 1° (Shift 5°), Up / Down scale 10%', () => {
  assert.deepEqual(turnScaleKeyStep({ key: 'ArrowRight', ctrlKey: true }), { op: 'turn', by: 1 });
  assert.deepEqual(turnScaleKeyStep({ key: 'ArrowLeft', metaKey: true, shiftKey: true }), { op: 'turn', by: -5 });
  assert.equal(turnScaleKeyStep({ key: 'ArrowUp', ctrlKey: true }).factor, 1.1);
  assert.ok(Math.abs(turnScaleKeyStep({ key: 'ArrowDown', ctrlKey: true }).factor - 1 / 1.1) < 1e-9);
  assert.equal(turnScaleKeyStep({ key: 'ArrowUp' }), null, 'a plain arrow is the nudge');
  assert.equal(turnScaleKeyStep({ key: 'ArrowUp', ctrlKey: true, altKey: true }), null);
  assert.equal(turnScaleKeyStep({ key: 'ArrowUp', ctrlKey: true, shiftKey: true }), null);
});

test('a box mark scales about its centre, and back again', () => {
  const rect = { type: 'rect', left: 10, top: 20, width: 100, height: 50, scaleX: 1, scaleY: 1, strokeWidth: 2, angle: 30 };
  const big = scaleObjectBy(rect, 1.1);
  assert.ok(Math.abs(big.scaleX - 1.1) < 1e-9 && Math.abs(big.scaleY - 1.1) < 1e-9);
  centre(big).forEach((v, i) => assert.ok(Math.abs(v - centre(rect)[i]) < 1e-6));
  const back = scaleObjectBy(big, 1 / 1.1);
  assert.ok(Math.abs(back.left - rect.left) < 1e-6 && Math.abs(back.top - rect.top) < 1e-6);
});

test('text scales its box and its font; marks it cannot size are left alone', () => {
  const text = { type: 'textbox', left: 0, top: 0, width: 120, height: 30, fontSize: 12, text: 'Hi' };
  const big = scaleObjectBy(text, 1.1);
  assert.ok(Math.abs(big.fontSize - 13.2) < 1e-9 && Math.abs(big.width - 132) < 1e-9);
  assert.equal(scaleObjectBy({ type: 'line', x1: 0, y1: 0, x2: 10, y2: 10 }, 1.1), null);
  assert.equal(scaleObjectBy({ type: 'rect', left: 0, top: 0, width: 1, height: 1 }, 0.5), null, 'never under 1 pt');
});

test('wired: a beta flag, a migration, and a front-tab key listener on the page layer', () => {
  assert.equal(FEATURE_FLAGS['turn-scale-keys']?.stage, 'beta');
  assert.match(read('supabase/migrations/20261110154000_turn_scale_keys_flag.sql'), /'turn-scale-keys', 'off'/);
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /if \(e\.defaultPrevented \|\| !isFeatureOn\('turn-scale-keys'\)\) return;/);
  assert.match(layer, /if \(!t\?\.keysLive\) return;/);
  assert.match(layer, /keysLive: isTabActive && editingAnnotationIndex == null && !editingCalloutId/);
});
