import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBoundaryShapeCommitJSON } from '../src/utils/annotationCreationCommit.js';
import { buildNewTextCommitJSON } from '../src/utils/textEditCommit.js';

// Source contracts for Rect / Ellipse / Text Style catalogs.
// Live proof: debug/scenarios/e2e-rect-ellipse-text-dash.spec.mjs
// Distinct from UL-33 catalog smoke and Line/Arrow/Callout every-style.

const DASH_STYLES = [
  { value: 'solid', dash: null },
  { value: 'dashed', dash: [6, 4] },
  { value: 'dotted', dash: [2, 4] },
];

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const start = { x: 10, y: 20 };
const end = { x: 80, y: 70 };

test('Rect Style catalog is Solid/Dashed/Dotted/Cloud; Ellipse and Text omit Cloud', () => {
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

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /else if \(next === 'dashed'\) \{\s*\n\s*handlePatchSelectedAnnotation\(\{ strokeDashArray: \[6, 4\]/);
  assert.match(viewer, /else if \(next === 'dotted'\) \{\s*\n\s*handlePatchSelectedAnnotation\(\{ strokeDashArray: \[2, 4\]/);
  assert.match(viewer, /if \(next === 'cloud'\) \{\s*\n\s*handlePatchSelectedAnnotation\(\{\s*\n\s*strokeDashArray: null,/);
  assert.match(viewer, /type === 'textbox'/);
});

test('buildBoundaryShapeCommitJSON stamps every Rect/Ellipse dash; Cloud is rect-only; Text create stays solid', () => {
  const commit = read('src/utils/annotationCreationCommit.js');
  assert.match(commit, /if \(lineBorderStyle === 'cloud' && tool === 'rect'\)/);
  assert.match(commit, /json\.strokeDashArray = \[6, 4\]/);
  assert.match(commit, /json\.strokeDashArray = \[2, 4\]/);

  const renderers = read('src/utils/svgAnnotationRenderers.jsx');
  assert.match(renderers, /export const renderEllipse/);
  assert.match(renderers, /strokeDasharray=\{dashArrayAttr\}/);
  assert.match(renderers, /data-shape-kind="ellipse"/);
  assert.match(renderers, /obj\.strokeDashArray\.join\(' '\)/);

  for (const style of DASH_STYLES) {
    const rect = buildBoundaryShapeCommitJSON({
      tool: 'rect',
      id: `rect-${style.value}`,
      start,
      end,
      strokeColor: '#FF0000',
      strokeOpacity: 100,
      fillColor: '#00FF00',
      fillOpacity: 40,
      strokeWidth: 2,
      lineBorderStyle: style.value,
    });
    const ellipse = buildBoundaryShapeCommitJSON({
      tool: 'ellipse',
      id: `ellipse-${style.value}`,
      start,
      end,
      strokeColor: '#0000FF',
      strokeOpacity: 100,
      fillColor: '#FFFF00',
      fillOpacity: 40,
      strokeWidth: 2,
      lineBorderStyle: style.value,
    });
    assert.equal(rect.type, 'Rect');
    assert.equal(ellipse.type, 'Ellipse');
    assert.deepEqual(rect.strokeDashArray, style.dash, `rect ${style.value}`);
    assert.deepEqual(ellipse.strokeDashArray, style.dash, `ellipse ${style.value}`);
    assert.equal(rect.data?.pdfCloudIntensity, undefined);
    assert.equal(ellipse.data?.pdfCloudIntensity, undefined);
  }

  const cloudRect = buildBoundaryShapeCommitJSON({
    tool: 'rect',
    id: 'rect-cloud',
    start,
    end,
    strokeColor: '#FF0000',
    strokeOpacity: 100,
    fillColor: '#00FF00',
    fillOpacity: 40,
    strokeWidth: 2,
    lineBorderStyle: 'cloud',
    cloudIntensity: 7,
  });
  assert.equal(cloudRect.strokeDashArray, null);
  assert.equal(cloudRect.data.pdfCloudIntensity, 7);

  const cloudEllipse = buildBoundaryShapeCommitJSON({
    tool: 'ellipse',
    id: 'ellipse-cloud',
    start,
    end,
    strokeColor: '#0000FF',
    strokeOpacity: 100,
    fillColor: '#FFFF00',
    fillOpacity: 40,
    strokeWidth: 2,
    lineBorderStyle: 'cloud',
    cloudIntensity: 7,
  });
  assert.equal(cloudEllipse.strokeDashArray, null, 'cloud is rect-only; Ellipse create stays solid');
  assert.equal(cloudEllipse.data.pdfCloudIntensity, undefined);

  const text = buildNewTextCommitJSON({
    text: 'dash leftover',
    left: 20,
    top: 30,
    innerWrapWidth: 80,
    maxLineWidth: 40,
    lineCount: 1,
    naturalInnerHeight: 18,
    stroke: '#000000',
    strokeWidth: 1,
  });
  assert.equal(text.type, 'Textbox');
  assert.equal(text.strokeDashArray, null, 'omitted Style stays solid');

  const dashedText = buildNewTextCommitJSON({
    text: 'armed dash',
    left: 20,
    top: 30,
    innerWrapWidth: 80,
    maxLineWidth: 40,
    lineCount: 1,
    naturalInnerHeight: 18,
    stroke: '#000000',
    strokeWidth: 1,
    strokeDashArray: [6, 4],
  });
  assert.deepEqual(dashedText.strokeDashArray, [6, 4], 'first-create stamps next-draw Dashed');
});

test('live Rect/Ellipse/Text Style spec covers every style + break + edge', () => {
  const spec = read('debug/scenarios/e2e-rect-ellipse-text-dash.spec.mjs');
  assert.match(spec, /RECT_STYLES/);
  assert.match(spec, /DASH_STYLES/);
  assert.match(spec, /createRect/);
  assert.match(spec, /createEllipse/);
  assert.match(spec, /createText/);
  assert.match(spec, /selected-patch/);
  assert.match(spec, /Cloud/);
  assert.match(spec, /Pen-armed/);
  assert.match(spec, /Select \/ empty page invents 0/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /390/);
  assert.match(spec, /Border style/);
  assert.match(spec, /cloud-rect/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  for (const value of ['solid', 'dashed', 'dotted', 'cloud']) {
    assert.match(spec, new RegExp(value));
  }
});
