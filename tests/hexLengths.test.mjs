import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeHexColor,
  isValidHexColor,
  applyColorPickerSelection,
  hexToHsv,
} from '../src/utils/annotationStyleCatalog.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const INTENDED = [
  ['#FF0000', '#FF0000'],
  ['ff0000', '#FF0000'],
  ['#f00', '#FF0000'],
  ['f00', '#FF0000'],
  ['#0f0', '#00FF00'],
  ['0f0', '#00FF00'],
  ['#00F', '#0000FF'],
  ['abc', '#AABBCC'],
  ['#FF8000', '#FF8000'],
  ['  00f  ', '#0000FF'],
  ['#AbC', '#AABBCC'],
];

const REJECTED = [
  '',
  '#',
  'red',
  'blue',
  'transparent',
  'rgba(255,0,0,1)',
  'rgb(0, 128, 0)',
  'FF00',
  '#F0F0',
  '12345',
  '#12345',
  '1234567',
  '#1234567',
  'FF0000FF',
  '#AABBCCDD',
  'zzzzzz',
  '##FF0000',
  'not-a-color',
];

test('C-02 intended hex lengths normalize to #RRGGBB', () => {
  for (const [raw, expected] of INTENDED) {
    assert.equal(normalizeHexColor(raw), expected, `${raw} → ${expected}`);
    assert.equal(isValidHexColor(raw), true, `${raw} must be valid`);
    assert.ok(hexToHsv(raw), `${raw} must produce HSV`);
  }
});

test('C-02 rejected lengths / named / rgba stay invalid', () => {
  for (const raw of REJECTED) {
    assert.equal(normalizeHexColor(raw), null, `${JSON.stringify(raw)} must be rejected`);
    assert.equal(isValidHexColor(raw), false, `${JSON.stringify(raw)} must be invalid`);
    assert.equal(hexToHsv(raw), null, `${JSON.stringify(raw)} must not produce HSV`);
    // Hex field never calls applyHex unless normalizeHexColor succeeds.
    // applyColorPickerSelection('transparent') is the preset-swatch path, not C-02.
    if (raw === 'transparent') {
      const swatch = applyColorPickerSelection({ input: raw, currentHex: '#111111' });
      assert.equal(swatch.kind, 'transparent');
      continue;
    }
    const applied = applyColorPickerSelection({ input: raw, currentHex: '#111111' });
    assert.equal(applied.kind, 'invalid', `${JSON.stringify(raw)} apply kind`);
    assert.equal(applied.hex, '#111111', `${JSON.stringify(raw)} must keep currentHex`);
  }
});

test('CompactColorPicker hex field applies only through normalizeHexColor', () => {
  const picker = read('src/components/CompactColorPicker.jsx');
  assert.match(picker, /aria-label="Hex color"/);
  assert.match(picker, /const normalized = normalizeHexColor\(val\)/);
  assert.match(picker, /if \(normalized\) applyHex\(normalized\)/);
  assert.match(picker, /commitRememberedOpacity/);
  assert.doesNotMatch(picker, /onChange\(localHex,/);
  assert.doesNotMatch(picker, /namedColou?rs|CSS\.supports\(|new Option\(/);
  assert.equal((picker.match(/aria-label="Hex color"/g) || []).length, 1);
});

test('live C-02 spec covers 3/4/5/6/7/8 + named + rgba + empty', () => {
  const spec = read('debug/scenarios/e2e-hex-lengths.spec.mjs');
  assert.match(spec, /3-digit bare/);
  assert.match(spec, /6-digit hash/);
  assert.match(spec, /4-digit bare/);
  assert.match(spec, /5-digit hash/);
  assert.match(spec, /7-digit bare/);
  assert.match(spec, /8-digit hash/);
  assert.match(spec, /rgba\(\)/);
  assert.match(spec, /named transparent/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /viewBox/);
});
