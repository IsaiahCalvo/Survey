// "No scale on this page" chip (Nightly flag 'measure-scale-chip', Drawboard
// PDF Pro trial audit 2026-11-10): a measure tool armed on a page with no scale
// says so, with Set scale, instead of quietly reading 1:1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles/marksHidden.css', import.meta.url), 'utf8');

test('the chip is a Nightly beta flag with a seed migration', () => {
  assert.equal(FEATURE_FLAGS['measure-scale-chip']?.stage, 'beta');
  const sql = readFileSync(new URL('../supabase/migrations/20261110120000_measure_scale_chip_flag.sql', import.meta.url), 'utf8');
  assert.match(sql, /'measure-scale-chip', 'off'/);
});

test('the chip only shows while measuring on a page with no valid scale', () => {
  assert.match(viewer, /const \[measureScaleChipOn\] = useState\(\(\) => isFeatureOn\('measure-scale-chip'\)\)/);
  const at = viewer.indexOf('className="measure-no-scale-chip"');
  assert.ok(at > 0);
  const gate = viewer.slice(viewer.lastIndexOf('{measureScaleChipOn', at), at);
  assert.match(gate, /measureMode/);
  assert.match(gate, /!measureScaleDialog/);
  assert.match(gate, /!isValidMeasureScale\(/);
  assert.match(viewer.slice(at, at + 400), /setMeasureScaleDialog\(\{ pageNumber: pageNum \}\)/);
});

test('the chip uses theme tokens and the small type size', () => {
  const rule = css.slice(css.indexOf('.measure-no-scale-chip {'));
  assert.match(rule, /font-size: var\(--font-size-sm/);
  assert.match(rule, /max-width: calc\(100vw - 32px\)/);
});
