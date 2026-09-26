// w42 (2026-09-26): the narrow desktop tool bar — the order it gives ground in
// (src/utils/responsiveToolbar.js) and the popover placement maths that keeps
// the colour pickers under their opener and inside the window.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CENTERED_MIN_WIDTH,
  COMPACT_ORDER,
  EDGE_CLEARANCE,
  LOOSE_SPACING,
  MORE_BUTTON_WIDTH,
  OVERFLOW_ORDER,
  TIGHT_SPACING,
  computeAnchoredPopoverPosition,
  planToolbarLayout,
  rowWidth,
} from '../src/utils/responsiveToolbar.js';

// The bar as measured in the live app (2026-09-26): Redo ends at 72, Export is
// 28px wide and 10px from the right edge, Draw/Shapes/Text are 96px, Pan/Select
// with its rule 79px.
const bar = (barWidth) => ({
  barWidth,
  undoRight: 72,
  exportLeft: barWidth - 38,
  clusterWidth: 96,
  leftBlockWidth: 79,
});
const slot = (id, full, compact = 44, canCompact = true) => ({
  kind: 'item', slot: id, widths: { full, compact }, canCompact,
});
const divider = { kind: 'divider' };
const colours = { kind: 'item', width: 100 };
// The Arrow tool's row: rule, colours, rule, width, style, arrowhead, ends.
const arrowRow = () => [
  divider, colours, divider,
  slot('width', 72, 56), slot('style', 92, 47), slot('arrowhead', 90, 44), slot('ends', 96, 44),
];
// The pen's row: rule, colours, rule, width.
const penRow = () => [divider, colours, divider, slot('width', 72, 56)];

test('a rule costs 1px plus its inset each side; neighbouring controls cost one gutter', () => {
  assert.equal(rowWidth([divider], LOOSE_SPACING), 17);
  assert.equal(rowWidth([{ kind: 'item', width: 10 }, { kind: 'item', width: 20 }], LOOSE_SPACING), 36);
  // The Arrow row measured 502px wide in the live bar.
  const items = arrowRow().map((e) => (e.slot ? { kind: 'item', width: e.widths.full } : e));
  assert.equal(rowWidth(items, LOOSE_SPACING), 502);
  assert.ok(rowWidth(items, TIGHT_SPACING) < 502);
});

test('normal widths keep the bar exactly as it was: centred, full, nothing moved', () => {
  for (const width of [1440, 1280, CENTERED_MIN_WIDTH]) {
    for (const row of [arrowRow(), penRow()]) {
      const plan = planToolbarLayout({ ...bar(width), row });
      assert.deepEqual(plan, { anchor: 'center', shift: 0, tight: false, compact: [], overflow: [], fits: true }, `@${width}`);
    }
  }
});

test('below the centring width the icons sit left for EVERY tool, at the same spot', () => {
  for (const width of [1199, 1024, 840, 760, 721]) {
    const pen = planToolbarLayout({ ...bar(width), row: penRow() });
    const arrow = planToolbarLayout({ ...bar(width), row: arrowRow() });
    assert.equal(pen.anchor, 'start');
    assert.equal(arrow.anchor, 'start');
    // Switching tools never moves an icon.
    assert.equal(pen.shift, arrow.shift, `@${width}`);
  }
});

test('the bar gives ground in order: gutters, then labels (least useful first), then More', () => {
  // 1024 and 840: the Arrow row fits once the icons sit left.
  assert.deepEqual(planToolbarLayout({ ...bar(840), row: arrowRow() }), {
    anchor: 'start', shift: planToolbarLayout({ ...bar(840), row: arrowRow() }).shift,
    tight: false, compact: [], overflow: [], fits: true,
  });
  // 760: tighter gutters, then Arrow ends shows just its drawing.
  const at760 = planToolbarLayout({ ...bar(760), row: arrowRow() });
  assert.equal(at760.tight, true);
  assert.deepEqual(at760.compact, ['ends']);
  assert.deepEqual(at760.overflow, []);
  // 721 (the last desktop width): the line style collapses too.
  const at721 = planToolbarLayout({ ...bar(721), row: arrowRow() });
  assert.deepEqual(at721.compact, ['ends', 'style']);
  assert.deepEqual(at721.overflow, []);
});

test('labels collapse least-useful first and the width is the last to collapse', () => {
  assert.deepEqual(COMPACT_ORDER, ['ends', 'blend', 'style', 'arrowhead', 'width']);
});

test('settings move into More least-important first; the width is the last to go', () => {
  assert.deepEqual(OVERFLOW_ORDER, ['bump', 'start', 'ends', 'blend', 'style', 'aa', 'arrowhead', 'series', 'width']);
});

test('a pill reading "Mixed" never collapses; it moves into More instead', () => {
  const row = [
    divider, colours, divider,
    slot('width', 72, 56), slot('style', 92, 47, false), slot('arrowhead', 90, 44, false), slot('ends', 96, 44, false),
  ];
  const plan = planToolbarLayout({ ...bar(721), row });
  assert.ok(!plan.compact.includes('style'));
  assert.ok(!plan.compact.includes('arrowhead'));
  assert.ok(!plan.compact.includes('ends'));
  assert.deepEqual(plan.overflow, ['ends']);
  assert.equal(plan.fits, true);
});

