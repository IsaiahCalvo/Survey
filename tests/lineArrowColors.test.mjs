import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { COLOR_PICKER_PRESETS, colorPickerSolidPresets } from '../src/utils/annotationStyleCatalog.js';
import {
  buildLineCommitJSON,
  composeAnnotationColor,
} from '../src/utils/annotationCreationCommit.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Line/Arrow share the 16-swatch CompactColorPicker catalog including transparent', () => {
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

test('desktop Line/Arrow Color is stroke-only (no Fill/Border tabs)', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /contextTool === 'arrow' \|\| bottomToolbarApi\.contextTool === 'line'/);
  assert.match(shell, /Stroke-only swatch \(pen, highlighter, arrow,\s*\n\s*line\)/);
  const isShape = shell.match(
    /const isShape = \(bottomToolbarApi\.contextTool === 'rect' \|\| bottomToolbarApi\.contextTool === 'ellipse' \|\| bottomToolbarApi\.contextTool === 'text' \|\| bottomToolbarApi\.contextTool === 'callout' \|\| bottomToolbarApi\.contextTool === 'counter'\)/,
  );
  assert.ok(isShape, 'Fill/Border tabs stay on filled shapes, not line/arrow');
  assert.doesNotMatch(shell, /contextTool === 'line'[\s\S]{0,80}handleFillColorChange/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /const FILL_TOOLS = new Set\(\['rect', 'ellipse', 'text', 'callout', 'counter'\]\)/);
  assert.match(mobile, /const BORDER_STYLE_TOOLS = new Set\(\['rect', 'ellipse', 'line', 'arrow', 'text', 'callout'\]\)/);
  assert.doesNotMatch(mobile, /FILL_TOOLS = new Set\([^)]*'line'/);
});

test('buildLineCommitJSON stores every solid swatch and transparent on line + arrow', () => {
  const start = { x: 10, y: 20 };
  const end = { x: 80, y: 40 };
  for (const swatch of COLOR_PICKER_PRESETS) {
    const line = buildLineCommitJSON({
      tool: 'line',
      id: `line-${swatch}`,
      start,
      end,
      strokeColor: swatch,
      strokeOpacity: swatch === 'transparent' ? 0 : 100,
      strokeWidth: 2,
    });
    const arrow = buildLineCommitJSON({
      tool: 'arrow',
      id: `arrow-${swatch}`,
      start,
      end,
      strokeColor: swatch,
      strokeOpacity: swatch === 'transparent' ? 0 : 100,
      strokeWidth: 2,
      arrowheadStyle: 'solidTriangle',
    });
    assert.equal(line.tool, 'line');
    assert.equal(arrow.tool, 'arrow');
    assert.equal(line.type, 'Line');
    assert.equal(arrow.type, 'Line');
    assert.equal(line.stroke, composeAnnotationColor(swatch, swatch === 'transparent' ? 0 : 100));
    assert.equal(arrow.stroke, composeAnnotationColor(swatch, swatch === 'transparent' ? 0 : 100));
    if (swatch === 'transparent') {
      assert.equal(line.stroke, 'transparent');
      assert.equal(arrow.stroke, 'transparent');
    } else {
      assert.match(line.stroke, /^rgba\(/);
      assert.equal(line.stroke, arrow.stroke);
    }
    assert.equal(line.data.arrowheadStyle, undefined, 'plain line must not inherit arrowhead');
    assert.equal(arrow.data.arrowheadStyle, 'solidTriangle');
  }
});

test('live Line/Arrow every-swatch spec covers both tools + break + edge', () => {
  const spec = read('debug/scenarios/e2e-line-arrow-colors.spec.mjs');
  assert.match(spec, /desktop Line\/Arrow CompactColorPicker every swatch/);
  assert.match(spec, /patchEverySwatch/);
  assert.match(spec, /createLine/);
  assert.match(spec, /createArrow/);
  assert.match(spec, /#80FF00/);
  assert.match(spec, /#FF8000/);
  assert.match(spec, /Pen-armed Color must not clobber/);
  assert.match(spec, /Select \/ empty page invents 0/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /Transparent/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
});
