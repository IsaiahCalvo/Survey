import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Pure leftover math + source wiring for callout text-box resize leftovers:
//   1. flip past the opposite corner (was Node-only on the grow hunt)
//   2. resize-into-knee invalid-drop rollback (release-time, not mid-drag)
// Live proof: debug/scenarios/e2e-callout-textbox-resize-leftovers.spec.mjs
// Grow / min-clamp / undo / zoom / second-callout is calloutTextBoxResize.test.mjs.

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
  return {
    textBoxPosition: { x: Math.min(anchorX, mvX), y: Math.min(anchorY, mvY) },
    textBoxWidth: Math.max(minW, Math.max(anchorX, mvX) - Math.min(anchorX, mvX)),
    textBoxHeight: Math.max(minH, Math.max(anchorY, mvY) - Math.min(anchorY, mvY)),
  };
}

function dropSafeResize({
  box, knee, arrow, descBuffer, minHandleToBox, minHandleToHandle,
}) {
  const l = box.x;
  const t = box.y;
  const r = box.x + box.w;
  const b = box.y + box.h + descBuffer;
  const inside = (p) => p.x >= l && p.x <= r && p.y >= t && p.y <= b;
  const dRect = (p) => {
    const dx = Math.max(0, Math.max(l - p.x, p.x - r));
    const dy = Math.max(0, Math.max(t - p.y, p.y - b));
    return Math.hypot(dx, dy);
  };
  const corners = [
    { x: l, y: t }, { x: r, y: t }, { x: l, y: b }, { x: r, y: b },
  ];
  const clears = (p) => corners.every((c) => Math.hypot(p.x - c.x, p.y - c.y) >= minHandleToHandle);
  return !inside(knee)
    && !inside(arrow)
    && dRect(knee) >= minHandleToBox
    && dRect(arrow) >= minHandleToBox
    && Math.hypot(knee.x - arrow.x, knee.y - arrow.y) >= minHandleToHandle
    && clears(knee)
    && clears(arrow);
}

test('flip past opposite: min/max remaps the box; 20px floor still holds', () => {
  const W = 612;
  const H = 792;
  const orig = { origLeft: 0.40, origTop: 0.50, origW: 120 / W, origH: 32 / H, W, H };
  const minW = 20 / W;
  const minH = 20 / H;

  const flipBrLeft = resizeCorner({
    ...orig, corner: 'br', dxNorm: -(orig.origW + 40 / W), dyNorm: 0,
  });
  assert.ok(flipBrLeft.textBoxPosition.x < orig.origLeft, 'br past left flips left');
  assert.ok(Math.abs((flipBrLeft.textBoxPosition.x + flipBrLeft.textBoxWidth) - orig.origLeft) < 1e-9, 'br flip keeps old left as right');
  assert.ok(flipBrLeft.textBoxWidth + 1e-12 >= minW);

  const flipTlPastBr = resizeCorner({
    ...orig, corner: 'tl', dxNorm: orig.origW + 48 / W, dyNorm: orig.origH + 24 / H,
  });
  assert.ok(Math.abs(flipTlPastBr.textBoxPosition.x - (orig.origLeft + orig.origW)) < 1e-9, 'tl past br parks left on old right');
  assert.ok(Math.abs(flipTlPastBr.textBoxPosition.y - (orig.origTop + orig.origH)) < 1e-9, 'tl past br parks top on old bottom');
  assert.ok(flipTlPastBr.textBoxWidth + 1e-12 >= minW);
  assert.ok(flipTlPastBr.textBoxHeight + 1e-12 >= minH);

  const flipTrPastBl = resizeCorner({
    ...orig, corner: 'tr', dxNorm: -(orig.origW + 36 / W), dyNorm: orig.origH + 20 / H,
  });
  assert.ok(flipTrPastBl.textBoxPosition.x < orig.origLeft, 'tr past left flips left');
  assert.ok(Math.abs((flipTrPastBl.textBoxPosition.y) - (orig.origTop + orig.origH)) < 1e-9
    || flipTrPastBl.textBoxPosition.y > orig.origTop, 'tr past bottom parks below');
});

test('resize-into-knee is not dropSafe; rollback restores pre-drag width/height', () => {
  const orig = { x: 200, y: 300, w: 120, h: 32 };
  const knee = { x: 160, y: 270 };
  const arrow = { x: 80, y: 180 };
  const rules = { descBuffer: 12 * 0.35, minHandleToBox: 5.5, minHandleToHandle: 11 };

  assert.equal(dropSafeResize({ box: orig, knee, arrow, ...rules }), true, 'default create is safe');

  const grownOverKnee = { x: 140, y: 250, w: 180, h: 82 };
  assert.equal(dropSafeResize({ box: grownOverKnee, knee, arrow, ...rules }), false, 'box over knee is invalid');

  const flippedAway = { x: 320, y: 332, w: 48, h: 24 };
  assert.equal(dropSafeResize({ box: flippedAway, knee, arrow, ...rules }), true, 'flip away from knee stays valid');

  const rollback = {
    textBoxPosition: { x: orig.x, y: orig.y },
    textBoxWidth: orig.w,
    textBoxHeight: orig.h,
    knee,
  };
  assert.equal(rollback.textBoxWidth, orig.w);
  assert.equal(rollback.textBoxHeight, orig.h);
  assert.equal(rollback.knee.x, knee.x);
});

test('SVG + hook: flip math + release-time resize rollback; no mid-drag pin', () => {
  const hook = read('src/hooks/useSVGInteraction.js');
  const layer = read('src/components/SVGAnnotationLayer.jsx');

  assert.match(layer, /id: 'tl'/);
  assert.match(layer, /id: 'br'/);
  assert.ok(layer.includes('viewBox={`0 0 ${width} ${height}`}'));

  assert.match(hook, /const newLeft = Math\.min\(anchorX, mvX\)/);
  assert.match(hook, /const newTop = Math\.min\(anchorY, mvY\)/);
  assert.match(hook, /const newRight = Math\.max\(anchorX, mvX\)/);
  assert.match(hook, /const newBottom = Math\.max\(anchorY, mvY\)/);

  const resizeIdx = hook.indexOf("case 'textBoxResize'");
  assert.ok(resizeIdx > 0, 'textBoxResize case exists');
  const resizeEnd = hook.indexOf('default:', resizeIdx);
  const resizeSlice = hook.slice(resizeIdx, resizeEnd > resizeIdx ? resizeEnd : resizeIdx + 4000);
  assert.match(resizeSlice, /setInteractionState\('dragging'\)/);
  assert.match(resizeSlice, /return;/);
  assert.doesNotMatch(resizeSlice, /lastSafeCalloutPositions/);

  assert.match(hook, /ds\.partType === 'knee' \|\| ds\.partType === 'textBox' \|\| ds\.partType === 'textBoxResize'/);
  assert.match(hook, /textBoxWidth: original\.textBoxWidth/);
  assert.match(hook, /textBoxHeight: original\.textBoxHeight/);
  assert.match(hook, /invalid drop → return to/);
});
