import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampOpacityPercent,
  applyColorPickerSelection,
} from '../src/utils/annotationStyleCatalog.js';
import { composeColorForPatch } from '../src/utils/annotationData.js';
import { composeAnnotationColor } from '../src/utils/annotationCreationCommit.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const CONTINUUM = [0, 1, 25, 33, 40, 55, 70, 80, 99, 100];

test('C-03 clampOpacityPercent is a 0–100 continuum with minOpacity floor', () => {
  for (const stop of CONTINUUM) {
    assert.equal(clampOpacityPercent(stop, 0), stop, `${stop} @ min 0`);
  }
  assert.equal(clampOpacityPercent(40.4, 0), 40);
  assert.equal(clampOpacityPercent(40.6, 0), 41);
  assert.equal(clampOpacityPercent(-10, 0), 0);
  assert.equal(clampOpacityPercent(999, 0), 100);
  assert.equal(clampOpacityPercent('', 0), 0);
  assert.equal(clampOpacityPercent('abc', 0), 0);
  assert.equal(clampOpacityPercent(40, 1), 100);
  assert.equal(clampOpacityPercent(0, 1), 100);
  assert.equal(clampOpacityPercent('abc', 1), 100);
  assert.equal(clampOpacityPercent(999, 1), 100);
});

test('composeColorForPatch / composeAnnotationColor stamp continuum alpha', () => {
  for (const stop of CONTINUUM) {
    const patched = composeColorForPatch('#FF0000', stop);
    const created = composeAnnotationColor('#FF0000', stop);
    const expected = `rgba(255, 0, 0, ${stop / 100})`;
    assert.equal(patched, expected, `patch ${stop}`);
    assert.equal(created, expected, `create ${stop}`);
  }
  assert.equal(composeColorForPatch('transparent', 55), 'transparent');
});

test('transparentMode remembers slider percent; Match Fill can sit below border floor', () => {
  const transparent = applyColorPickerSelection({
    input: 'transparent',
    currentHex: '#0000FF',
    rememberedOpacityPct: 40,
  });
  assert.equal(transparent.kind, 'transparent');
  assert.equal(transparent.opacity, 0);
  assert.equal(transparent.rememberedOpacityPct, 40);

  const restore = applyColorPickerSelection({
    input: '#0000FF',
    rememberedOpacityPct: 40,
    minOpacity: 0,
  });
  assert.equal(restore.kind, 'hex');
  assert.equal(restore.opacity, 0.4);

  const match = applyColorPickerSelection({
    input: '__match__',
    matchFillColor: '#FF0000',
    matchFillOpacity: 0.55,
    minOpacity: 1,
  });
  assert.equal(match.opacity, 0.55);
  assert.equal(clampOpacityPercent(match.opacity * 100, 1), 100);
});

test('desktop Border tab minOpacity is 0; one-visible stays the applyChange bump', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /minOpacity=\{0\}/);
  assert.match(shell, /shapeOneVisibleRule && alpha <= 0 && otherAlpha <= 0/);
  const picker = read('src/components/CompactColorPicker.jsx');
  assert.match(picker, /aria-label="Opacity percentage"/);
  assert.match(picker, /type="range"/);
  assert.match(picker, /clampOpacityPercent\(e\.target\.value, minOpacity\)/);
  assert.match(picker, /disabled=\{transparentMode\}/);
});

test('live C-03 spec covers fill + stroke continuum, clamp, restore, isolation', () => {
  const spec = read('debug/scenarios/e2e-opacity-continuum.spec.mjs');
  assert.match(spec, /FILL_STOPS = \[1, 25, 40, 55, 80, 99, 100\]/);
  assert.match(spec, /STROKE_STOPS = \[1, 25, 40, 55, 80, 99, 100\]/);
  assert.match(spec, /FILL_SLIDER = 70/);
  assert.match(spec, /STROKE_SLIDER = 33/);
  assert.match(spec, /border minOpacity=1/);
  assert.match(spec, /remembered 40 after transparent/);
  assert.match(spec, /390 fill \+ stroke opacity continuum/);
  assert.match(spec, /setOpacityPercent\(page, 25\)/);
  assert.match(spec, /setOpacityPercent\(page, 40\)/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /viewBox/);
});
