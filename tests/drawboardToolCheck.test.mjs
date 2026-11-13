// Drawboard PDF Pro tool check (owner 2026-11-13: "nothing can be missing,
// and your icons have to be nice too").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURE_FLAGS } from '../src/featureFlags.js';
import { TOOL_GROUP_BY_TOOL } from '../src/utils/markToolGroup.js';
import { resolveToolBarGroup } from '../src/utils/toolbarRows.js';
import {
  addLaserPoint, laserGone, laserOpacity, laserPath, LASER_FADE_MS, LASER_HOLD_MS, LASER_MAX_POINTS,
} from '../src/utils/laserTrail.js';
import { liveDragPaint, textDragKindOf, TEXT_DRAG_KINDS } from '../src/hooks/useTextHighlightMode.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('new tools are Nightly-only beta flags with a seeded off row', () => {
  const migration = read('supabase/migrations/20261113190000_drawboard_tool_flags.sql');
  for (const key of ['text-markup-tools', 'laser-pointer']) {
    assert.equal(FEATURE_FLAGS[key]?.stage, 'beta', key);
    assert.match(migration, new RegExp(`\\('${key}', 'off'`), key);
  }
});

test('the laser is a Draw tool and leaves no mark', () => {
  assert.equal(TOOL_GROUP_BY_TOOL.laser, 'draw');
  assert.equal(resolveToolBarGroup({ activeTool: 'laser' }), 'draw');
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /<LaserPointerLayer active=\{isActive !== false && laserToolEnabled && activeTool === 'laser'\}/);
  assert.match(read('src/mobile/MobilePdfViewerChrome.jsx'), /\{ id: 'laser', label: 'Laser pointer', icon: 'laser', flag: 'laser-pointer' \}/);
  // The layer never touches the annotation store.
  const layer = read('src/components/LaserPointerLayer.jsx');
  assert.doesNotMatch(layer, /setAnnotations|commitAnnotation|pushHistory|saveAnnotations|annotationsByPage/);
});

test('laser points skip tiny steps and cap their length', () => {
  let points = addLaserPoint([], 10, 10);
  points = addLaserPoint(points, 10.5, 10.5);
  assert.equal(points.length, 1, 'sub-pixel jitter is skipped');
  points = addLaserPoint(points, 20, 10);
  assert.equal(points.length, 2);
  assert.equal(addLaserPoint(points, NaN, 3), points);
  let long = [];
  for (let i = 0; i < LASER_MAX_POINTS + 50; i += 1) long = addLaserPoint(long, i * 2, 0);
  assert.equal(long.length, LASER_MAX_POINTS);
  assert.equal(long[long.length - 1].x, (LASER_MAX_POINTS + 49) * 2, 'keeps the newest points');
});

test('laser path is a smooth curve through the points', () => {
  assert.equal(laserPath([]), '');
  assert.match(laserPath([{ x: 1, y: 2 }]), /^M1 2l/);
  const d = laserPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }]);
  assert.equal(d, 'M0 0Q10 0 15 5L20 10');
});

test('a finished laser stroke holds, then fades out', () => {
  assert.equal(laserOpacity(null, 99999), 1, 'still drawing');
  assert.equal(laserOpacity(1000, 1000 + LASER_HOLD_MS), 1);
  const mid = laserOpacity(1000, 1000 + LASER_HOLD_MS + LASER_FADE_MS / 2);
  assert.ok(mid > 0.4 && mid < 0.6, String(mid));
  assert.equal(laserOpacity(1000, 1000 + LASER_HOLD_MS + LASER_FADE_MS + 1), 0);
  assert.equal(laserGone(null, 1e9), false);
  assert.equal(laserGone(1000, 1000 + LASER_HOLD_MS + LASER_FADE_MS + 1), true);
});

