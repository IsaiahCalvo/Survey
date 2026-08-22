import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARROWHEAD_STYLES,
  ARROWHEAD_STYLE_LABELS,
  CALLOUT_LINE_STYLES,
  calloutLineDashArray,
  defaultCalloutStyle,
} from '../src/components/Callout/types.js';
import { buildCalloutRenderSpec } from '../src/utils/calloutEditAdapter.js';
import { buildArrowheadRenderSpec } from '../src/utils/lineRenderHelpers.js';
import { calloutToAnnotationObject } from '../src/utils/calloutAnnotationBridge.js';

// Source + render contracts for Callout dash + arrowhead catalogs.
// Live proof: debug/scenarios/e2e-callout-dash-arrowhead.spec.mjs
// Distinct from Line/Arrow every-style and T-02 handles / Width / colors.

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

const PAGE = { width: 612, height: 792 };

const stubConnection = (tbX, tbY, tbW, tbH, knee) => ({
  line1Start: { x: tbX + tbW / 2, y: tbY + tbH / 2 },
  effectiveKnee: { x: knee.x, y: knee.y },
  line2Start: { x: knee.x, y: knee.y },
  shouldHideLine1: false,
});

function makeCallout(stylePatch = {}) {
  return {
    id: `callout-${stylePatch.lineStyle || stylePatch.arrowheadStyle || 'default'}`,
    pageNumber: 1,
    arrowTip: { x: 0.50, y: 0.50 },
    knee: { x: 0.30, y: 0.30 },
    textBoxPosition: { x: 0.10, y: 0.12 },
    textBoxWidth: 0.22,
    textBoxHeight: 0.08,
    text: 'dash-proof',
    style: {
      ...defaultCalloutStyle,
      ...stylePatch,
    },
  };
}

function findAll(node, predicate, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (predicate(node)) found.push(node);
  if (Array.isArray(node.children)) {
    for (const child of node.children) findAll(child, predicate, found);
  }
  return found;
}

function partOf(spec, part) {
  return findAll(spec, (n) => n.attrs && n.attrs['data-callout-part'] === part)[0];
}

function arrowheadNodeOf(spec) {
  return findAll(spec, (n) => n.key === 'arrowhead')[0] || null;
}

test('Callout Style catalog is Solid/Dashed/Dotted; Cloud is rect-only; Arrowhead is 6 styles', () => {
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
  assert.equal(defaultCalloutStyle.arrowheadStyle, 'solidTriangle');
  assert.equal(defaultCalloutStyle.lineStyle, 'solid');
  assert.equal(defaultCalloutStyle.fontFamily.includes(','), false);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /contextTool === 'callout'\) && bottomToolbarApi\.setLineBorderStyle/);
  assert.match(
    shell,
    /\(bottomToolbarApi\.contextTool === 'arrow' \|\| bottomToolbarApi\.contextTool === 'callout'\) && bottomToolbarApi\.setArrowheadStyle/,
  );
  assert.match(shell, /\.\.\.\(bottomToolbarApi\.contextTool === 'rect' \? \[\{ value: 'cloud', label: 'Cloud' \}\] : \[\]\)/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /const BORDER_STYLE_TOOLS = new Set\(\['rect', 'ellipse', 'line', 'arrow', 'text', 'callout'\]\)/);
  assert.match(mobile, /showArrowhead = \(tool === 'arrow' \|\| tool === 'callout'\)/);
  assert.match(mobile, /\.\.\.\(tool === 'rect' \? \[\{ value: 'cloud', label: 'Cloud' \}\] : \[\]\)/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /if \(isCalloutSelected\(\)\) \{\s*\n\s*if \(next === 'solid' \|\| next === 'dashed' \|\| next === 'dotted'\) \{\s*\n\s*handlePatchSelectedCallout\(\{ lineStyle: next \}\)/);
  assert.match(viewer, /if \(isCalloutSelected\(\)\) \{\s*\n\s*handlePatchSelectedCallout\(\{ arrowheadStyle: next \}\)/);
  assert.match(viewer, /lineStyle: \(lineBorderStyleRef\.current === 'dashed' \|\| lineBorderStyleRef\.current === 'dotted'\)/);
  assert.match(viewer, /arrowheadStyle: arrowheadStyleRef\.current \|\| rawCallout\.style\?\.arrowheadStyle/);
});

test('buildCalloutRenderSpec stamps every dash on leader+box and every arrowhead kind', () => {
  for (const style of DASH_STYLES) {
    const spec = buildCalloutRenderSpec(
      makeCallout({ lineStyle: style.value, arrowheadStyle: 'solidTriangle' }),
      0,
      PAGE,
      stubConnection,
    );
    const expected = style.dash ? style.dash.join(' ') : undefined;
    for (const part of ['line1', 'line2', 'textBox']) {
      assert.equal(partOf(spec, part).attrs.strokeDasharray, expected, `${style.value} ${part}`);
    }
    const head = arrowheadNodeOf(spec);
    assert.ok(head, `${style.value} still renders a default head`);
    assert.equal(head.attrs.strokeDasharray, undefined, 'arrowhead stays solid');
    const projected = calloutToAnnotationObject(makeCallout({ lineStyle: style.value }), PAGE);
    assert.equal(projected.data.legacyCallout.style.lineStyle, style.value);
  }

  const kinds = {
    none: null,
    solidTriangle: 'polygon',
    openTriangle: 'polygon',
    openCircle: 'circle',
    vShape: 'polyline',
    horizontalLine: 'line',
  };
  for (const style of ARROWHEAD_VALUES) {
    const spec = buildCalloutRenderSpec(
      makeCallout({ lineStyle: 'solid', arrowheadStyle: style }),
      0,
      PAGE,
      stubConnection,
    );
    const head = arrowheadNodeOf(spec);
    if (style === 'none') {
      assert.equal(head, null, 'none emits no head');
    } else {
      assert.equal(head.type, kinds[style], style);
      if (style === 'openTriangle') assert.equal(head.attrs.fill, 'none');
      if (style === 'solidTriangle') assert.notEqual(head.attrs.fill, 'none');
    }
    const render = buildArrowheadRenderSpec(style, 306, 396, 0, '#1e293b', 2);
    assert.equal(render.kind, style === 'none' ? 'none' : style);
    const projected = calloutToAnnotationObject(makeCallout({ arrowheadStyle: style }), PAGE);
    assert.equal(projected.data.legacyCallout.style.arrowheadStyle, style);
  }

  const unknown = buildArrowheadRenderSpec('not-a-style', 306, 396, 0, '#1e293b', 2);
  assert.equal(unknown.kind, 'none', 'unknown arrowhead fails closed to none');
  const cloudSpec = buildCalloutRenderSpec(makeCallout({ lineStyle: 'cloud' }), 0, PAGE, stubConnection);
  for (const part of ['line1', 'line2', 'textBox']) {
    assert.equal(partOf(cloudSpec, part).attrs.strokeDasharray, undefined, 'cloud is rect-only');
  }
});

test('live Callout dash + arrowhead spec covers every style + break + edge', () => {
  const spec = read('debug/scenarios/e2e-callout-dash-arrowhead.spec.mjs');
  assert.match(spec, /DASH_STYLES/);
  assert.match(spec, /ARROWHEAD_STYLES/);
  assert.match(spec, /Solid triangle/);
  assert.match(spec, /Horizontal line/);
  assert.match(spec, /createCallout/);
  assert.match(spec, /selected-patch/);
  assert.match(spec, /Cloud-armed Callout create stays solid/);
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
