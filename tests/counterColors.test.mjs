import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { COLOR_PICKER_PRESETS, colorPickerSolidPresets } from '../src/utils/annotationStyleCatalog.js';
import { composeColorForPatch } from '../src/utils/annotationData.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Counter Fill/Number share the 16-swatch CompactColorPicker catalog including transparent', () => {
  assert.equal(COLOR_PICKER_PRESETS.length, 16);
  assert.equal(COLOR_PICKER_PRESETS[0], 'transparent');
  assert.deepEqual(
    [...COLOR_PICKER_PRESETS],
    [
      'transparent',
      '#FF0000', '#FF0080', '#FF00FF', '#8000FF', '#0000FF', '#0080FF', '#00FFFF',
      '#00FF80', '#00FF00', '#80FF00', '#FFFF00', '#FF8000', '#FFFFFF', '#808080', '#000000',
    ],
  );
  assert.equal(colorPickerSolidPresets().length, 15);
});

test('desktop Counter Color is Fill + Number tabs (transparent on both; no Match Fill)', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /aria-label="Counter colors"/);
  assert.match(shell, /const isCounter = bottomToolbarApi\.contextTool === 'counter'/);
  assert.match(shell, /const secondTabLabel = isCounter \? 'Number' : 'Border'/);
  const isShape = shell.match(
    /const isShape = \(bottomToolbarApi\.contextTool === 'rect' \|\| bottomToolbarApi\.contextTool === 'ellipse' \|\| bottomToolbarApi\.contextTool === 'text' \|\| bottomToolbarApi\.contextTool === 'callout' \|\| bottomToolbarApi\.contextTool === 'counter'\)/,
  );
  assert.ok(isShape, 'Counter stays on the Fill/Number shape picker');
  const oneVisible = shell.match(
    /const shapeOneVisibleRule = bottomToolbarApi\.contextTool === 'rect'\s*\n\s*\|\| bottomToolbarApi\.contextTool === 'ellipse';/,
  );
  assert.ok(oneVisible, 'Counter must not inherit rect/ellipse Match Fill / minOpacity=1');
  assert.doesNotMatch(shell, /shapeOneVisibleRule =[\s\S]{0,80}counter/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /handleCounterGroupUpdateRef\.current\?\.\(annotation\.data\.seriesId, \{ fill: rgba \}\)/);
  assert.match(viewer, /handleCounterGroupUpdateRef\.current\?\.\(annotation\.data\.seriesId, \{ numberColor: rgba \}\)/);
  assert.match(viewer, /\/\/   - fill         → writes obj\.fill \(bubble color\)/);
  assert.match(viewer, /\/\/   - numberColor  → writes obj\.data\.numberColor \(text fill in renderCounter\)/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /const FILL_TOOLS = new Set\(\['rect', 'ellipse', 'text', 'callout', 'counter'\]\)/);
  assert.match(mobile, /aria-label=\{showFill \? \(tool === 'counter' \? 'Counter colors' : 'Fill and border colors'\) : 'Stroke color'\}/);
});

test('composeColorForPatch stores every catalog fill + numberColor including transparent', () => {
  for (const swatch of COLOR_PICKER_PRESETS) {
    const composed = composeColorForPatch(swatch, swatch === 'transparent' ? 0 : 100);
    if (swatch === 'transparent') {
      assert.equal(composed, 'transparent');
    } else {
      assert.match(composed, /^rgba\(/);
      assert.match(composed, /, 1\)$/);
    }
  }
  assert.equal(composeColorForPatch('#FF0000', 0), 'rgba(255, 0, 0, 0)');
});

test('live Counter every-swatch spec covers Fill + Number + series isolation + break + edge', () => {
  const spec = read('debug/scenarios/e2e-counter-colors.spec.mjs');
  assert.match(spec, /desktop Counter CompactColorPicker Fill \+ Number every swatch/);
  assert.match(spec, /390 Counter Fill \+ Stroke CompactColorPicker every swatch/);
  assert.match(spec, /patchEverySwatch/);
  assert.match(spec, /clickNewCount/);
  assert.match(spec, /#80FF00/);
  assert.match(spec, /#FF8000/);
  assert.match(spec, /Pen-armed Color must not clobber/);
  assert.match(spec, /series A fill stays red/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /Transparent/);
  assert.match(spec, /clickTab\(page, 'Fill'\)/);
  assert.match(spec, /clickTab\(page, 'Number'\)/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
});
