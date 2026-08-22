import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTypedDegrees } from '../src/utils/rotationInputHelpers.js';

// Source contracts for E-02 leftover: RotationInputField type / blur / wrap / Escape.
// Live proof: debug/scenarios/e2e-rotation-input-field.spec.mjs
// Distinct from handle Shift+45°, counter nubbin, survey-marker mtr,
// UL-06 Zoom %, UL-07 page number, leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('RotationInputField commits digits, wraps [0,360), Escape restores, letters/minus blocked', () => {
  const field = read('src/components/RotationInputField.jsx');
  assert.match(field, /aria-label="Rotation angle in degrees"/);
  assert.match(field, /data-rotation-input-field/);
  assert.match(field, /normalizeTypedDegrees/);
  assert.match(field, /if \(e\.key === 'Enter'\)/);
  assert.match(field, /if \(e\.key === 'Escape'\)/);
  assert.match(field, /inputRef\.current\.value = String\(Math\.round\(angleRef\.current\)\)/);
  assert.match(field, /onCancelRef\.current\?\.\(\)/);
  assert.match(field, /Figma\/Excalidraw convention: blur commits/);
  assert.match(field, /commitTyped\(\)/);
  assert.match(field, /Empty = silent revert/);
  assert.match(field, /if \(e\.key\.length === 1 && !\/\^\[0-9\]\$\/\.test\(e\.key\)\)/);
  assert.match(field, /pointerEvents: 'auto'/);
  assert.doesNotMatch(field, /file\.id\s*=/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /handleRotationInputCommit/);
  assert.match(layer, /handleRotationInputCancel/);
  assert.match(layer, /updatedAnnotations\.objects\[annotationIndex\]\.angle = newAngle/);
  assert.match(layer, /source: 'rotation-input'/);
  assert.match(layer, /150ms hover-intent/);

  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.doesNotMatch(overlay, /Rotation angle/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('normalizeTypedDegrees wraps 360/405 and rejects empty / letters', () => {
  assert.equal(normalizeTypedDegrees('90'), 90);
  assert.equal(normalizeTypedDegrees('180'), 180);
  assert.equal(normalizeTypedDegrees('0'), 0);
  assert.equal(normalizeTypedDegrees('359'), 359);
  assert.equal(normalizeTypedDegrees('360'), 0);
  assert.equal(normalizeTypedDegrees('405'), 45);
  assert.equal(normalizeTypedDegrees('720'), 0);
  assert.equal(normalizeTypedDegrees('45.7'), 46);
  assert.equal(normalizeTypedDegrees(''), null);
  assert.equal(normalizeTypedDegrees('abc'), null);
  assert.equal(normalizeTypedDegrees('  '), null);
  assert.equal(normalizeTypedDegrees(null), null);
});

test('live spec covers type / blur / wrap / Escape / Line omit / 390 / file.id', () => {
  const spec = read('debug/scenarios/e2e-rotation-input-field.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop RotationInputField intended \+ break \+ edge/);
  assert.match(spec, /390 RotationInputField intended \+ break \+ edge/);
  assert.match(spec, /Rotation angle in degrees/);
  assert.match(spec, /typed 90 must commit 90/);
  assert.match(spec, /click-away blur must commit 180/);
  assert.match(spec, /360 must wrap to 0/);
  assert.match(spec, /405 must wrap to 45/);
  assert.match(spec, /empty Enter must restore 45/);
  assert.match(spec, /letters must restore 45/);
  assert.match(spec, /minus must restore 45/);
  assert.match(spec, /Escape must restore 45 and not commit 270/);
  assert.match(spec, /Line single-click mtr must be 0/);
  assert.match(spec, /second rect must isolate the first angle/);
  assert.match(spec, /Pen-armed 135 must commit/);
  assert.match(spec, /390 typed 90 must commit 90/);
  assert.match(spec, /390 Escape must restore 90 and not commit 270/);
  assert.match(spec, /390 360 must wrap to 0/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
