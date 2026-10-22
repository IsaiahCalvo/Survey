// Owner 2026-10-22: copy Photoshop's on-page brush drag (Alt + right-drag on
// Windows, Control + Option + drag on a Mac: sideways = size, up / down =
// opacity) and Visio's Ctrl + drag to copy. These pin the keys, the value
// mapping and the wiring that keeps each gesture from also doing something
// else (a stroke, the right-click menu, a move).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BRUSH_ADJUST_TOOLS,
  BRUSH_ADJUST_AXIS_LOCK_PX,
  BRUSH_ADJUST_DOUBLING_PX,
  isBrushAdjustPress,
  resolveBrushAdjust,
  formatBrushAdjustLabel,
} from '../src/utils/brushAdjustGesture.js';
import { isCopyDragEvent } from '../src/utils/moveModifier.js';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('brush drag: Alt + right button, or Ctrl + Alt + left button; never touch', () => {
  assert.equal(isBrushAdjustPress({ altKey: true, button: 2, pointerType: 'mouse' }), true);
  // A pen's barrel button reports as the right button.
  assert.equal(isBrushAdjustPress({ altKey: true, button: 2, pointerType: 'pen' }), true);
  // Mac: Control + Option + click.
  assert.equal(isBrushAdjustPress({ altKey: true, ctrlKey: true, button: 0, pointerType: 'mouse' }), true);
  assert.equal(isBrushAdjustPress({ altKey: false, button: 2, pointerType: 'mouse' }), false);
  assert.equal(isBrushAdjustPress({ altKey: true, button: 0, pointerType: 'mouse' }), false);
  assert.equal(isBrushAdjustPress({ ctrlKey: true, button: 0, pointerType: 'mouse' }), false);
  assert.equal(isBrushAdjustPress({ altKey: true, button: 2, pointerType: 'touch' }), false);
  assert.equal(isBrushAdjustPress(null), false);
});

test('brush drag: only tools that draw a stroke with a width', () => {
  for (const tool of ['pen', 'highlighter', 'line', 'arrow', 'rect', 'ellipse', 'polygon', 'polyline', 'eraser']) {
    assert.equal(BRUSH_ADJUST_TOOLS.has(tool), true, tool);
  }
  for (const tool of ['select', 'pan', 'text', 'callout', 'counter', 'survey-marker', 'text-highlight']) {
    assert.equal(BRUSH_ADJUST_TOOLS.has(tool), false, tool);
  }
});

test('brush drag: right = wider, left = thinner, every 120 px doubles or halves', () => {
  const start = { width: 4, opacity: 80 };
  assert.deepEqual(resolveBrushAdjust({ start, dx: 0, dy: 0 }), { width: 4, opacity: 80, axis: null });
  assert.equal(resolveBrushAdjust({ start, dx: BRUSH_ADJUST_DOUBLING_PX }).width, 8);
  assert.equal(resolveBrushAdjust({ start, dx: -BRUSH_ADJUST_DOUBLING_PX }).width, 2);
  // Half points under 10, whole points above.
  assert.equal(resolveBrushAdjust({ start: { width: 2, opacity: 100 }, dx: 40 }).width, 2.5);
  assert.equal(resolveBrushAdjust({ start: { width: 12, opacity: 100 }, dx: 20 }).width, 13);
  // Clamped to the field's range.
  assert.equal(resolveBrushAdjust({ start, dx: 2000 }).width, 50);
  assert.equal(resolveBrushAdjust({ start, dx: -2000 }).width, 1);
  // The eraser keeps whole sizes up to 100.
  assert.equal(resolveBrushAdjust({ start: { width: 20 }, dx: 2000, limits: { maxWidth: 100, decimals: 0 } }).width, 100);
  assert.equal(Number.isInteger(resolveBrushAdjust({ start: { width: 3 }, dx: 30, limits: { maxWidth: 100, decimals: 0 } }).width), true);
});

test('brush drag: up = more solid, down = more see-through, never below 5 %', () => {
  const start = { width: 4, opacity: 60 };
  assert.equal(resolveBrushAdjust({ start, dy: -40 }).opacity, 80);
  assert.equal(resolveBrushAdjust({ start, dy: 40 }).opacity, 40);
  assert.equal(resolveBrushAdjust({ start, dy: -500 }).opacity, 100);
  assert.equal(resolveBrushAdjust({ start, dy: 500 }).opacity, 5);
  // The eraser has no opacity: a vertical drag changes nothing.
  const eraser = resolveBrushAdjust({ start: { width: 20 }, dy: 80, limits: { opacity: false, maxWidth: 100, decimals: 0 } });
  assert.equal(eraser.width, 20);
  assert.equal(eraser.axis, 'width');
});