test('More takes settings in priority order and counts its own button', () => {
  // Pills far wider than today's, so More has to take several.
  const row = [
    divider, colours, divider,
    slot('width', 150, 120), slot('style', 170, 150, false), slot('bump', 70, 70, false),
    slot('arrowhead', 170, 150, false), slot('ends', 170, 150, false),
    { kind: 'divider', slot: 'aa' }, slot('aa', 29, 29, false),
  ];
  const plan = planToolbarLayout({ ...bar(840), row });
  // bump, then ends, then style... in OVERFLOW_ORDER, never skipping one.
  const expected = OVERFLOW_ORDER.filter((id) => row.some((e) => e.slot === id)).slice(0, plan.overflow.length);
  assert.deepEqual(plan.overflow, expected);
  assert.ok(plan.overflow.length >= 2);
  assert.equal(plan.fits, true);
  // The chosen row, with More's own button, fits between the icons and Export.
  const kept = row.filter((e) => !(e.slot && plan.overflow.includes(e.slot)))
    .map((e) => (e.slot && e.kind === 'item'
      ? { kind: 'item', width: plan.compact.includes(e.slot) ? e.widths.compact : e.widths.full }
      : e));
  kept.push({ kind: 'item', width: MORE_BUTTON_WIDTH });
  const settingsLeft = 72 + 12 + 79 + 96;
  assert.ok(settingsLeft + rowWidth(kept, TIGHT_SPACING) <= 840 - 38 - EDGE_CLEARANCE);
});

test('nothing ever overlaps: at every desktop width the settings end before Export', () => {
  for (let width = 721; width <= 1600; width += 7) {
    for (const row of [arrowRow(), penRow()]) {
      const plan = planToolbarLayout({ ...bar(width), row });
      assert.equal(plan.fits, true, `@${width}`);
      const spacing = plan.tight ? TIGHT_SPACING : LOOSE_SPACING;
      const kept = row.filter((e) => !(e.slot && plan.overflow.includes(e.slot)))
        .map((e) => (e.slot && e.kind === 'item'
          ? { kind: 'item', width: plan.compact.includes(e.slot) ? e.widths.compact : e.widths.full }
          : e));
      if (plan.overflow.length) kept.push({ kind: 'item', width: MORE_BUTTON_WIDTH });
      const clusterLeft = width / 2 - 48 - plan.shift;
      const settingsLeft = clusterLeft + 96;
      assert.ok(settingsLeft + rowWidth(kept, spacing) <= width - 38 - EDGE_CLEARANCE, `settings @${width}`);
      assert.ok(clusterLeft - 79 >= 72 + EDGE_CLEARANCE - 0.001, `pan/select @${width}`);
    }
  }
});

test('once settings move into More, labels that fit again come back', () => {
  // Style, Arrowhead and Ends read "Mixed" (cannot collapse) and are wide, so
  // they go to More; the width must then read "2 pt" again since it fits.
  const row = [
    divider, colours, divider,
    slot('width', 72, 56), slot('style', 170, 150, false), slot('arrowhead', 170, 150, false), slot('ends', 170, 150, false),
  ];
  const plan = planToolbarLayout({ ...bar(840), row });
  assert.ok(plan.overflow.length > 0);
  assert.ok(!plan.compact.includes('width'));
});

test('a popover opens centred under its opener', () => {
  const pos = computeAnchoredPopoverPosition({
    anchorRect: { left: 500, right: 522, top: 7, bottom: 29, width: 22, height: 22 },
    popoverWidth: 210, popoverHeight: 258, viewportWidth: 1440, viewportHeight: 830,
  });
  assert.deepEqual(pos, { left: 406, top: 39, placement: 'below' });
});

test('a popover near the right edge slides left just enough to stay 8px inside', () => {
  // The owner's case: the swatch near the right rail of an 840px window.
  const pos = computeAnchoredPopoverPosition({
    anchorRect: { left: 790, right: 812, top: 7, bottom: 29, width: 22, height: 22 },
    popoverWidth: 210, popoverHeight: 258, viewportWidth: 840, viewportHeight: 830,
  });
  assert.equal(pos.left, 840 - 8 - 210);
  assert.equal(pos.placement, 'below');
});

test('a popover near the left edge slides right to stay 8px inside', () => {
  const pos = computeAnchoredPopoverPosition({
    anchorRect: { left: 20, right: 42, top: 7, bottom: 29, width: 22, height: 22 },
    popoverWidth: 210, popoverHeight: 258, viewportWidth: 840, viewportHeight: 830,
  });
  assert.equal(pos.left, 8);
});

test('with no room below it flips above the opener; with room nowhere it pins to the top', () => {
  const above = computeAnchoredPopoverPosition({
    anchorRect: { left: 300, right: 322, top: 700, bottom: 722, width: 22, height: 22 },
    popoverWidth: 210, popoverHeight: 258, viewportWidth: 840, viewportHeight: 830,
  });
  assert.equal(above.placement, 'above');
  assert.equal(above.top, 700 - 10 - 258);
  const pinned = computeAnchoredPopoverPosition({
    anchorRect: { left: 300, right: 322, top: 7, bottom: 29, width: 22, height: 22 },
    popoverWidth: 210, popoverHeight: 900, viewportWidth: 840, viewportHeight: 600,
  });
  assert.equal(pinned.top, 8);
});
