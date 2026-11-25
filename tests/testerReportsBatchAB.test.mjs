// Outside tester (Grok) ship-test batches A and B, Nov 25 2026: hatch and
// Measurement on a group (#1639, #1629), pen type on drawn strokes (#1619),
// the depth card (#1638), Shift+S (#1637), Insert image (#1633).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFreehandCommitJSON, buildLineCommitJSON } from '../src/utils/annotationCreationCommit.js';
import {
  applyRestyleChange,
  applyRestyleChangeToPage,
  inkPenTypeOf,
  rebuildInkAsPenType,
} from '../src/utils/selectionRestyle.js';
import { applyHatch, hatchPatternOf } from '../src/utils/hatchFill.js';
import { applyMeasureEdit, scaleFromPreset, stampMeasure } from '../src/utils/measure/measureScale.js';
import { planSelectionQuickBar } from '../src/utils/selectionQuickBar.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const QUARTER = scaleFromPreset('1/4');

const wave = (dy = 100) => Array.from({ length: 80 }, (_, i) => {
  const u = i / 79;
  return { x: 60 + u * 300, y: dy + Math.sin(u * Math.PI * 2) * 40, t: i * 16 };
});
const pen = (penType, id = `pen-${penType}`) => buildFreehandCommitJSON({
  tool: 'pen', id, points: wave(), strokeColor: '#112233', strokeWidth: 4, penType,
});
const length = (id) => stampMeasure(buildLineCommitJSON({
  tool: 'line', id, start: { x: 100, y: 100 }, end: { x: 460, y: 100 }, strokeColor: '#000', strokeOpacity: 100, strokeWidth: 2,
}), 'length', QUARTER);

test('#1619: a drawn Pen stroke can become another pen, keeping its line, colour and width', () => {
  const basic = pen('basic');
  assert.equal(inkPenTypeOf(basic), 'basic');
  const calligraphy = rebuildInkAsPenType(basic, 'calligraphy');
  assert.ok(calligraphy, 'rebuilt');
  assert.equal(inkPenTypeOf(calligraphy), 'calligraphy');
  assert.equal(calligraphy.data.penType, 'calligraphy');
  assert.equal(calligraphy.data.penWidths.length, basic.paperCenterline.length);
  assert.deepEqual(calligraphy.paperCenterline, basic.paperCenterline);
  assert.equal(calligraphy.fill, basic.fill);
  assert.equal(calligraphy.sourceWidth, basic.sourceWidth);
  assert.notDeepEqual(calligraphy.path, basic.path);
  // And back to Basic: the width factors go.
  const back = rebuildInkAsPenType(calligraphy, 'basic');
  assert.equal(inkPenTypeOf(back), 'basic');
  assert.equal('penWidths' in back.data, false);
  assert.equal('penType' in back.data, false);
  // Same type, a highlighter, or no type: nothing to write.
  assert.equal(rebuildInkAsPenType(basic, 'basic'), null);
  assert.equal(rebuildInkAsPenType(basic, 'marker'), null);
  const highlight = buildFreehandCommitJSON({ tool: 'highlighter', id: 'hl', points: wave(), highlightColor: '#ffff00', strokeWidth: 8 });
  assert.equal(inkPenTypeOf(highlight), null);
  assert.equal(rebuildInkAsPenType(highlight, 'pro'), null);
  // The group write: one change kind for the whole pick.
  assert.equal(inkPenTypeOf(applyRestyleChange(pen('pro'), { kind: 'penType', type: 'basic' })), 'basic');
});

test('#1639: a hatch pattern lands on every shape of a group, and only on shapes', () => {
  const shapes = [
    { type: 'rect', left: 0, top: 0, width: 40, height: 30, data: { id: 'a' } },
    { type: 'ellipse', left: 50, top: 0, rx: 20, ry: 10, data: { id: 'b' } },
    { type: 'path', path: [['M', 0, 0], ['L', 10, 10]], data: { id: 'c' } },
  ];
  const page = { objects: shapes };
  const next = applyRestyleChangeToPage(page, [{ index: 0 }, { index: 1 }, { index: 2 }], { kind: 'apply', apply: (obj) => applyHatch(obj, 'grid') });
  assert.equal(hatchPatternOf(next.objects[0]), 'grid');
  assert.equal(hatchPatternOf(next.objects[1]), 'grid');
  assert.equal(next.objects[2], shapes[2], 'a pen line is left as it was');
  // A change that changes nothing writes nothing (no empty undo step).
  assert.equal(applyRestyleChangeToPage(page, [{ index: 2 }], { kind: 'apply', apply: (obj) => applyHatch(obj, 'grid') }), null);
});

test('#1629: the Measurement popover edits every picked measurement', () => {
  const a = length('m1');
  const b = length('m2');
  const page = { objects: [a, b] };
  const next = applyRestyleChangeToPage(page, [{ index: 0 }, { index: 1 }], { kind: 'apply', apply: (obj) => applyMeasureEdit(obj, { label: 'Wall' }) });
  assert.equal(next.objects[0].data.measure.label, 'Wall');
  assert.equal(next.objects[1].data.measure.label, 'Wall');
  // The bar keeps Measurement for a group of measurements PDFViewer publishes.
  const api = { selectedMeasure: { id: 'group', ids: ['m1', 'm2'], mark: a, scale: QUARTER, group: true }, patchSelectedMeasure: () => {} };
  const two = [{ id: 'm1', typeKey: 'line' }, { id: 'm2', typeKey: 'line' }];
  assert.equal(planSelectionQuickBar({ items: two, api }).measure, true);
  assert.equal(planSelectionQuickBar({ items: [...two, { id: 'r', typeKey: 'rect' }], api }).measure, undefined);
  assert.equal(planSelectionQuickBar({ items: two, api, locked: true }).measure, undefined);
  // PDFViewer publishes the group's measure and hatch, and writes them as one group edit.
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /selectedMeasure: groupMeasure \|\|/);
  assert.match(viewer, /selectedHatch: hatchFillEnabled \? \(groupSummary \? groupHatch : selectedHatchForPanel\)/);
  assert.match(viewer, /applyRestyleToGroup\(\{ kind: 'apply', apply: \(obj\) => applyMeasureEdit\(obj, changes\) \}\)/);
  assert.match(viewer, /applyRestyleToGroup\(\{ kind: 'penType', type \}\)/);
});

test('#1638: a press beside the depth card keeps it open', () => {
  const src = read('src/components/MeasureDepthDialog.jsx');
  assert.doesNotMatch(src, /e\.target === e\.currentTarget\) onCancel\(\)/);
  assert.match(src, /e\.preventDefault\(\);\s*e\.stopPropagation\(\);/);
});

test('#1637: Shift+S flips Marks and Drawing together, so the toast and the card agree', () => {
  const src = read('src/components/SnappingToggle.jsx');
  assert.match(src, /writeAnnotationSnapping\(!anyOn\);\s*if \(withDrawing\) writeSnapContent\(!anyOn\);/);
});

test('#1633: a picked picture follows the pointer and lands at the click', () => {
  const src = read('src/components/InsertImage.jsx');
  assert.match(src, /if \(canAim\(\)\) armImageFile\(file\);\s*else insertImageFile\(file\);/);
  assert.match(src, /armLibraryItem\(item\);/);
});