test('brush drag: the first clear direction locks the drag to one setting', () => {
  const start = { width: 4, opacity: 60 };
  // Under the lock distance nothing is chosen yet.
  assert.equal(resolveBrushAdjust({ start, dx: BRUSH_ADJUST_AXIS_LOCK_PX - 1 }).axis, null);
  const sideways = resolveBrushAdjust({ start, dx: 10, dy: 2 });
  assert.equal(sideways.axis, 'width');
  // Drifting up later still leaves the opacity alone.
  const drift = resolveBrushAdjust({ start, dx: 60, dy: -60, axis: sideways.axis });
  assert.equal(drift.opacity, 60);
  assert.notEqual(drift.width, 4);
  const vertical = resolveBrushAdjust({ start, dx: 1, dy: -10 });
  assert.equal(vertical.axis, 'opacity');
  assert.equal(resolveBrushAdjust({ start, dx: 200, dy: -10, axis: 'opacity' }).width, 4);
});

test('brush drag: the readout under the dot', () => {
  assert.equal(formatBrushAdjustLabel({ width: 4.5, opacity: 80 }), 'Width 4.5 pt · Opacity 80%');
  assert.equal(formatBrushAdjustLabel({ width: 24, opacity: 100, eraser: true }), 'Size 24 pt');
});

test('brush drag: installed in the capture phase and sets values through the toolbar handlers', () => {
  const gesture = read('src/utils/brushAdjustGesture.js');
  assert.match(gesture, /addEventListener\('pointerdown', onPointerDown, capture\)/);
  assert.match(gesture, /addEventListener\('contextmenu', onContextMenu, capture\)/);
  assert.match(gesture, /stopImmediatePropagation\(\)/);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /useBrushAdjustGesture\(\{[\s\S]{0,400}enabled: isActive !== false && activeTool === pickBarTool/);
  assert.match(viewer, /handleStrokeWidthInputBlur : handleStrokeWidthInputBlur|activeTool === 'eraser' \? handleEraserSizeInputBlur : handleStrokeWidthInputBlur/);
  assert.match(viewer, /if \(opacity != null\) handleStrokeOpacityChange\(opacity\)/);
});

test('copy-drag: the move key (Cmd on a Mac, Ctrl elsewhere) at let-go copies; touch never', () => {
  assert.equal(isCopyDragEvent({ ctrlKey: true, pointerType: 'mouse' }, false), true);
  assert.equal(isCopyDragEvent({ metaKey: true, pointerType: 'mouse' }, true), true);
  // Mac Control+click is the right-click menu; Windows AltGr is Ctrl+Alt.
  assert.equal(isCopyDragEvent({ ctrlKey: true, pointerType: 'mouse' }, true), false);
  assert.equal(isCopyDragEvent({ ctrlKey: true, altKey: true, pointerType: 'mouse' }, false), false);
  assert.equal(isCopyDragEvent({ ctrlKey: true, pointerType: 'touch' }, false), false);
  assert.equal(isCopyDragEvent({ ctrlKey: false, pointerType: 'pen' }, false), false);
});

test('copy-drag: a drop with the key down pastes copies and leaves the originals', () => {
  const hook = read('src/hooks/useSVGInteraction.js');
  // The key at let-go decides, and a copy never carries marks onto another page.
  assert.match(hook, /const copyDrop = \(ds\.mode === 'move' \|\| ds\.mode === 'group-move'\)/);
  assert.match(hook, /const crossPageDropped = !copyDrop &&/);
  assert.match(hook, /onCopyDragDropRef\.current\(\{ indices: \[moveIndex\] \}, actualDx, actualDy\)/);
  assert.match(hook, /if \(!groupCopied && \(dx !== 0 \|\| dy !== 0\)\) \{/);
  // Ctrl + drag on a mark that is not picked yet copies it too (Visio),
  // instead of Drawboard rule 3's box select.
  assert.match(hook, /!\(onCopyDragDrop && isCopyDragEvent\(e\)\)/);
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /onDuplicateFamily\(pageNumber, selection, \{ dx, dy \}\)/);
  assert.match(layer, /data-copy-drag-original="true"/);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const duplicateFamilySelection = useCallback\(\(pageNumber, selection, offset = null\)/);
});
