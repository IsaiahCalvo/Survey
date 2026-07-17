// tests/lineToolCreationDefaults.test.mjs
//
// Bug fix 2026-07-17 — "the line tool draws arrows".
//
// Line and Arrow are separate toolbar tools sharing one underlying type
// ('Line' with data.arrowheadStyle). The toolbar keeps ONE shared
// arrowheadStyle state (default SOLID_TRIANGLE) and SVGAnnotationLayer passes
// it into buildLineCommitJSON for BOTH tools — so the pure commit builder is
// the seam that must gate it: only tool === 'arrow' may stamp
// data.arrowheadStyle at creation. The renderer's fallback
// (buildLineRenderSpec) is tool-based: 'arrow' → SOLID_TRIANGLE,
// 'line' → NONE — and an explicit data.arrowheadStyle overrides it, which is
// exactly why the leaked stamp made every new plain line grow a head.
//
// Bluebeam model (owner-endorsed): line starts with plain ends, arrow starts
// with the picked head; both stay editable afterwards via the ending picker
// (which writes data.arrowheadStyle explicitly on the committed object).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineCommitJSON } from '../src/utils/annotationCreationCommit.js';
import { buildLineRenderSpec, ARROWHEAD_STYLES } from '../src/utils/lineRenderHelpers.js';

const baseArgs = {
  id: 'line-test-1',
  start: { x: 100, y: 100 },
  end: { x: 300, y: 200 },
  strokeColor: '#ff0000',
  strokeOpacity: 100,
  strokeWidth: 3,
  // The shared toolbar default that used to leak into plain lines:
  arrowheadStyle: ARROWHEAD_STYLES.SOLID_TRIANGLE,
  lineBorderStyle: 'solid',
  cloudIntensity: 2,
  selectedModuleId: null,
  stampRegionId: null,
  activeRegionId: null,
};

test('line tool commit carries NO arrowheadStyle even when the toolbar holds one', () => {
  const json = buildLineCommitJSON({ ...baseArgs, tool: 'line' });
  assert.ok(json, 'commit must build');
  assert.equal(json.tool, 'line');
  assert.ok(!('arrowheadStyle' in json.data),
    'plain line must not inherit the shared toolbar arrowhead default');
  // And the render spec resolves it to a headless line:
  const spec = buildLineRenderSpec(json);
  assert.equal(spec.arrowhead.kind, 'none', 'new plain line must render with no ending');
});

test('arrow tool commit stamps the toolbar arrowheadStyle', () => {
  const json = buildLineCommitJSON({ ...baseArgs, tool: 'arrow' });
  assert.equal(json.data.arrowheadStyle, ARROWHEAD_STYLES.SOLID_TRIANGLE);
  const spec = buildLineRenderSpec(json);
  assert.equal(spec.arrowhead.kind, 'solidTriangle', 'new arrow must render its head');
});

test('arrow tool without a toolbar style still renders the default head via tool fallback', () => {
  const json = buildLineCommitJSON({ ...baseArgs, tool: 'arrow', arrowheadStyle: null });
  assert.ok(!('arrowheadStyle' in json.data));
  const spec = buildLineRenderSpec(json);
  assert.equal(spec.arrowhead.kind, 'solidTriangle',
    'tool-based fallback keeps the arrow tool arrow-looking');
});

test('existing saves are untouched: explicit data.arrowheadStyle still wins on a plain line', () => {
  // A line saved during the bug window carries data.arrowheadStyle — its look
  // must NOT change (this was a creation-default fix, not a render change).
  const legacy = buildLineCommitJSON({ ...baseArgs, tool: 'line' });
  legacy.data.arrowheadStyle = ARROWHEAD_STYLES.OPEN_CIRCLE;
  const spec = buildLineRenderSpec(legacy);
  assert.equal(spec.arrowhead.kind, 'openCircle',
    'stored ending fields keep rendering exactly as saved');
});
