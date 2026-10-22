// Resize several marks at once (owner ask 2026-10-22): Drawboard's rules for
// the frame's scale, plus tldraw's rule for a mark turned off a right angle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canGroupResizeMember,
  groupResizeMinimumScale,
  isSideways,
  markNeedsUniformGroupScale,
  memberAxisScale,
  resolveGroupResizeScale,
  scaleCalloutForGroup,
  scaleMarkerBoundsForGroup,
  scaledGroupFontSize,
  scaledTextBoxLength,
  textScalesFontFor,
} from '../src/utils/groupResize.js';

const rect = (extra = {}) => ({ type: 'rect', left: 0, top: 0, width: 10, height: 10, angle: 0, ...extra });
const text = (extra = {}) => ({ type: 'textbox', fontSize: 12, angle: 0, ...extra });

test('a corner stretches freely; an edge scales one axis', () => {
  assert.deepEqual(resolveGroupResizeScale({ handleId: 'br', sx: 2, sy: 1.5 }), { sx: 2, sy: 1.5 });
  assert.deepEqual(resolveGroupResizeScale({ handleId: 'mr', sx: 2, sy: 3 }), { sx: 2, sy: 1 });
  assert.deepEqual(resolveGroupResizeScale({ handleId: 'mb', sx: 3, sy: 0.5 }), { sx: 1, sy: 0.5 });
});

test('kept proportions follow the bigger move; an edge grows both axes', () => {
  assert.deepEqual(resolveGroupResizeScale({ handleId: 'br', sx: 2, sy: 1.2, keepProportions: true }), { sx: 2, sy: 2 });
  assert.deepEqual(resolveGroupResizeScale({ handleId: 'tl', sx: 0.9, sy: 0.5, keepProportions: true }), { sx: 0.5, sy: 0.5 });
  assert.deepEqual(resolveGroupResizeScale({ handleId: 'ml', sx: 1.5, sy: 1, keepProportions: true }), { sx: 1.5, sy: 1.5 });
  assert.deepEqual(resolveGroupResizeScale({ handleId: 'mt', sx: 1, sy: 0.75, keepProportions: true }), { sx: 0.75, sy: 0.75 });
});

test('a group never mirrors and stops at its floor', () => {
  assert.deepEqual(resolveGroupResizeScale({ handleId: 'br', sx: -0.5, sy: 0.5, minScaleX: 0.1, minScaleY: 0.2 }), { sx: 0.1, sy: 0.5 });
  assert.deepEqual(resolveGroupResizeScale({ handleId: 'br', sx: 0.01, sy: 0.02, keepProportions: true, minScaleX: 0.1, minScaleY: 0.2 }), { sx: 0.2, sy: 0.2 });
});

test('the floor keeps every member at least 4 page units (or its own size)', () => {
  const { minScaleX, minScaleY } = groupResizeMinimumScale([{ width: 100, height: 40 }, { width: 8, height: 2 }]);
  assert.equal(minScaleX, 0.5);
  assert.equal(minScaleY, 1);
});

test('which marks force the whole frame to keep its proportions', () => {
  assert.equal(markNeedsUniformGroupScale(rect(), 'br'), false);
  assert.equal(markNeedsUniformGroupScale(rect({ angle: 90 }), 'br'), false);
  assert.equal(markNeedsUniformGroupScale(rect({ angle: 180 }), 'mr'), false);
  assert.equal(markNeedsUniformGroupScale(rect({ angle: 30 }), 'mr'), true, 'tilted mark would shear');
  assert.equal(markNeedsUniformGroupScale({ type: 'image', angle: 0 }, 'br'), true, 'photo');
  assert.equal(markNeedsUniformGroupScale({ type: 'line', angle: 90 }, 'br'), true, 'sideways line');
  assert.equal(markNeedsUniformGroupScale({ type: 'line', angle: 0 }, 'br'), false);
  // Drawboard: text keeps proportions except from the left / right side.
  for (const h of ['tl', 'tr', 'bl', 'br', 'mt', 'mb']) assert.equal(markNeedsUniformGroupScale(text(), h), true, h);
  for (const h of ['ml', 'mr']) assert.equal(markNeedsUniformGroupScale(text(), h), false, h);
});

test('text scales its font except from a side grabber', () => {
  assert.equal(textScalesFontFor('br'), true);
  assert.equal(textScalesFontFor('mb'), true);
  assert.equal(textScalesFontFor('mr'), false);
  assert.equal(scaledGroupFontSize(12, 2, 2), 24);
  assert.equal(scaledGroupFontSize(12, 0.5, 3), 6);
  assert.equal(scaledGroupFontSize(2, 0.1, 0.1), 1, 'never under 1');
});

test('a sideways mark takes the frame scales swapped', () => {
  assert.equal(isSideways(90), true);
  assert.equal(isSideways(-90), true);
  assert.equal(isSideways(270), true);
  assert.equal(isSideways(180), false);
  assert.deepEqual(memberAxisScale(90, 2, 1), { x: 1, y: 2 });
  assert.deepEqual(memberAxisScale(0, 2, 1), { x: 2, y: 1 });
});

