// Nightly 'layer-focus' (Drawboard Projects Layers focus mode).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_LAYER_FOCUS_LEVEL,
  LAYER_FOCUS_LEVELS,
  getLayerFocus,
  layerFocusCss,
  setLayerFocus,
} from '../src/utils/layerFocus.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const layers = { layers: [{ id: 'default', name: 'Default layer', visible: true }, { id: 'L1', name: 'Walls', visible: true }, { id: 'L"2', name: 'Odd', visible: true }] };

test('off or a lone default layer fades nothing', () => {
  assert.equal(layerFocusCss({ on: false, level: 20 }, 'L1', layers), '');
  assert.equal(layerFocusCss({ on: true, level: 20 }, 'default', null), '');
});

test('a named layer active fades every other mark', () => {
  const css = layerFocusCss({ on: true, level: 20 }, 'L1', layers);
  assert.match(css, /\[data-annotation-index\]:not\(\[data-mark-layer="L1"\]\),/);
  assert.match(css, /\[data-measure-label-for\]:not\(\[data-mark-layer="L1"\]\) \{ opacity: 0\.2 !important; \}/);
});

test('#1651: a measurement label fades with its line', () => {
  const css = layerFocusCss({ on: true, level: 40 }, 'default', layers);
  assert.match(css, /\[data-svg-annotation-layer\] \[data-measure-label-for\]\[data-mark-layer="L1"\]/);
  const source = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(source, /data-measure-label-for=\{index\} data-mark-layer=\{layerId\}/);
});

test('default active fades only the named layers, quoting odd ids', () => {
  const css = layerFocusCss({ on: true, level: 40 }, 'default', layers);
  assert.match(css, /\[data-mark-layer="L1"\]/);
  assert.match(css, /\[data-mark-layer="L\\"2"\]/);
  assert.ok(!/data-mark-layer="default"/.test(css));
  assert.match(css, /opacity: 0\.4/);
  // A gone layer as active reads as the default layer.
  assert.equal(layerFocusCss({ on: true, level: 40 }, 'gone', layers), css);
});

test('the store takes only known levels and starts off at 20%', () => {
  assert.deepEqual(getLayerFocus(), { on: false, level: DEFAULT_LAYER_FOCUS_LEVEL });
  assert.ok(LAYER_FOCUS_LEVELS.includes(DEFAULT_LAYER_FOCUS_LEVEL));
  setLayerFocus({ on: true, level: 33 });
  assert.deepEqual(getLayerFocus(), { on: true, level: 20 });
  setLayerFocus({ level: 60 });
  assert.equal(getLayerFocus().level, 60);
  setLayerFocus({ on: false, level: 20 });
});

test('marks carry their layer; the flag is beta with a migration', () => {
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(layer, /data-mark-layer=\{obj\?\.layerId \|\| 'default'\}/);
  assert.equal(FEATURE_FLAGS['layer-focus'].stage, 'rollout');
  const migration = readFileSync(new URL('../supabase/migrations/20261116022000_layer_focus_flag.sql', import.meta.url), 'utf8');
  assert.match(migration, /'layer-focus', 'off'/);
});
