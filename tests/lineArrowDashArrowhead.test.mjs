import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARROWHEAD_STYLES,
  ARROWHEAD_STYLE_LABELS,
  CALLOUT_LINE_STYLES,
  calloutLineDashArray,
} from '../src/components/Callout/types.js';
import { buildLineCommitJSON } from '../src/utils/annotationCreationCommit.js';
import { buildArrowheadRenderSpec, buildLineRenderSpec } from '../src/utils/lineRenderHelpers.js';

// Source contracts for Line/Arrow dash + arrowhead catalogs.
// Live proof: debug/scenarios/e2e-line-arrow-dash-arrowhead.spec.mjs
// Distinct from UL-33 catalog smoke (rect Dashed/Dotted) and S-04 sample
// (vShape / Open circle / None).

const DASH_STYLES = [
  { value: 'solid', dash: null },
  { value: 'dashed', dash: [6, 4] },
  { value: 'dotted', dash: [2, 4] },
];

const ARROWHEAD_VALUES = [
  'none',
  'solidTriangle',
  'vShape',
  'openCircle',
  'openTriangle',
  'horizontalLine',
];

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const start = { x: 10, y: 20 };
const end = { x: 80, y: 40 };

test('Line/Arrow Style catalog is Solid/Dashed/Dotted; Cloud is rect-only; Arrowhead is 6 styles', () => {
  assert.deepEqual(Object.values(ARROWHEAD_STYLES), ARROWHEAD_VALUES);
  assert.deepEqual(Object.values(ARROWHEAD_STYLE_LABELS), [
    'None',
    'Solid triangle',
    'V-shape',
    'Open circle',
    'Open triangle',
    'Horizontal line',
  ]);
  assert.deepEqual(Object.values(CALLOUT_LINE_STYLES), ['solid', 'dashed', 'dotted']);
  assert.deepEqual(calloutLineDashArray('dashed'), [6, 4]);
  assert.deepEqual(calloutLineDashArray('dotted'), [2, 4]);
  assert.equal(calloutLineDashArray('solid'), null);
  assert.equal(calloutLineDashArray('cloud'), null);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /\{ value: 'solid', label: 'Solid' \}/);
  assert.match(shell, /\{ value: 'dashed', label: 'Dashed' \}/);
  assert.match(shell, /\{ value: 'dotted', label: 'Dotted' \}/);
  assert.match(shell, /\.\.\.\(bottomToolbarApi\.contextTool === 'rect' \? \[\{ value: 'cloud', label: 'Cloud' \}\] : \[\]\)/);
  assert.match(
    shell,
    /\(bottomToolbarApi\.contextTool === 'arrow' \|\| bottomToolbarApi\.contextTool === 'callout'\) && bottomToolbarApi\.setArrowheadStyle/,
  );
  assert.doesNotMatch(
    shell,
    /contextTool === 'line'[\s\S]{0,80}setArrowheadStyle/,
  );

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /const BORDER_STYLE_TOOLS = new Set\(\['rect', 'ellipse', 'line', 'arrow', 'text', 'callout'\]\)/);
  assert.match(mobile, /showArrowhead = \(tool === 'arrow' \|\| tool === 'callout'\)/);
  assert.match(mobile, /\.\.\.\(tool === 'rect' \? \[\{ value: 'cloud', label: 'Cloud' \}\] : \[\]\)/);
  assert.match(mobile, /solidTriangle: 'Solid Triangle'/);
  assert.match(mobile, /horizontalLine: 'Horizontal Line'/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /else if \(next === 'dashed'\) \{\s*\n\s*handlePatchSelectedAnnotation\(\{ strokeDashArray: \[6, 4\]/);
  assert.match(viewer, /else if \(next === 'dotted'\) \{\s*\n\s*handlePatchSelectedAnnotation\(\{ strokeDashArray: \[2, 4\]/);
  assert.match(viewer, /handlePatchSelectedAnnotation\(\{ data: \{ arrowheadStyle: next \} \}\)/);
  assert.match(viewer, /if \(!isArrow\) return;/);
});

test('buildLineCommitJSON stamps every dash; Line never inherits arrowhead; Arrow stamps every head', () => {
  const commit = read('src/utils/annotationCreationCommit.js');
  assert.match(commit, /json\.strokeDashArray = \[6, 4\]/);
  assert.match(commit, /json\.strokeDashArray = \[2, 4\]/);
  assert.match(commit, /data: \(tool === 'arrow' && arrowheadStyle\) \? \{ id, arrowheadStyle \} : \{ id \}/);

  for (const style of DASH_STYLES) {
    const line = buildLineCommitJSON({
      tool: 'line',
      id: `line-${style.value}`,
      start,
      end,
      strokeColor: '#FF0000',
      strokeOpacity: 100,
      strokeWidth: 2,
      lineBorderStyle: style.value,
      arrowheadStyle: ARROWHEAD_STYLES.SOLID_TRIANGLE,
    });
    const arrow = buildLineCommitJSON({
      tool: 'arrow',
      id: `arrow-${style.value}`,
      start,
      end,
      strokeColor: '#0000FF',
      strokeOpacity: 100,
      strokeWidth: 2,
      lineBorderStyle: style.value,
      arrowheadStyle: ARROWHEAD_STYLES.SOLID_TRIANGLE,
    });
    assert.equal(line.tool, 'line');
    assert.equal(arrow.tool, 'arrow');
    assert.deepEqual(line.strokeDashArray, style.dash, `line ${style.value}`);
    assert.deepEqual(arrow.strokeDashArray, style.dash, `arrow ${style.value}`);
    assert.equal(line.data.arrowheadStyle, undefined, 'plain line must not inherit toolbar arrowhead');
    assert.equal(arrow.data.arrowheadStyle, 'solidTriangle');
    assert.equal(buildLineRenderSpec(line).arrowhead.kind, 'none');
    assert.equal(buildLineRenderSpec(arrow).arrowhead.kind, 'solidTriangle');
  }

  const cloudLine = buildLineCommitJSON({
    tool: 'line',
    id: 'line-cloud',
    start,
    end,
    strokeColor: '#FF0000',
    strokeOpacity: 100,
    strokeWidth: 2,
    lineBorderStyle: 'cloud',
    arrowheadStyle: ARROWHEAD_STYLES.OPEN_CIRCLE,
  });
  assert.equal(cloudLine.strokeDashArray, null, 'cloud is rect-only; Line create stays solid');
  assert.equal(cloudLine.data.arrowheadStyle, undefined);
  assert.equal(cloudLine.data.pdfCloudIntensity, undefined);

  for (const style of ARROWHEAD_VALUES) {
    const arrow = buildLineCommitJSON({
      tool: 'arrow',
      id: `arrow-head-${style}`,
      start,
      end,
      strokeColor: '#000000',
      strokeOpacity: 100,
      strokeWidth: 2,
      lineBorderStyle: 'solid',
      arrowheadStyle: style,
    });
    assert.equal(arrow.data.arrowheadStyle, style);
    const spec = buildArrowheadRenderSpec(style, 80, 40, 0, '#000000', 2);
    assert.equal(spec.kind, style === 'none' ? 'none' : style);
    const rendered = buildLineRenderSpec(arrow);
    assert.equal(rendered.arrowhead.kind, style);
  }

  const unknown = buildArrowheadRenderSpec('not-a-style', 80, 40, 0, '#000000', 2);
  assert.equal(unknown.kind, 'none', 'unknown arrowhead fails closed to none');
});

test('live Line/Arrow dash + arrowhead spec covers every style + break + edge', () => {
  const spec = read('debug/scenarios/e2e-line-arrow-dash-arrowhead.spec.mjs');
  assert.match(spec, /DASH_STYLES/);
  assert.match(spec, /ARROWHEAD_STYLES/);
  assert.match(spec, /Solid triangle/);
  assert.match(spec, /Horizontal line/);
  assert.match(spec, /createLine/);
  assert.match(spec, /createArrow/);
  assert.match(spec, /selected-patch/);
  assert.match(spec, /Cloud/);
  assert.match(spec, /Pen-armed/);
  assert.match(spec, /Select \/ empty page invents 0/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /390/);
  assert.match(spec, /Border style/);
  assert.match(spec, /Arrowhead style/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  for (const value of ['solid', 'dashed', 'dotted', ...ARROWHEAD_VALUES]) {
    assert.match(spec, new RegExp(value));
  }
});
