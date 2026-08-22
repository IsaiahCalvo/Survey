import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyHueKey,
  applySpectrumKey,
  hsvToHex,
  SPECTRUM_HUE_KEYS,
  SPECTRUM_SV_KEYS,
} from '../src/utils/annotationStyleCatalog.js';

// Source contracts for C-04 leftover: Color spectrum HSV.
// Live proof: debug/scenarios/e2e-color-spectrum.spec.mjs
// Distinct from C-01 grid, C-02 hex, C-03 opacity, leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('spectrum SV keys clamp; unused keys are ignored', () => {
  assert.deepEqual(SPECTRUM_SV_KEYS, [
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End',
  ]);
  assert.deepEqual(applySpectrumKey('Home', 80, 40), { saturation: 0, value: 40 });
  assert.deepEqual(applySpectrumKey('End', 80, 40), { saturation: 100, value: 40 });
  assert.deepEqual(applySpectrumKey('ArrowLeft', 0, 50), { saturation: 0, value: 50 });
  assert.deepEqual(applySpectrumKey('ArrowRight', 100, 50), { saturation: 100, value: 50 });
  assert.deepEqual(applySpectrumKey('PageDown', 50, 5), { saturation: 50, value: 0 });
  assert.deepEqual(applySpectrumKey('PageUp', 50, 95), { saturation: 50, value: 100 });
  assert.equal(applySpectrumKey('x', 50, 50), null);
  assert.equal(applySpectrumKey('Enter', 50, 50), null);
  assert.equal(hsvToHex(0, 0, 100), '#FFFFFF');
  assert.equal(hsvToHex(0, 100, 100), '#FF0000');
  assert.equal(hsvToHex(120, 100, 100), '#00FF00');
});

test('hue keys clamp 0–360 and do not wrap', () => {
  assert.deepEqual(SPECTRUM_HUE_KEYS, [
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End',
  ]);
  assert.equal(applyHueKey('Home', 180), 0);
  assert.equal(applyHueKey('End', 180), 360);
  assert.equal(applyHueKey('ArrowLeft', 0), 0);
  assert.equal(applyHueKey('ArrowRight', 360), 360);
  assert.equal(applyHueKey('PageUp', 0), 10);
  assert.equal(applyHueKey('PageDown', 5), 0);
  assert.equal(applyHueKey('x', 90), null);
  let hue = 0;
  for (let i = 0; i < 12; i += 1) hue = applyHueKey('PageUp', hue);
  assert.equal(hue, 120);
  assert.equal(hsvToHex(360, 100, 100), hsvToHex(0, 100, 100));
});

test('CompactColorPicker spectrum uses pointer capture + catalog keys', () => {
  const picker = read('src/components/CompactColorPicker.jsx');
  assert.match(picker, /aria-label="Color spectrum"/);
  assert.match(picker, /data-color-picker-spectrum="true"/);
  assert.match(picker, /data-color-picker-hue="true"/);
  assert.match(picker, /aria-label="Saturation and brightness"/);
  assert.match(picker, /aria-label="Hue"/);
  assert.match(picker, /Pointer capture keeps both mouse and finger drags live/);
  assert.match(picker, /setPointerCapture/);
  assert.match(picker, /applySpectrumKey\(event\.key, saturation, value\)/);
  assert.match(picker, /applyHueKey\(event\.key, hue\)/);
  assert.match(picker, /Math\.max\(0, Math\.min\(e\.clientX - rect\.left, rect\.width\)\)/);
  assert.match(picker, /prev === 360 && hsv\.h === 0 \? 360 : hsv\.h/);
  assert.doesNotMatch(picker, /hue\s*\+\s*360|hue\s*%\s*360/);
});

test('live C-04 spec covers write, clamp, out-of-bounds, 390, hub, file.id', () => {
  const spec = read('debug/scenarios/e2e-color-spectrum.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Color spectrum intended \+ break \+ edge/);
  assert.match(spec, /390 Color spectrum intended \+ break \+ edge/);
  assert.match(spec, /Color spectrum/);
  assert.match(spec, /data-color-picker-spectrum/);
  assert.match(spec, /data-color-picker-hue/);
  assert.match(spec, /SV left-top \/ out-of-bounds must write white/);
  assert.match(spec, /hue 120 must write green/);
  assert.match(spec, /function isSpectrumGreen/);
  assert.match(spec, /function nudgeHueTo/);
  assert.match(spec, /hue clamps, it does not wrap/);
  assert.match(spec, /unused keys do not steal/);
  assert.match(spec, /Pen hides Color spectrum/);
  assert.match(spec, /hubPreview Color spectrum must be 0/);
  assert.match(spec, /0 0 612 792/);
  assert.match(spec, /Do not stamp/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /390 chip sheet is not the spectrum/);
  assert.match(spec, /next-draw stamps green/);
  assert.match(spec, /closePagesOverlay\(page\)/);

  const hex = read('debug/scenarios/e2e-hex-lengths.spec.mjs');
  assert.doesNotMatch(hex, /data-color-picker-spectrum/);
});
