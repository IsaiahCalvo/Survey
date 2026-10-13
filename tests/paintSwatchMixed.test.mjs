// 2026-10-04 (owner, Test 43): picked marks in different colours show the
// combined paint swatch as the rainbow ring with a plus, on desktop and phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPaintSelectionMixed } from '../src/utils/selectionRestyle.js';

test('mixed paint: any colour or opacity disagreement, nothing else', () => {
  assert.equal(isPaintSelectionMixed(null), false);
  assert.equal(isPaintSelectionMixed({}), false);
  assert.equal(isPaintSelectionMixed({ strokeColor: true }), true);
  assert.equal(isPaintSelectionMixed({ fillColor: true }), true);
  assert.equal(isPaintSelectionMixed({ strokeOpacity: true }), true);
  assert.equal(isPaintSelectionMixed({ fillOpacity: true }), true);
  // Width or line style differences are shown by their own pills.
  assert.equal(isPaintSelectionMixed({ width: true, lineStyle: true }), false);
});

test('both bars hand the mixed flag to the one shared swatch', () => {
  const desk = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  const phone = readFileSync(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');
  const swatch = readFileSync(new URL('../src/components/QuickStyleControls.jsx', import.meta.url), 'utf8');
  assert.match(desk, /mixed=\{isPaintSelectionMixed\(bottomToolbarApi\.selectionMixed\)\}/);
  assert.match(phone, /mixed=\{isPaintSelectionMixed\(api\.selectionMixed\)\}/);
  assert.match(swatch, /mixed \? \([\s\S]{0,400}quick-style__rainbow[\s\S]{0,200}<CustomPlus \/>/);
});
