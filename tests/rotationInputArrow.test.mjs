import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTypedDegrees } from '../src/utils/rotationInputHelpers.js';

// Source contracts for E-02 leftover: RotationInputField Arrow ±1 / Shift+Arrow ±45.
// Live proof: debug/scenarios/e2e-rotation-input-arrow.spec.mjs
// Distinct from typed pill, canvas mtr Shift+45 snap, free-drag 90/180,
// group-rotate 15°, leftover-18. P1-32 hold-arrow coalescing is not this leftover.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function stepDegrees(current, key, shift) {
  const delta = (shift ? 45 : 1) * (key === 'ArrowUp' ? 1 : -1);
  return normalizeTypedDegrees(current + delta);
}

test('Arrow ±1 and Shift+Arrow ±45 wrap in [0,360)', () => {
  assert.equal(stepDegrees(0, 'ArrowUp', false), 1);
  assert.equal(stepDegrees(1, 'ArrowUp', false), 2);
  assert.equal(stepDegrees(2, 'ArrowDown', false), 1);
  assert.equal(stepDegrees(1, 'ArrowUp', true), 46);
  assert.equal(stepDegrees(46, 'ArrowDown', true), 1);
  assert.equal(stepDegrees(0, 'ArrowUp', true), 45);
  assert.equal(stepDegrees(45, 'ArrowUp', true), 90);
  assert.equal(stepDegrees(359, 'ArrowUp', false), 0);
  assert.equal(stepDegrees(0, 'ArrowDown', false), 359);
  assert.equal(stepDegrees(350, 'ArrowUp', true), 35);
  assert.equal(stepDegrees(10, 'ArrowDown', true), 325);
});

test('RotationInputField window-capture Arrow path is ±1 / Shift ±45 and immediate commit', () => {
  const field = read('src/components/RotationInputField.jsx');
  assert.match(field, /aria-label="Rotation angle in degrees"/);
  assert.match(field, /if \(e\.key === 'ArrowUp' \|\| e\.key === 'ArrowDown'\)/);
  assert.match(field, /const step = \(e\.shiftKey \? 45 : 1\) \* \(e\.key === 'ArrowUp' \? 1 : -1\)/);
  assert.match(field, /normalizeTypedDegrees\(base \+ step\)/);
  assert.match(field, /onCommitRef\.current\?\.\(annotationIndexRef\.current, next,/);
  assert.match(field, /ArrowUp\/ArrowDown\s+= ±1° immediate commit/);
  assert.match(field, /Shift\+ArrowUp\/Down\s+= ±45° immediate commit/);
  assert.match(field, /const NAV = new Set\(\['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight'/);
  assert.doesNotMatch(field, /file\.id\s*=/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /handleRotationInputCommit/);
  assert.match(layer, /source: 'rotation-input'/);
  assert.match(layer, /updatedAnnotations\.objects\[annotationIndex\]\.angle = newAngle/);

  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.doesNotMatch(overlay, /Rotation angle/);

  const hook = read('src/hooks/useSVGInteraction.js');
  assert.match(hook, /if \(e\.shiftKey\) \{\s*newAngle = snapAngleToNearest45\(newAngle, 3\)/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers Arrow ±1 / Shift+46 / wrap / unfocused / Line omit / 390 / file.id', () => {
  const spec = read('debug/scenarios/e2e-rotation-input-arrow.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop RotationInputField Arrow nudge intended \+ break \+ edge/);
  assert.match(spec, /390 RotationInputField Arrow nudge intended \+ break \+ edge/);
  assert.match(spec, /ArrowUp from 0 must commit 1/);
  assert.match(spec, /second ArrowUp must commit 2/);
  assert.match(spec, /ArrowDown from 2 must commit 1/);
  assert.match(spec, /Shift\+ArrowUp from 1 must commit 46/);
  assert.match(spec, /Shift\+ArrowDown from 46 must commit 1/);
  assert.match(spec, /Shift\+ArrowUp from 0 must commit 45/);
  assert.match(spec, /second Shift\+ArrowUp must commit 90/);
  assert.match(spec, /ArrowLeft\/Right must not step the angle/);
  assert.match(spec, /ArrowUp from 359 must wrap to 0/);
  assert.match(spec, /ArrowDown from 0 must wrap to 359/);
  assert.match(spec, /Shift\+ArrowUp from 350 must wrap to 35/);
  assert.match(spec, /Shift\+ArrowDown from 10 must wrap to 325/);
  assert.match(spec, /unfocused ArrowUp must not rotate/);
  assert.match(spec, /Line single-click mtr must be 0/);
  assert.match(spec, /B ArrowUp must isolate A at 45/);
  assert.match(spec, /390 ArrowUp from 0 must commit 1/);
  assert.match(spec, /390 Shift\+ArrowUp from 1 must commit 46/);
  assert.match(spec, /390 ArrowUp from 359 must wrap to 0/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /dragMtrToAngle|snapAngleToNearest45/);
  assert.doesNotMatch(spec, /typed 90 must commit 90|click-away blur must commit 180/);
  assert.doesNotMatch(spec, /setActiveTool\('pan'\)|keyboard\.down\('Space'\)/);
});
