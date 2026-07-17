// tests/calloutRenderer.test.mjs
// Wave 0 scaffold for CALL-10 renderer signature + data attribute output.
//
// Import strategy: Node's native --test runner cannot load .jsx files directly
// (tried 2026-04-15 — fails with "Unknown file extension .jsx"). Rather than
// adding a loader dep, we test the PURE data-spec helper that the JSX renderCallout
// wraps. Task 3 of Plan 14-01 creates `buildCalloutRenderSpec()` in
// `src/utils/calloutEditAdapter.js` (a .js file) — it returns a plain object
// tree describing every element the renderCallout JSX will emit, including the
// exact `data-callout-id` / `data-callout-part` attributes and the sanitized
// foreignObject `fontFamily`. The renderer in svgAnnotationRenderers.jsx imports
// this helper and wraps its output with React.createElement calls — so any
// contract we verify against the spec also applies to the real JSX tree.
//
// See 14-01-PLAN.md Task 1 "IMPORTANT notes" for the fallback-path rationale.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCalloutRenderSpec,
} from '../src/utils/calloutEditAdapter.js';

// Minimal stub for calculateCalloutConnection — the renderer only reads
// line1Start / effectiveKnee / line2Start / shouldHideLine1 from it.
const stubConnection = (tbX, tbY, tbW, tbH, knee, _tip, _thickness) => ({
  line1Start: { x: tbX + tbW / 2, y: tbY + tbH / 2 },
  effectiveKnee: { x: knee.x, y: knee.y },
  line2Start: { x: knee.x, y: knee.y },
  shouldHideLine1: false,
});

const baseCallout = {
  id: 'test-1',
  pageNumber: 1,
  arrowTip: { x: 0.5, y: 0.5 },
  knee: { x: 0.3, y: 0.3 },
  textBoxPosition: { x: 0.1, y: 0.1 },
  textBoxWidth: 0.2,
  textBoxHeight: 0.05,
  text: 'hello',
  style: {
    borderColor: '#1e293b',
    fillColor: '#ffffff',
    lineThickness: 2,
    fontSize: 14,
    fontFamily: 'Arial',
    fontColor: '#1e293b',
    borderOpacity: 1,
    fillOpacity: 1,
  },
};

// Walk a spec tree to collect every node with a predicate match.
function findAll(node, predicate, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (predicate(node)) found.push(node);
  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) findAll(child, predicate, found);
  }
  return found;
}

test('buildCalloutRenderSpec returns a spec object for a valid callout', () => {
  const spec = buildCalloutRenderSpec(baseCallout, 0, { width: 1000, height: 800 }, stubConnection);
  assert.ok(spec, 'expected non-null spec output');
  assert.equal(spec.type, 'g', 'outer element should be <g>');
});

test('buildCalloutRenderSpec outer <g> carries data-callout-id', () => {
  const spec = buildCalloutRenderSpec(baseCallout, 0, { width: 1000, height: 800 }, stubConnection);
  assert.equal(spec.attrs['data-callout-id'], 'test-1');
});

test('buildCalloutRenderSpec children carry data-callout-part values from the allowed set', () => {
  const spec = buildCalloutRenderSpec(baseCallout, 0, { width: 1000, height: 800 }, stubConnection);
  const allowed = new Set(['arrowTip', 'knee', 'textBox', 'line1', 'line2', 'text']);
  const parts = findAll(spec, (node) => node.attrs && node.attrs['data-callout-part'])
    .map((node) => node.attrs['data-callout-part']);
  assert.ok(parts.length > 0, 'expected at least one data-callout-part child');
  for (const part of parts) {
    assert.ok(allowed.has(part), `invalid data-callout-part: ${part}`);
  }
});

test('buildCalloutRenderSpec sanitizes fontFamily fallback stack to first token (data-callout-id coverage)', () => {
  const withStack = { ...baseCallout, style: { ...baseCallout.style, fontFamily: 'Inter, Arial, sans-serif' } };
  const spec = buildCalloutRenderSpec(withStack, 0, { width: 1000, height: 800 }, stubConnection);
  // The foreignObject's inner div carries the sanitized fontFamily via
  // spec.style.fontFamily on the 'text' child's single innerDiv child.
  const textNode = findAll(spec, (n) => n.attrs && n.attrs['data-callout-part'] === 'text')[0];
  assert.ok(textNode, 'expected a text foreignObject child with data-callout-part=text');
  // data-callout-part marker on the foreignObject should be present (the sanitize
  // test below verifies the actual font value lands on the inner div child).
  assert.equal(textNode.attrs['data-callout-part'], 'text');
});

