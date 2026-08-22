import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { COLOR_PICKER_PRESETS, colorPickerSolidPresets, applyColorPickerSelection } from '../src/utils/annotationStyleCatalog.js';
import { defaultCalloutStyle } from '../src/components/Callout/types.js';
import { calloutToAnnotationObject } from '../src/utils/calloutAnnotationBridge.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const PAGE = { width: 612, height: 792 };

function makeCallout(stylePatch = {}) {
  return {
    id: `callout-${stylePatch.fillColor || stylePatch.borderColor || 'default'}`,
    pageNumber: 1,
    arrowTip: { x: 0.40, y: 0.40 },
    knee: { x: 0.30, y: 0.30 },
    textBoxPosition: { x: 0.12, y: 0.16 },
    textBoxWidth: 0.22,
    textBoxHeight: 0.10,
    text: 'fill-proof',
    style: {
      ...defaultCalloutStyle,
      ...stylePatch,
    },
  };
}

test('Callout Fill/Border share the 16-swatch CompactColorPicker catalog including transparent', () => {
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
  assert.equal(defaultCalloutStyle.fillColor, 'transparent');
  assert.equal(defaultCalloutStyle.fontFamily, 'Arial');
  assert.equal(defaultCalloutStyle.fontFamily.includes(','), false);
});

test('desktop Callout Color is Fill + Border tabs (transparent on both; no Match Fill)', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /contextTool === 'text' \|\| bottomToolbarApi\.contextTool === 'callout'/);
  const isShape = shell.match(
    /const isShape = \(bottomToolbarApi\.contextTool === 'rect' \|\| bottomToolbarApi\.contextTool === 'ellipse' \|\| bottomToolbarApi\.contextTool === 'text' \|\| bottomToolbarApi\.contextTool === 'callout' \|\| bottomToolbarApi\.contextTool === 'counter'\)/,
  );
  assert.ok(isShape, 'Callout stays on the Fill/Border shape picker');
  assert.match(shell, /Callout opt out \(their borders \+ fills are optional\)/);
  const oneVisible = shell.match(
    /const shapeOneVisibleRule = bottomToolbarApi\.contextTool === 'rect'\s*\n\s*\|\| bottomToolbarApi\.contextTool === 'ellipse';/,
  );
  assert.ok(oneVisible, 'Callout must not inherit rect/ellipse Match Fill / minOpacity=1');
  assert.doesNotMatch(shell, /shapeOneVisibleRule =[\s\S]{0,80}callout/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /handlePatchSelectedCallout\(\{ fillColor: color \}\)/);
  assert.match(viewer, /handlePatchSelectedCallout\(\{ borderColor: color \}\)/);
  assert.match(viewer, /if \(selectedToolbarCallout\) \{\s*\n\s*selectionMappedTool = 'callout';/);
  assert.match(viewer, /borderColor: strokeColor,\s*\n\s*borderOpacity: \(strokeOpacity \?\? 100\) \/ 100,\s*\n\s*fillColor,/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /const FILL_TOOLS = new Set\(\['rect', 'ellipse', 'text', 'callout', 'counter'\]\)/);
});

test('calloutToAnnotationObject stores every catalog fill + border on legacyCallout.style', () => {
  for (const swatch of COLOR_PICKER_PRESETS) {
    const fillOpacity = swatch === 'transparent' ? 0 : 1;
    const projected = calloutToAnnotationObject(makeCallout({
      fillColor: swatch,
      fillOpacity,
      borderColor: swatch === 'transparent' ? '#0000FF' : swatch,
      borderOpacity: swatch === 'transparent' ? 0 : 1,
    }), PAGE);
    assert.equal(projected.data.type, 'callout');
    const style = projected.data.legacyCallout.style;
    assert.equal(style.fillColor, swatch);
    assert.equal(style.fillOpacity, fillOpacity);
    if (swatch === 'transparent') {
      assert.equal(style.borderColor, '#0000FF');
      assert.equal(style.borderOpacity, 0);
      const transparentApply = applyColorPickerSelection({
        input: 'transparent',
        currentHex: '#FF0000',
        rememberedOpacityPct: 100,
      });
      assert.equal(transparentApply.kind, 'transparent');
      assert.equal(transparentApply.opacity, 0);
      assert.equal(transparentApply.hex, '#FF0000');
    } else {
      assert.equal(style.borderColor, swatch);
      assert.equal(style.borderOpacity, 1);
    }
  }
});

test('live Callout every-swatch spec covers Fill + Border + break + edge', () => {
  const spec = read('debug/scenarios/e2e-callout-colors.spec.mjs');
  assert.match(spec, /desktop Callout CompactColorPicker Fill \+ Border every swatch/);
  assert.match(spec, /patchEverySwatch/);
  assert.match(spec, /createCallout/);
  assert.match(spec, /#80FF00/);
  assert.match(spec, /#FF8000/);
  assert.match(spec, /Pen-armed Color must not clobber/);
  assert.match(spec, /Select \/ empty page invents 0/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /Transparent/);
  assert.match(spec, /clickTab\(page, 'Fill'\)/);
  assert.match(spec, /clickTab\(page, 'Border'\)/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
});