test('the multi-selection frame shows resize grabbers (rotate stays hidden)', () => {
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(layer, /moveOnly=\{!groupCanResize\}\s*hideRotationHandle/);
  assert.match(layer, /const groupCanResize = !groupHasLockedMember/);
  assert.match(layer, /\(groupCalloutIdSet\.size > 0\s*\|\| selectedSurveyMarkerIds\.size > 0/);
  const hook = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
  assert.match(hook, /resolveGroupResizeScale\(\{/);
  assert.match(hook, /needsUniformGroupScale: markNeedsUniformGroupScale\(obj, handleId\)/);
});

test('a text box scales inside its fixed padding', () => {
  assert.equal(scaledTextBoxLength(112, 0.5, 6), 62, '(112 - 12) * 0.5 + 12');
  assert.equal(scaledTextBoxLength(112, 2, 6), 212);
  assert.equal(scaledTextBoxLength(10, 0.1, 6), 12, 'never under the padding');
});

test('an old-style group arrow keeps the frame move-only', () => {
  assert.equal(canGroupResizeMember(rect()), true);
  assert.equal(canGroupResizeMember({ type: 'line' }), true);
  assert.equal(canGroupResizeMember({ type: 'group', objects: [{ type: 'line' }] }), false);
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(layer, /\.every\(\(idx\) => canGroupResizeMember\(annotations\?\.objects\?\.\[idx\]\)\)/);
});

test('a stamp redraws from its preview during a group resize', () => {
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(layer, /isPdfStampProxy\(renderObj\)\) \{\s*renderElement = <image \{\.\.\.getPdfStampProxySvgProps\(renderObj\)\}/);
});

// Scale about the top-left corner (0, 0).
const about0 = (sx, sy) => (x, y) => ({ x: x * sx, y: y * sy });

test('a callout moves its tip and bend and scales its box and font from a corner', () => {
  const orig = {
    tip: { x: 100, y: 200 }, knee: { x: 150, y: 150 },
    box: { left: 200, top: 100, width: 112, height: 30 }, fontSize: 12, style: { fontSize: 12, bold: true },
  };
  const page = { width: 1000, height: 1000 };
  const patch = scaleCalloutForGroup(orig, about0(2, 2), 2, 2, 'br', page, 6);
  assert.deepEqual(patch.arrowTip, { x: 0.2, y: 0.4 });
  assert.deepEqual(patch.knee, { x: 0.3, y: 0.3 });
  assert.equal(patch.textBoxWidth, 0.212, '(112 - 12) * 2 + 12');
  assert.equal(patch.textBoxHeight, 0.06);
  // Centred on the scaled centre (512, 230).
  assert.ok(Math.abs(patch.textBoxPosition.x - (512 - 106) / 1000) < 1e-9);
  assert.ok(Math.abs(patch.textBoxPosition.y - (230 - 30) / 1000) < 1e-9);
  assert.deepEqual(patch.style, { fontSize: 24, bold: true });
});

test('a callout from a side keeps its font and only gets wider', () => {
  const orig = {
    tip: { x: 100, y: 200 }, knee: { x: 150, y: 150 },
    box: { left: 200, top: 100, width: 100, height: 30 }, fontSize: 12,
  };
  const patch = scaleCalloutForGroup(orig, about0(1.5, 1), 1.5, 1, 'mr', { width: 1000, height: 1000 }, 6);
  assert.equal(patch.style, undefined);
  assert.equal(patch.textBoxWidth, 0.15);
  assert.equal(patch.textBoxHeight, 0.03);
});

test('a Survey Marker box scales like a rectangle (swapped when sideways)', () => {
  assert.deepEqual(
    scaleMarkerBoundsForGroup({ x: 10, y: 20, width: 30, height: 40, angle: 0 }, about0(2, 1), 2, 1),
    { x: 20, y: 20, width: 60, height: 40, angle: 0 },
  );
  const turned = scaleMarkerBoundsForGroup({ x: 0, y: 0, width: 30, height: 10, angle: 90 }, about0(2, 1), 2, 1);
  assert.equal(turned.width, 30, 'its own width lies along the page y axis');
  assert.equal(turned.height, 20);
  assert.equal(turned.x + turned.width / 2, 30, 'centre moved with the frame');
});

test('a group resize writes each Survey Marker box in the same save', async () => {
  const { resizeSurveyMarkerRecord } = await import('../src/utils/surveyMarkerFamily.js');
  const record = { id: 'm1', name: 'Door', bounds: { x: 1, y: 2, width: 3, height: 4, angle: 90 } };
  assert.deepEqual(resizeSurveyMarkerRecord(record, { x: 5, y: 6, width: 7, height: 8, angle: 0 }).bounds,
    { x: 5, y: 6, width: 7, height: 8, angle: 90 }, 'the angle stays');
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /if \(patch\.bounds && typeof patch\.bounds === 'object'\)/);
  const hook = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
  assert.match(hook, /surveyMarkerFamily: \{ bounds: Object\.fromEntries\(markerBoundsEntries\) \}/);
});

test('a turned Survey Marker sets the frame floor on the page axes', () => {
  const hook = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
  assert.match(hook, /markerResizeOriginals\)\.map\(\(bounds\) => \(isSideways\(bounds\.angle\)\s*\? \{ width: bounds\.height, height: bounds\.width \}/);
  // A 100 x 10 marker turned 90° is 10 wide on the page: x may only shrink to 0.4.
  const { minScaleX, minScaleY } = groupResizeMinimumScale([{ width: 10, height: 100 }]);
  assert.equal(minScaleX, 0.4);
  assert.equal(minScaleY, 0.04);
});
