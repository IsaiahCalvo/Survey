import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { COLOR_PICKER_PRESETS, colorPickerSolidPresets, applyColorPickerSelection } from '../src/utils/annotationStyleCatalog.js';
import { composeColorForPatch } from '../src/utils/annotationData.js';
import { buildNewTextCommitJSON, FABRIC_TEXTBOX_ENVELOPE } from '../src/utils/textEditCommit.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Text Fill/Border share the 16-swatch CompactColorPicker catalog including transparent', () => {
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
  assert.equal(FABRIC_TEXTBOX_ENVELOPE.backgroundColor, '');
  assert.equal(FABRIC_TEXTBOX_ENVELOPE.fontFamily == null, true);
});

test('desktop Text Color is Fill + Border tabs (transparent on both; no Match Fill)', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /contextTool === 'text' \|\| bottomToolbarApi\.contextTool === 'callout'/);
  const isShape = shell.match(
    /const isShape = \(bottomToolbarApi\.contextTool === 'rect' \|\| bottomToolbarApi\.contextTool === 'ellipse' \|\| bottomToolbarApi\.contextTool === 'text' \|\| bottomToolbarApi\.contextTool === 'callout' \|\| bottomToolbarApi\.contextTool === 'counter'\)/,
  );
  assert.ok(isShape, 'Text stays on the Fill/Border shape picker');
  assert.match(shell, /Callout opt out \(their borders \+ fills are optional\)/);
  const oneVisible = shell.match(
    /const shapeOneVisibleRule = bottomToolbarApi\.contextTool === 'rect'\s*\n\s*\|\| bottomToolbarApi\.contextTool === 'ellipse';/,
  );
  assert.ok(oneVisible, 'Text must not inherit rect/ellipse Match Fill / minOpacity=1');
  assert.doesNotMatch(shell, /shapeOneVisibleRule = bottomToolbarApi\.contextTool === 'text'/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /if \(type === 'textbox'\) \{\s*\n\s*handlePatchSelectedAnnotation\(\{ backgroundColor: rgba \}\)/);
  assert.match(viewer, /handlePatchSelectedAnnotation\(\{ stroke: rgba \}\)/);
  assert.match(viewer, /selectionMappedTool = 'text'/);
  assert.match(viewer, /const fillSource = type === 'textbox' \? annot\.backgroundColor : annot\.fill/);

  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(overlay, /fill: newTextStyle\?\.fontColor \|\| strokeColor \|\| '#007AFF'/);
  assert.match(overlay, /stroke: \(typeof strokeColor === 'string' && strokeColor\) \? strokeColor : '#000000'/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /const FILL_TOOLS = new Set\(\['rect', 'ellipse', 'text', 'callout', 'counter'\]\)/);
});

test('composeColorForPatch + new-text envelope store every catalog fill on backgroundColor, not fill', () => {
  for (const swatch of COLOR_PICKER_PRESETS) {
    const composed = composeColorForPatch(swatch, swatch === 'transparent' ? 0 : 100);
    if (swatch === 'transparent') {
      assert.equal(composed, 'transparent');
      const transparentApply = applyColorPickerSelection({
        input: 'transparent',
        currentHex: '#FF0000',
        rememberedOpacityPct: 100,
      });
      assert.equal(transparentApply.kind, 'transparent');
      assert.equal(transparentApply.opacity, 0);
      assert.equal(transparentApply.hex, '#FF0000');
    } else {
      assert.match(composed, /^rgba\(/);
    }
    const json = buildNewTextCommitJSON({
      text: 'fill-proof',
      left: 10,
      top: 20,
      innerWrapWidth: 148,
      naturalInnerHeight: 21,
      fill: '#007AFF',
      stroke: swatch === 'transparent' ? 'transparent' : composed,
    });
    assert.equal(json.type, 'Textbox');
    assert.equal(json.fill, '#007AFF', 'fontColor stays on fill');
    assert.equal(json.backgroundColor, '', 'create envelope fill is empty until Color Fill patches backgroundColor');
    assert.equal(json.fontFamily, 'Helvetica');
    assert.equal(json.fontFamily.includes(','), false);
    if (swatch === 'transparent') {
      assert.equal(json.stroke, 'transparent');
    } else {
      assert.equal(json.stroke, composed);
    }
  }
});

test('live Text every-swatch spec covers Fill + Border + break + edge', () => {
  const spec = read('debug/scenarios/e2e-text-colors.spec.mjs');
  assert.match(spec, /desktop Text CompactColorPicker Fill \+ Border every swatch/);
  assert.match(spec, /patchEverySwatch/);
  assert.match(spec, /createText/);
  assert.match(spec, /backgroundColor/);
  assert.match(spec, /fontColor/);
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
  assert.match(spec, /Fill \$\{swatch\} must not write fontColor/);
});
