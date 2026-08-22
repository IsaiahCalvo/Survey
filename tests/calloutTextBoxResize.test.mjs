import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Pure resize math + source wiring for callout text-box corner resize.
// Live proof: debug/scenarios/e2e-callout-textbox-resize.spec.mjs
// Knee / leader / arrowTip / text-box *move* is calloutKneeDrag.test.mjs.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function resizeCorner({
  corner, origLeft, origTop, origW, origH, dxNorm, dyNorm, W, H,
}) {
  const origRight = origLeft + origW;
  const origBottom = origTop + origH;
  let anchorX;
  let anchorY;
  if (corner === 'tl') { anchorX = origRight; anchorY = origBottom; }
  else if (corner === 'tr') { anchorX = origLeft; anchorY = origBottom; }
  else if (corner === 'bl') { anchorX = origRight; anchorY = origTop; }
  else { anchorX = origLeft; anchorY = origTop; }
  let mvX;
  let mvY;
  if (corner === 'tl') { mvX = origLeft + dxNorm; mvY = origTop + dyNorm; }
  else if (corner === 'tr') { mvX = origRight + dxNorm; mvY = origTop + dyNorm; }
  else if (corner === 'bl') { mvX = origLeft + dxNorm; mvY = origBottom + dyNorm; }
  else { mvX = origRight + dxNorm; mvY = origBottom + dyNorm; }
  const minW = 20 / W;
  const minH = 20 / H;
  const newLeft = Math.min(anchorX, mvX);
  const newTop = Math.min(anchorY, mvY);
  const newRight = Math.max(anchorX, mvX);
  const newBottom = Math.max(anchorY, mvY);
  return {
    textBoxPosition: { x: newLeft, y: newTop },
    textBoxWidth: Math.max(minW, newRight - newLeft),
    textBoxHeight: Math.max(minH, newBottom - newTop),
  };
}

test('four corners: opposite anchor stays; 20px min clamp; flip past opposite', () => {
  const W = 612;
  const H = 792;
  const orig = { origLeft: 0.40, origTop: 0.50, origW: 120 / W, origH: 32 / H, W, H };
  const minW = 20 / W;
  const minH = 20 / H;

  const br = resizeCorner({ ...orig, corner: 'br', dxNorm: 30 / W, dyNorm: 20 / H });
  assert.ok(Math.abs(br.textBoxPosition.x - orig.origLeft) < 1e-9, 'br keeps left');
  assert.ok(Math.abs(br.textBoxPosition.y - orig.origTop) < 1e-9, 'br keeps top');
  assert.ok(br.textBoxWidth > orig.origW);
  assert.ok(br.textBoxHeight > orig.origH);

  const tl = resizeCorner({ ...orig, corner: 'tl', dxNorm: -24 / W, dyNorm: -16 / H });
  assert.ok(Math.abs((tl.textBoxPosition.x + tl.textBoxWidth) - (orig.origLeft + orig.origW)) < 1e-9, 'tl keeps right');
  assert.ok(Math.abs((tl.textBoxPosition.y + tl.textBoxHeight) - (orig.origTop + orig.origH)) < 1e-9, 'tl keeps bottom');

  const tr = resizeCorner({ ...orig, corner: 'tr', dxNorm: 18 / W, dyNorm: -12 / H });
  assert.ok(Math.abs(tr.textBoxPosition.x - orig.origLeft) < 1e-9, 'tr keeps left');
  assert.ok(Math.abs((tr.textBoxPosition.y + tr.textBoxHeight) - (orig.origTop + orig.origH)) < 1e-9, 'tr keeps bottom');

  const bl = resizeCorner({ ...orig, corner: 'bl', dxNorm: -18 / W, dyNorm: 12 / H });
  assert.ok(Math.abs((bl.textBoxPosition.x + bl.textBoxWidth) - (orig.origLeft + orig.origW)) < 1e-9, 'bl keeps right');
  assert.ok(Math.abs(bl.textBoxPosition.y - orig.origTop) < 1e-9, 'bl keeps top');

  // Same-side inward leftover of 8px — below the 20px floor, no flip.
  const clamp = resizeCorner({
    ...orig, corner: 'br', dxNorm: -(orig.origW - 8 / W), dyNorm: -(orig.origH - 8 / H),
  });
  assert.ok(Math.abs(clamp.textBoxWidth - minW) < 1e-9, 'width floors at 20/W');
  assert.ok(Math.abs(clamp.textBoxHeight - minH) < 1e-9, 'height floors at 20/H');
  assert.ok(Math.abs(clamp.textBoxPosition.x - orig.origLeft) < 1e-9, 'clamp keeps left');
  assert.ok(Math.abs(clamp.textBoxPosition.y - orig.origTop) < 1e-9, 'clamp keeps top');

  const flip = resizeCorner({ ...orig, corner: 'br', dxNorm: -(orig.origW + 40 / W), dyNorm: 0 });
  assert.ok(flip.textBoxPosition.x < orig.origLeft, 'drag past opposite flips left');
  assert.ok(flip.textBoxWidth + 1e-12 >= minW);
});

test('SVG + interaction wire textBox-tl/tr/bl/br to textBoxResize; Pen intercepts', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const hook = read('src/hooks/useSVGInteraction.js');

  assert.match(layer, /data-callout-part=\{`textBox-\$\{p\.id\}`\}/);
  assert.match(layer, /id: 'tl'/);
  assert.match(layer, /id: 'tr'/);
  assert.match(layer, /id: 'bl'/);
  assert.match(layer, /id: 'br'/);
  assert.ok(layer.includes('viewBox={`0 0 ${width} ${height}`}'));

  assert.match(hook, /partType && partType\.startsWith\('textBox-'\)/);
  assert.match(hook, /partType = 'textBoxResize'/);
  assert.match(hook, /case 'textBoxResize':/);
  assert.match(hook, /const minW = 20 \/ W/);
  assert.match(hook, /const minH = 20 \/ H/);
  assert.match(hook, /const newWidth = Math\.max\(minW, newRight - newLeft\)/);
  assert.match(hook, /const newHeight = Math\.max\(minH, newBottom - newTop\)/);
  assert.match(hook, /if \(corner === 'tl'\) \{ anchorX = origRight; {2}anchorY = origBottom; \}/);
  assert.match(hook, /textBoxWidth: original\.textBoxWidth/);
  assert.match(hook, /dxNorm = dxPage \/ W/);

  const penIdx = layer.indexOf('if ((isShapeCreationTool || isFreehandCreationTool)');
  const svgDownIdx = layer.lastIndexOf('handleSvgPointerDown(e)');
  assert.ok(penIdx > 0 && svgDownIdx > penIdx, 'Pen intercepts before callout-part drag');
});
