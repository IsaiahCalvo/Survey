import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for Poly / Cloud Style dash on imported polygon + polyline.
// Live proof: debug/scenarios/e2e-poly-cloud-dash.spec.mjs
// Distinct from Rect/Ellipse/Text and Line/Arrow/Callout every-style,
// Cloud bump 1–20, and Poly every-swatch. No create-poly tool.

const DASH_STYLES = [
  { value: 'solid', dash: null },
  { value: 'dashed', dash: [6, 4] },
  { value: 'dotted', dash: [2, 4] },
];

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('selected polygon maps to rect Style including Cloud; polyline maps to line and omits Cloud', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /else if \(selectedType === 'polygon'\) selectionMappedTool = 'rect'/);
  assert.match(viewer, /else if \(selectedType === 'polyline'\) selectionMappedTool = 'line'/);
  assert.match(viewer, /type === 'polygon' \|\| type === 'polyline'/);
  assert.match(viewer, /else if \(next === 'dashed'\) \{\s*\n\s*handlePatchSelectedAnnotation\(\{ strokeDashArray: \[6, 4\]/);
  assert.match(viewer, /else if \(next === 'dotted'\) \{\s*\n\s*handlePatchSelectedAnnotation\(\{ strokeDashArray: \[2, 4\]/);
  assert.match(viewer, /if \(next === 'cloud'\) \{\s*\n\s*handlePatchSelectedAnnotation\(\{\s*\n\s*strokeDashArray: null,/);
  assert.match(viewer, /data: \{ pdfCloudIntensity: Math\.max\(1, Number\(cloudIntensity\) \|\| 2\) \}/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /\{ value: 'solid', label: 'Solid' \}/);
  assert.match(shell, /\{ value: 'dashed', label: 'Dashed' \}/);
  assert.match(shell, /\{ value: 'dotted', label: 'Dotted' \}/);
  assert.match(
    shell,
    /\.\.\.\(bottomToolbarApi\.contextTool === 'rect' \? \[\{ value: 'cloud', label: 'Cloud' \}\] : \[\]\)/,
  );
  assert.match(
    shell,
    /contextTool === 'arrow' \|\| bottomToolbarApi\.contextTool === 'line' \|\| bottomToolbarApi\.contextTool === 'rect' \|\| bottomToolbarApi\.contextTool === 'ellipse' \|\| bottomToolbarApi\.contextTool === 'text' \|\| bottomToolbarApi\.contextTool === 'callout'/,
  );

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /const BORDER_STYLE_TOOLS = new Set\(\['rect', 'ellipse', 'line', 'arrow', 'text', 'callout'\]\)/);
  assert.match(mobile, /\.\.\.\(tool === 'rect' \? \[\{ value: 'cloud', label: 'Cloud' \}\] : \[\]\)/);
});

test('SVG polygon/polyline honor dash; Cloud intensity rebuilds cloud-polygon', () => {
  const renderers = read('src/utils/svgAnnotationRenderers.jsx');
  assert.match(renderers, /data-shape-kind="polygon"/);
  assert.match(renderers, /data-shape-kind="polyline"/);
  assert.match(renderers, /data-shape-kind="cloud-polygon"/);
  assert.match(renderers, /const polyDashArrayAttr = Array\.isArray\(obj\.strokeDashArray\)/);
  assert.match(renderers, /const plDashArrayAttr = Array\.isArray\(obj\.strokeDashArray\)/);
  assert.match(renderers, /strokeDasharray=\{polyDashArrayAttr\}/);
  assert.match(renderers, /strokeDasharray=\{plDashArrayAttr\}/);
  assert.match(renderers, /const cloudIntensity = obj\.data\?\.pdfCloudIntensity/);
  assert.match(renderers, /buildCloudPathCommands\(livePoints, cloudIntensity/);

  const fixture = read('scripts/e2e-poly-vertices-fixture.mjs');
  assert.match(fixture, /Subtype: PDFName\.of\('Polygon'\)/);
  assert.match(fixture, /Subtype: PDFName\.of\('PolyLine'\)/);
  assert.match(fixture, /e2e-poly-vertices\.pdf/);

  const shell = read('src/AppShell.jsx');
  assert.doesNotMatch(shell, /value: 'polygon'|label: 'Polygon'/);
  assert.doesNotMatch(shell, /value: 'polyline'|label: 'Polyline'/);

  for (const style of DASH_STYLES) {
    assert.ok(style.value);
  }
});

test('live Poly / Cloud Style spec covers every style + break + edge', () => {
  const spec = read('debug/scenarios/e2e-poly-cloud-dash.spec.mjs');
  assert.match(spec, /POLY_STYLES/);
  assert.match(spec, /DASH_STYLES/);
  assert.match(spec, /testPdf=e2e-poly-vertices\.pdf/);
  assert.match(spec, /selected-patch/);
  assert.match(spec, /cloud-polygon/);
  assert.match(spec, /Cloud→Dashed/);
  assert.match(spec, /no create-poly tool/);
  assert.match(spec, /Pen-armed Style must hide/);
  assert.match(spec, /Select \/ empty page invents 0/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /390/);
  assert.match(spec, /Border style/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  for (const value of ['solid', 'dashed', 'dotted', 'cloud']) {
    assert.match(spec, new RegExp(value));
  }
});
