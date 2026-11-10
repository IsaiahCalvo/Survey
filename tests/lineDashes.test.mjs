// Nightly 'line-dashes': Long dash and Dash-dot (Drawboard PDF's five patterns).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LINE_STYLE_OPTIONS,
  lineStyleOptionsWith,
  dashForLineStyle,
  lineStyleForDash,
  isDashLineStyle,
} from '../src/utils/lineStyleOptions.js';
import { readRestyleStyle, applyRestyleChange } from '../src/utils/selectionRestyle.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const rect = (dash = null) => ({
  type: 'rect', left: 10, top: 10, width: 80, height: 40, stroke: '#ff0000', strokeWidth: 2,
  fill: 'transparent', strokeDashArray: dash, data: { id: 'r1' },
});

test('the picker offers the two more styles only with the flag, before Cloud', () => {
  assert.deepEqual(lineStyleOptionsWith(false).map((o) => o.value), ['solid', 'dashed', 'dotted', 'cloud']);
  assert.equal(lineStyleOptionsWith(false), LINE_STYLE_OPTIONS);
  assert.deepEqual(
    lineStyleOptionsWith(true).map((o) => o.label),
    ['Solid', 'Dashed', 'Dotted', 'Long dash', 'Dash-dot', 'Cloud'],
  );
});

test('each style has its dash run, and a dash run reads back as its style', () => {
  assert.deepEqual(dashForLineStyle('dashed'), [6, 4]);
  assert.deepEqual(dashForLineStyle('dotted'), [2, 4]);
  assert.deepEqual(dashForLineStyle('longDash'), [13, 6]);
  assert.deepEqual(dashForLineStyle('dashDot'), [11, 4, 2, 4]);
  assert.equal(dashForLineStyle('solid'), null);
  assert.equal(dashForLineStyle('cloud'), null);
  const a = dashForLineStyle('longDash');
  a[0] = 99;
  assert.deepEqual(dashForLineStyle('longDash'), [13, 6], 'a fresh array each time');
  for (const style of ['dashed', 'dotted', 'longDash', 'dashDot']) {
    assert.equal(lineStyleForDash(dashForLineStyle(style)), style);
    assert.equal(isDashLineStyle(style), true);
  }
  assert.equal(lineStyleForDash(null), 'solid');
  assert.equal(lineStyleForDash([5, 5]), 'solid');
  assert.equal(isDashLineStyle('cloud'), false);
  assert.equal(isDashLineStyle('solid'), false);
});

test('a picked shape takes Long dash and Dash-dot and reports them back', () => {
  const long = applyRestyleChange(rect(), { kind: 'lineStyle', style: 'longDash' });
  assert.deepEqual(long.strokeDashArray, [13, 6]);
  assert.equal(readRestyleStyle(long).lineStyle, 'longDash');
  const dashDot = applyRestyleChange(long, { kind: 'lineStyle', style: 'dashDot' });
  assert.deepEqual(dashDot.strokeDashArray, [11, 4, 2, 4]);
  assert.equal(readRestyleStyle(dashDot).lineStyle, 'dashDot');
  assert.equal(applyRestyleChange(dashDot, { kind: 'lineStyle', style: 'dashDot' }), null, 'no change, no edit');
  assert.equal(applyRestyleChange(rect(), { kind: 'lineStyle', style: 'zigzag' }), null);
  const solid = applyRestyleChange(dashDot, { kind: 'lineStyle', style: 'solid' });
  assert.equal(solid.strokeDashArray, null);
});

test('a beta flag with its migration; callouts keep three styles; every picker is wired', () => {
  assert.equal(FEATURE_FLAGS['line-dashes']?.stage, 'beta');
  assert.match(read('supabase/migrations/20261110143000_line_dashes_flag.sql'), /\('line-dashes', 'off'/);
  assert.match(read('src/AppShell.jsx'), /lineStyleOptionsWith\(lineDashesOn && bottomToolbarApi\.contextTool !== 'callout'\)/);
  assert.match(read('src/components/SelectionQuickBar.jsx'), /lineStyleOptionsWith\(isFeatureOn\('line-dashes'\) && api\?\.contextTool !== 'callout'\)/);
  assert.match(read('src/mobile/MobilePdfViewerChrome.jsx'), /isFeatureOn\('line-dashes'\) && tool !== 'callout'/);
  assert.match(read('src/pinnedTools/pinnedTools.js'), /'longDash', 'dashDot'/);
});
