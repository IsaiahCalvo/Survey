import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { COLOR_PICKER_PRESETS, colorPickerSolidPresets, applyColorPickerSelection } from '../src/utils/annotationStyleCatalog.js';
import {
  buildBoundaryShapeCommitJSON,
  composeAnnotationColor,
} from '../src/utils/annotationCreationCommit.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Cloud Fill/Border share the 16-swatch CompactColorPicker catalog including transparent', () => {
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

test('desktop Cloud Color is Fill + Border tabs (Match Fill on Border; Cloud is rect-only)', () => {
  const shell = read('src/AppShell.jsx');
  const isShape = shell.match(
    /const isShape = \(bottomToolbarApi\.contextTool === 'rect' \|\| bottomToolbarApi\.contextTool === 'ellipse' \|\| bottomToolbarApi\.contextTool === 'text' \|\| bottomToolbarApi\.contextTool === 'callout' \|\| bottomToolbarApi\.contextTool === 'counter'\)/,
  );
  assert.ok(isShape, 'Cloud stays on the rect Fill/Border shape picker');
  const oneVisible = shell.match(
    /const shapeOneVisibleRule = bottomToolbarApi\.contextTool === 'rect'\s*\n\s*\|\| bottomToolbarApi\.contextTool === 'ellipse';/,
  );
  assert.ok(oneVisible, 'Cloud rect inherits Match Fill / minOpacity=1 on Border');
  assert.match(shell, /contextTool === 'rect' \? \[\{ value: 'cloud', label: 'Cloud' \}\]/);
  assert.match(shell, /contextTool === 'rect' && bottomToolbarApi\.lineBorderStyle === 'cloud'/);
  assert.match(shell, /Cloud bump size/);
  assert.doesNotMatch(shell, /contextTool === 'ellipse'[\s\S]{0,80}value: 'cloud'/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /if \(next === 'cloud'\) \{\s*\n\s*handlePatchSelectedAnnotation\(\{\s*\n\s*strokeDashArray: null,\s*\n\s*data: \{ pdfCloudIntensity:/);
  assert.match(viewer, /handlePatchSelectedAnnotation\(\{ fill: rgba \}\)/);
  assert.match(viewer, /handlePatchSelectedAnnotation\(\{ stroke: rgba \}\)/);

  const renderer = read('src/utils/svgAnnotationRenderers.jsx');
  assert.match(renderer, /data-shape-kind="cloud-rect"/);
  assert.match(renderer, /fill=\{obj\.fill \|\| 'transparent'\}/);
  assert.match(renderer, /stroke=\{obj\.stroke \|\| 'transparent'\}/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /tool === 'rect' \? \[\{ value: 'cloud', label: 'Cloud' \}\]/);
  assert.match(mobile, /const FILL_TOOLS = new Set\(\['rect', 'ellipse', 'text', 'callout', 'counter'\]\)/);
});

test('buildBoundaryShapeCommitJSON stores every catalog fill + stroke on a Cloud rect', () => {
  const start = { x: 20, y: 30 };
  const end = { x: 160, y: 140 };
  for (const swatch of COLOR_PICKER_PRESETS) {
    const json = buildBoundaryShapeCommitJSON({
      tool: 'rect',
      id: `cloud-${swatch}`,
      start,
      end,
      strokeColor: swatch === 'transparent' ? '#0000FF' : swatch,
      strokeOpacity: 100,
      fillColor: swatch,
      fillOpacity: swatch === 'transparent' ? 0 : 100,
      strokeWidth: 2,
      lineBorderStyle: 'cloud',
      cloudIntensity: 4,
    });
    assert.ok(json, `cloud commit for ${swatch}`);
    assert.equal(json.type, 'Rect');
    assert.equal(json.data.pdfCloudIntensity, 4);
    assert.equal(json.strokeDashArray, null);
    assert.equal(json.fill, composeAnnotationColor(swatch, swatch === 'transparent' ? 0 : 100));
    if (swatch === 'transparent') {
      assert.equal(json.fill, 'transparent');
      assert.equal(json.stroke, composeAnnotationColor('#0000FF', 100));
      const transparentApply = applyColorPickerSelection({
        input: 'transparent',
        currentHex: '#FF0000',
        rememberedOpacityPct: 100,
      });
      assert.equal(transparentApply.kind, 'transparent');
      assert.equal(transparentApply.opacity, 0);
      assert.equal(transparentApply.hex, '#FF0000');
    } else {
      assert.match(json.fill, /^rgba\(/);
      assert.equal(json.stroke, composeAnnotationColor(swatch, 100));
    }
  }

  const ellipse = buildBoundaryShapeCommitJSON({
    tool: 'ellipse',
    id: 'ellipse-not-cloud',
    start,
    end,
    strokeColor: '#FF0000',
    strokeOpacity: 100,
    fillColor: '#00FF00',
    fillOpacity: 100,
    strokeWidth: 2,
    lineBorderStyle: 'cloud',
    cloudIntensity: 8,
  });
  assert.equal(ellipse.type, 'Ellipse');
  assert.equal(ellipse.data?.pdfCloudIntensity, undefined, 'ellipse must not stamp Cloud intensity');
});

test('live Cloud every-swatch spec covers Fill + Border + Match Fill + break + edge', () => {
  const spec = read('debug/scenarios/e2e-cloud-colors.spec.mjs');
  assert.match(spec, /desktop Cloud CompactColorPicker Fill \+ Border every swatch/);
  assert.match(spec, /patchFillEverySwatch/);
  assert.match(spec, /patchBorderEverySwatch/);
  assert.match(spec, /createCloud/);
  assert.match(spec, /cloud-rect/);
  assert.match(spec, /Match fill/);
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