test('text drag tools: each kind is one of the text marks', () => {
  assert.deepEqual([...TEXT_DRAG_KINDS], ['highlight', 'underline', 'squiggly', 'strikeout', 'redact']);
  assert.equal(textDragKindOf(false), null);
  assert.equal(textDragKindOf(true), 'highlight', 'the first highlight-only build stored true');
  assert.equal(textDragKindOf('underline'), 'underline');
  assert.equal(textDragKindOf('nope'), 'highlight');
  assert.match(liveDragPaint('highlight', { color: '#ff0000', opacity: 40 }), /rgba\(255, 0, 0, 0\.4\)/);
  assert.match(liveDragPaint('underline', { color: '#0000ff', opacity: 100 }), /rgba\(0, 0, 255, 0\.25\)/);
  assert.equal(liveDragPaint('redact'), 'rgba(0, 0, 0, 0.35)');
});

test('the Text row stays up while a drag-over-text tool is armed', () => {
  assert.equal(resolveToolBarGroup({ activeTool: 'text-select', textHighlightMode: true }), 'review');
  assert.equal(resolveToolBarGroup({ activeTool: 'text-select' }), 'select');
  const viewer = read('src/PDFViewer.jsx');
  for (const [label, kind] of [['Underline text', 'underline'], ['Squiggle text', 'squiggly'], ['Strike through text', 'strikeout'], ['Redact text', 'redact']]) {
    assert.match(viewer, new RegExp(`label: '${label}', iconName: '[a-zA-Z]+', highlightMode: '${kind}'`), label);
  }
});

test('tool icons: the new and replaced glyphs exist and the tools use them', () => {
  const icons = read('src/Icons.jsx');
  for (const name of ['tape', 'tapeMeasure', 'measureScale', 'measureLength', 'signature', 'snapshot', 'textHighlightTool',
    'textUnderlineTool', 'textSquiggleTool', 'textStrikeTool', 'textRedactTool', 'laser', 'stickyNote', 'measureAngle', 'equation', 'hatch']) {
    assert.match(icons, new RegExp(`\\n    ${name}: \\(size, color, style, className\\) =>`), name);
  }
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /\{ id: 'measure', measure: true, label: 'Measure', iconName: 'tapeMeasure' \}/);
  assert.match(viewer, /\{ id: 'snapshot', label: 'Snapshot', iconName: 'snapshot' \}/);
  assert.match(viewer, /\{ id: 'signature', label: 'Signature', iconName: 'signature', picker: 'signature' \}/);
  const phone = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(phone, /\{ id: 'measure', label: 'Measure', icon: 'tapeMeasure', measure: true \}/);
  assert.match(phone, /\{ id: 'signature', label: 'Signature', icon: 'signature'/);
});

test('Angle measure: three points, degrees at the middle one, no scale needed', async () => {
  const { buildMeasureLabel, measureAngleDegrees, formatMeasureAngle, measureBaseTool, MEASURE_KINDS, ANGLE_MEASURE_POINTS, getMeasureKind } = await import('../src/utils/measure/measureScale.js');
  assert.ok(MEASURE_KINDS.includes('angle'));
  assert.equal(measureBaseTool('angle'), 'polyline');
  assert.equal(ANGLE_MEASURE_POINTS, 3);
  assert.equal(measureAngleDegrees({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }), 90);
  assert.equal(Math.round(measureAngleDegrees({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: -1, y: 0.0001 })), 180);
  assert.equal(measureAngleDegrees({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }), null);
  assert.equal(formatMeasureAngle(56.31), '56.3°');
  const mark = { type: 'polyline', left: 0, top: 0, points: [{ x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 100 }], data: { measure: { kind: 'angle' } } };
  assert.equal(getMeasureKind(mark), 'angle');
  const label = buildMeasureLabel(mark, null);
  assert.equal(label.text, '90.0°');
  assert.ok(label.x > 0 && label.y > 0, 'the caption sits inside the corner');
  const { mobileMeasureItems } = await import('../src/mobile/mobileShapeRail.js');
  assert.deepEqual(mobileMeasureItems(false).map((m) => m.key), ['length', 'area', 'perimeter', 'scale']);
  assert.deepEqual(mobileMeasureItems(false, { angle: true }).map((m) => m.key), ['length', 'area', 'perimeter', 'angle', 'scale']);
  assert.equal(FEATURE_FLAGS['measure-angle']?.stage, 'beta');
  assert.match(read('src/components/SVGAnnotationLayer.jsx'), /measureMode === 'angle' && next\?\.points\?\.length >= ANGLE_MEASURE_POINTS\) commitPolyDraft\('finish'\)/);
});
