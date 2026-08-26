import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { applyColorPickerSelection, clampOpacityPercent } from '../src/utils/annotationStyleCatalog.js';

// Source contracts for C-06 leftover: Match Fill.
// Live proof: debug/scenarios/e2e-match-fill.spec.mjs
// Distinct from C-01 grid, C-02 hex, C-03 opacity, C-04 spectrum,
// P1-38 selected-ring ±1, leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Match Fill snapshots fill color + opacity and may sit below Border minOpacity=1', () => {
  const match = applyColorPickerSelection({
    input: '__match__',
    matchFillColor: '#00ffff',
    matchFillOpacity: 0.4,
    minOpacity: 1,
  });
  assert.equal(match.kind, 'match');
  assert.equal(match.hex, '#00FFFF');
  assert.equal(match.opacity, 0.4);
  assert.equal(match.transparentMode, false);
  assert.equal(clampOpacityPercent(match.opacity * 100, 1), 100);

  const missing = applyColorPickerSelection({
    input: '__match__',
    matchFillColor: '#FF8000',
    matchFillOpacity: 0,
    minOpacity: 1,
  });
  assert.equal(missing.kind, 'match');
  assert.equal(missing.hex, '#FF8000');
  assert.equal(missing.opacity, 0);
});

test('desktop + 390 Border firstPreset is Match Fill; Fill / Line / Text omit it', () => {
  const picker = read('src/components/CompactColorPicker.jsx');
  assert.match(picker, /kind: 'match'/);
  assert.match(picker, /title = isMatchSlot \? 'Match fill'/);
  assert.match(picker, /presetValue = isMatchSlot \? '__match__'/);
  assert.match(picker, /border opacity locks to the fill/);
  assert.match(picker, /Math\.abs\(localOpacity - matchOpacityPct\) <= 1/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /firstPreset=\{\(shapeOneVisibleRule && !onFillTab\)/);
  assert.match(shell, /kind: 'match', color: bottomToolbarApi\.fillColor/);
  assert.match(shell, /opacity: \(bottomToolbarApi\.fillOpacity \?\? 100\) \/ 100/);
  assert.match(shell, /minOpacity=\{0\}/);
  assert.match(shell, /shapeOneVisibleRule && alpha <= 0 && otherAlpha <= 0/);
  assert.match(shell, /const shapeOneVisibleRule = bottomToolbarApi\.contextTool === 'rect'/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /firstPreset: \{ kind: 'match', color: toHexColor\(api\.fillColor/);
  assert.match(mobile, /tool === 'rect' \|\| tool === 'ellipse'/);
  assert.match(mobile, /minOpacity: 0/);

  const text = read('tests/textColors.test.mjs');
  assert.match(text, /no Match Fill/);
  const line = read('tests/lineArrowColors.test.mjs');
  assert.match(line, /no Fill\/Border tabs/);
});

test('live C-06 spec covers opacity lock, missing fill, 390, hub, file.id', () => {
  const spec = read('debug/scenarios/e2e-match-fill.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Match Fill intended \+ break \+ edge/);
  assert.match(spec, /390 Match Fill intended \+ break \+ edge/);
  assert.match(spec, /title="Match fill"/);
  assert.match(spec, /opacity lock: stroke must sit at fill 40 below Border minOpacity=1/);
  assert.match(spec, /Match Fill is a snapshot, not a live bind/);
  assert.match(spec, /missing fill Match Fill must not hide both sides/);
  assert.match(spec, /Fill tab Match fill must be 0/);
  assert.match(spec, /Line Match fill must be 0/);
  assert.match(spec, /second rect must isolate the first stroke/);
  assert.match(spec, /390 selected Match Fill must stamp fill color on stroke/);
  assert.match(spec, /390 opacity lock must stamp fill 40 onto stroke/);
  assert.match(spec, /390 Fill takeover Match fill must be 0/);
  assert.match(spec, /Re-open, then Stroke tab/);
  assert.match(spec, /getByRole\('tab', \{ name: 'Stroke color'/);
  assert.match(spec, /ensurePageDrawTarget/);
  assert.match(spec, /dismissMobileSheet/);
  assert.match(spec, /hubPreview Match fill must be 0/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
