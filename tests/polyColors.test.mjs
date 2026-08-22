import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { COLOR_PICKER_PRESETS, colorPickerSolidPresets, applyColorPickerSelection } from '../src/utils/annotationStyleCatalog.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Poly Fill/Border/stroke share the 16-swatch CompactColorPicker catalog including transparent', () => {
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
  const transparentApply = applyColorPickerSelection({
    input: 'transparent',
    currentHex: '#FF0000',
    rememberedOpacityPct: 100,
  });
  assert.equal(transparentApply.kind, 'transparent');
  assert.equal(transparentApply.opacity, 0);
  assert.equal(transparentApply.hex, '#FF0000');
});

test('desktop selected polygon maps to rect Fill/Border; polyline maps to line stroke-only', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /else if \(selectedType === 'polygon'\) selectionMappedTool = 'rect'/);
  assert.match(viewer, /else if \(selectedType === 'polyline'\) selectionMappedTool = 'line'/);
  assert.match(viewer, /\|\| type === 'polygon' \|\| isCounter/);
  assert.match(viewer, /type === 'polygon' \|\| type === 'polyline'/);
  assert.match(viewer, /handlePatchSelectedAnnotation\(\{ fill: rgba \}\)/);
  assert.match(viewer, /handlePatchSelectedAnnotation\(\{ stroke: rgba \}\)/);

  const shell = read('src/AppShell.jsx');
  const isShape = shell.match(
    /const isShape = \(bottomToolbarApi\.contextTool === 'rect' \|\| bottomToolbarApi\.contextTool === 'ellipse' \|\| bottomToolbarApi\.contextTool === 'text' \|\| bottomToolbarApi\.contextTool === 'callout' \|\| bottomToolbarApi\.contextTool === 'counter'\)/,
  );
  assert.ok(isShape, 'selected polygon inherits the rect Fill/Border shape picker');
  const oneVisible = shell.match(
    /const shapeOneVisibleRule = bottomToolbarApi\.contextTool === 'rect'\s*\n\s*\|\| bottomToolbarApi\.contextTool === 'ellipse';/,
  );
  assert.ok(oneVisible, 'selected polygon Border inherits Match Fill / minOpacity=1');
  assert.match(shell, /Stroke-only swatch \(pen, highlighter, arrow,\s*\n\s*line\)/);
  assert.doesNotMatch(shell, /contextTool === 'line'[\s\S]{0,80}handleFillColorChange/);

  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(importer, /type: 'polygon'/);
  assert.match(importer, /pdfAnnotationType: 'Polygon'/);
  assert.match(importer, /type: 'polyline'/);
  assert.match(importer, /pdfAnnotationType: 'PolyLine'/);
  assert.match(importer, /fill: fillColor/);
  assert.match(importer, /fill: 'transparent'/);

  const renderer = read('src/utils/svgAnnotationRenderers.jsx');
  assert.match(renderer, /data-shape-kind="polygon"/);
  assert.match(renderer, /data-shape-kind="polyline"/);
  assert.match(renderer, /fill=\{obj\.fill \|\| 'transparent'\}/);
  assert.match(renderer, /stroke=\{obj\.stroke \|\| 'transparent'\}/);
  assert.match(renderer, /stroke=\{obj\.stroke \|\| '#000'\}/);
});

test('no create-poly tool; fixture import is the only poly Color target', () => {
  const fixture = read('scripts/e2e-poly-vertices-fixture.mjs');
  assert.match(fixture, /Subtype: PDFName\.of\('Polygon'\)/);
  assert.match(fixture, /Subtype: PDFName\.of\('PolyLine'\)/);
  assert.match(fixture, /e2e-poly-vertices\.pdf/);

  const shell = read('src/AppShell.jsx');
  assert.doesNotMatch(shell, /value: 'polygon'|label: 'Polygon'/);
  assert.doesNotMatch(shell, /value: 'polyline'|label: 'Polyline'/);

  const spec = read('debug/scenarios/e2e-poly-colors.spec.mjs');
  assert.match(spec, /No create-poly tool/);
  assert.match(spec, /testPdf=e2e-poly-vertices\.pdf/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
});

test('live Poly every-swatch spec covers Fill + Border + polyline stroke + break + edge', () => {
  const spec = read('debug/scenarios/e2e-poly-colors.spec.mjs');
  assert.match(spec, /desktop Poly CompactColorPicker Fill \+ Border \+ polyline stroke every swatch/);
  assert.match(spec, /patchPolygonFillEverySwatch/);
  assert.match(spec, /patchPolygonBorderEverySwatch/);
  assert.match(spec, /patchPolylineStrokeEverySwatch/);
  assert.match(spec, /Match fill/);
  assert.match(spec, /#FF0000/);
  assert.match(spec, /#0000FF/);
  assert.match(spec, /#00FFFF/);
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
