import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveShapeToolPick, isShapeToolButtonActive } from '../src/utils/cloudShapeTool.js';
import {
  buildCloudPathCommands, buildCloudFillPathCommands, getCloudPathBounds, toolSupportsCloudBorderStyle,
} from '../src/utils/pdfAnnotationAppearance.js';

test('Cloud button arms the rectangle with the cloud line style', () => {
  assert.deepEqual(resolveShapeToolPick('cloud', 'solid'), { tool: 'rect', lineBorderStyle: 'cloud' });
  assert.deepEqual(resolveShapeToolPick('rect', 'cloud'), { tool: 'rect', lineBorderStyle: 'solid' });
  assert.deepEqual(resolveShapeToolPick('rect', 'dashed'), { tool: 'rect', lineBorderStyle: null });
  assert.deepEqual(resolveShapeToolPick('polygon', 'cloud'), { tool: 'polygon', lineBorderStyle: null });
  assert.equal(toolSupportsCloudBorderStyle('rect'), true);
  assert.equal(toolSupportsCloudBorderStyle('polygon'), true);
});

test('Cloud and Rectangle buttons are never pressed together', () => {
  assert.equal(isShapeToolButtonActive('cloud', 'rect', 'cloud'), true);
  assert.equal(isShapeToolButtonActive('rect', 'rect', 'cloud'), false);
  assert.equal(isShapeToolButtonActive('rect', 'rect', 'solid'), true);
  assert.equal(isShapeToolButtonActive('cloud', 'rect', 'solid'), false);
  assert.equal(isShapeToolButtonActive('cloud', 'polygon', 'cloud'), false);
  assert.equal(isShapeToolButtonActive('polygon', 'polygon', 'cloud'), true);
});

const rect = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }];

const curves = (cmds) => cmds.filter((c) => c[0] === 'C').length;

test('rect cloud outline is scalloped arcs hugging the box', () => {
  const cmds = buildCloudPathCommands(rect, 2, 2, 1, 'rect');
  assert.ok(Array.isArray(cmds) && cmds.length > 0);
  const n = curves(cmds);
  assert.ok(n >= 12, `expected many arc curves, got ${n}`);
  assert.equal(cmds.filter((c) => c[0] === 'L').length <= n, true);
  const b = getCloudPathBounds(cmds);
  // Bumps bulge outward a little, never far, and cover the whole box.
  assert.ok(b.minX <= 0 && b.minY <= 0 && b.maxX >= 200 && b.maxY >= 100);
  assert.ok(b.minX > -40 && b.minY > -40 && b.maxX < 240 && b.maxY < 140);
});

test('bigger intensity means fewer, larger scallops', () => {
  const small = curves(buildCloudPathCommands(rect, 1, 2, 1, 'rect'));
  const big = curves(buildCloudPathCommands(rect, 3, 2, 1, 'rect'));
  assert.ok(big < small, `${big} < ${small}`);
});

test('polygon cloud and closed fill region build; bad points reject', () => {
  const tri = [{ x: 0, y: 0 }, { x: 120, y: 10 }, { x: 60, y: 90 }];
  assert.ok(curves(buildCloudPathCommands(tri, 2, 2, 1, 'polygon')) > 3);
  const fill = buildCloudFillPathCommands(rect, 2, 2, 1, 'rect');
  assert.ok(Array.isArray(fill) && fill.some((c) => c[0] === 'Z'));
  assert.equal(buildCloudPathCommands([{ x: 0, y: 0 }, { x: NaN, y: 1 }, { x: 2, y: 2 }], 2, 2, 1, 'polygon'), null);
});