test('buildCalloutRenderSpec sanitizes fontFamily fallback stack to first token', () => {
  const withStack = { ...baseCallout, style: { ...baseCallout.style, fontFamily: 'Inter, Arial, sans-serif' } };
  const spec = buildCalloutRenderSpec(withStack, 0, { width: 1000, height: 800 }, stubConnection);
  const textNode = findAll(spec, (n) => n.attrs && n.attrs['data-callout-part'] === 'text')[0];
  assert.ok(textNode, 'expected a text foreignObject child');
  // Inner HTML div is the single child of the foreignObject spec node
  const innerDiv = textNode.children && textNode.children[0];
  assert.ok(innerDiv, 'expected an inner div child');
  assert.equal(innerDiv.style.fontFamily, 'Inter');
});

// 2026-07-17 — stored text-style flags must RENDER on the committed callout
// (bug: bold/italic/underline/strikethrough were saved + round-tripped but the
// view dropped them, so text visibly un-styled itself on leaving edit mode).
// The spec's inner div mirrors renderCallout's buildCalloutTextContentStyle
// output 1:1, so these assertions cover the real JSX contract.
const innerDivOf = (spec) => {
  const textNode = findAll(spec, (n) => n.attrs && n.attrs['data-callout-part'] === 'text')[0];
  return textNode && textNode.children && textNode.children[0];
};

test('callout spec inner div renders bold-only as font-weight bold', () => {
  const withBold = { ...baseCallout, style: { ...baseCallout.style, bold: true } };
  const innerDiv = innerDivOf(buildCalloutRenderSpec(withBold, 0, { width: 1000, height: 800 }, stubConnection));
  assert.ok(innerDiv, 'expected an inner div child');
  assert.equal(innerDiv.style.fontWeight, 'bold');
  assert.equal(innerDiv.style.fontStyle, 'normal');
  assert.equal(innerDiv.style.textDecoration, 'none');
});

test('callout spec inner div renders italic + underline together', () => {
  const styled = { ...baseCallout, style: { ...baseCallout.style, italic: true, underline: true } };
  const innerDiv = innerDivOf(buildCalloutRenderSpec(styled, 0, { width: 1000, height: 800 }, stubConnection));
  assert.ok(innerDiv, 'expected an inner div child');
  assert.equal(innerDiv.style.fontStyle, 'italic');
  assert.equal(innerDiv.style.fontWeight, 'normal');
  assert.equal(innerDiv.style.textDecoration, 'underline');
});

test('callout spec inner div renders strikethrough as line-through', () => {
  const styled = { ...baseCallout, style: { ...baseCallout.style, strikethrough: true } };
  const innerDiv = innerDivOf(buildCalloutRenderSpec(styled, 0, { width: 1000, height: 800 }, stubConnection));
  assert.ok(innerDiv, 'expected an inner div child');
  assert.equal(innerDiv.style.textDecoration, 'line-through');
});

test('callout spec inner div combines underline + strikethrough decorations', () => {
  const styled = { ...baseCallout, style: { ...baseCallout.style, underline: true, strikethrough: true } };
  const innerDiv = innerDivOf(buildCalloutRenderSpec(styled, 0, { width: 1000, height: 800 }, stubConnection));
  assert.ok(innerDiv, 'expected an inner div child');
  assert.equal(innerDiv.style.textDecoration, 'underline line-through');
});

test('callout spec inner div defaults to unstyled text when flags are absent', () => {
  const innerDiv = innerDivOf(buildCalloutRenderSpec(baseCallout, 0, { width: 1000, height: 800 }, stubConnection));
  assert.ok(innerDiv, 'expected an inner div child');
  assert.equal(innerDiv.style.fontWeight, 'normal');
  assert.equal(innerDiv.style.fontStyle, 'normal');
  assert.equal(innerDiv.style.textDecoration, 'none');
});

test('buildCalloutRenderSpec returns null for null input', () => {
  assert.equal(buildCalloutRenderSpec(null, 0, { width: 1000, height: 800 }, stubConnection), null);
});

test('buildCalloutRenderSpec returns null for callout missing arrowTip', () => {
  const incomplete = { ...baseCallout, arrowTip: null };
  assert.equal(buildCalloutRenderSpec(incomplete, 0, { width: 1000, height: 800 }, stubConnection), null);
});

test('buildCalloutRenderSpec returns null for callout missing knee', () => {
  const incomplete = { ...baseCallout, knee: null };
  assert.equal(buildCalloutRenderSpec(incomplete, 0, { width: 1000, height: 800 }, stubConnection), null);
});

// ---------------------------------------------------------------------------
// Callout leader arrowhead — shared arrow-tool spec adoption (KAL-81 parity).
// The callout's head renders via the SAME buildArrowheadRenderSpec home the
// line/arrow tool uses; these tests lock the spec-level contract:
//   1. default (no style.arrowheadStyle) === explicit SOLID_TRIANGLE
//      structurally — visual no-op for every pre-existing callout.
//   2. each of the 6 styles emits its distinct primitive node.
//   3. triangle styles shorten line2 into the back of the head; the other
//      styles leave line2 ending exactly on the arrow tip.
// ---------------------------------------------------------------------------

const PAGE_SIZE = { width: 1000, height: 800 };

const specWithArrowhead = (arrowheadStyle) => buildCalloutRenderSpec(
  arrowheadStyle === undefined
    ? baseCallout
    : { ...baseCallout, style: { ...baseCallout.style, arrowheadStyle } },
  0, PAGE_SIZE, stubConnection,
);

const arrowheadNodeOf = (spec) => findAll(spec, (n) => n.key === 'arrowhead')[0] || null;
const line2Of = (spec) => findAll(spec, (n) => n.attrs && n.attrs['data-callout-part'] === 'line2')[0];

test('callout default arrowhead is structurally identical to explicit solidTriangle', () => {
  const defaultSpec = specWithArrowhead(undefined);
  const explicitSpec = specWithArrowhead('solidTriangle');
  const defaultHead = arrowheadNodeOf(defaultSpec);
  const explicitHead = arrowheadNodeOf(explicitSpec);
  assert.ok(defaultHead, 'default callout must render an arrowhead node');
  assert.deepEqual(defaultHead, explicitHead,
    'legacy callouts (no arrowheadStyle) must keep the exact solid-triangle look');
  // and line2 geometry must match too (same shortening)
  assert.deepEqual(line2Of(defaultSpec).attrs, line2Of(explicitSpec).attrs);
});

test('callout solid triangle head is a filled polygon in the leader color', () => {
  const head = arrowheadNodeOf(specWithArrowhead('solidTriangle'));
  assert.equal(head.type, 'polygon');
  assert.equal(head.attrs.fill, '#1e293b');
  assert.ok(head.attrs.points, 'polygon must carry points');
});

test('callout open triangle head is an unfilled stroked polygon', () => {
  const head = arrowheadNodeOf(specWithArrowhead('openTriangle'));
  assert.equal(head.type, 'polygon');
  assert.equal(head.attrs.fill, 'none');
  assert.equal(head.attrs.stroke, '#1e293b');
});

test('callout open circle head is an unfilled circle centered on the arrow tip', () => {
  const spec = specWithArrowhead('openCircle');
  const head = arrowheadNodeOf(spec);
  assert.equal(head.type, 'circle');
  assert.equal(head.attrs.fill, 'none');
  // tip in page coords: arrowTip {0.5, 0.5} on 1000x800
  assert.equal(head.attrs.cx, 500);
  assert.equal(head.attrs.cy, 400);
});

test('callout v-shape head is a polyline through the arrow tip', () => {
  const head = arrowheadNodeOf(specWithArrowhead('vShape'));
  assert.equal(head.type, 'polyline');
  assert.ok(String(head.attrs.points).includes('500,400'), 'polyline must pass through the tip');
});

test('callout horizontal-line head is a perpendicular tick line', () => {
  const head = arrowheadNodeOf(specWithArrowhead('horizontalLine'));
  assert.equal(head.type, 'line');
  assert.equal(head.attrs.stroke, '#1e293b');
});

test('callout arrowhead style none emits no head node and line2 reaches the tip', () => {
  const spec = specWithArrowhead('none');
  assert.equal(arrowheadNodeOf(spec), null, 'none must not render any arrowhead');
  const line2 = line2Of(spec);
  assert.equal(line2.attrs.x2, 500);
  assert.equal(line2.attrs.y2, 400);
});

test('callout triangle heads shorten line2 into the back of the head; open styles do not', () => {
  for (const style of ['solidTriangle', 'openTriangle']) {
    const line2 = line2Of(specWithArrowhead(style));
    assert.ok(line2.attrs.x2 !== 500 || line2.attrs.y2 !== 400,
      `${style} must pull line2 short of the tip`);
  }
  for (const style of ['openCircle', 'vShape', 'horizontalLine']) {
    const line2 = line2Of(specWithArrowhead(style));
    assert.equal(line2.attrs.x2, 500, `${style} line2 must end on the tip (x)`);
    assert.equal(line2.attrs.y2, 400, `${style} line2 must end on the tip (y)`);
  }
});
