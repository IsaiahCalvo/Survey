// w42 (2026-09-26): the narrow desktop tool bar — the order it gives ground in
// (src/utils/responsiveToolbar.js) and the popover placement maths that keeps
// the colour pickers under their opener and inside the window.
//
// RULED 2026-09-26 owner: flip rows (w44). The tool bar now holds the tool
// groups and the chosen group's TOOLS; the settings moved down to their own
// formatting row, which has the whole width to itself. So the one w42 plan
// became two: planTopBar (row 1) and planFormatRow (row 2). Every assertion
// below that changed because of the flip says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPACT_ORDER,
  EDGE_CLEARANCE,
  LOOSE_SPACING,
  MORE_BUTTON_WIDTH,
  OVERFLOW_ORDER,
  ROW_INSET,
  TIGHT_SPACING,
  WIDEST_FORMAT_ROW,
  WIDEST_SUBTOOLS_WIDTH,
  computeAnchoredPopoverPosition,
  planFormatRow,
  planTopBar,
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
// The formatting row runs between the two 48px rails (measured live: 48 to
// 1392 at 1440). Row coordinates: 0 is the row's left edge. An open Pages or
// Survey panel lies over one end of it.
const RAIL = 48;
const rowSpan = (width, { leftPanel = 0, rightPanel = 0 } = {}) => ({
  usableLeft: leftPanel,
  usableRight: width - 2 * RAIL - rightPanel,
  // Pan's left edge once the icons are centred, in row coordinates.
  preferredLeft: width / 2 - 48 - 79 - RAIL,
});
const slot = (id, full, compact = 44, canCompact = true) => ({
  kind: 'item', slot: id, widths: { full, compact }, canCompact,
});
const divider = { kind: 'divider' };
const colours = { kind: 'item', width: 100 };
// RULED 2026-09-26 owner: flip rows — the formatting row does not draw the rule
// that used to fence the settings off from the tool icons, so a row starts with
// its colours. The Arrow tool's row: colours, rule, width, style, arrowhead, ends.
const arrowRow = () => [
  colours, divider,
  slot('width', 72, 56), slot('style', 92, 47), slot('arrowhead', 90, 44), slot('ends', 96, 44),
];
// The pen's row: colours, rule, width.
const penRow = () => [colours, divider, slot('width', 72, 56)];
const keptWidth = (row, plan) => {
  const spacing = plan.tight ? TIGHT_SPACING : LOOSE_SPACING;
  const kept = row.filter((e) => !(e.slot && plan.overflow.includes(e.slot)))
    .map((e) => (e.slot && e.kind === 'item'
      ? { kind: 'item', width: plan.compact.includes(e.slot) ? e.widths.compact : e.widths.full }
      : e));
  if (plan.overflow.length) kept.push({ kind: 'item', width: MORE_BUTTON_WIDTH });
  return rowWidth(kept, spacing);
};

test('a rule costs 1px plus its inset each side; neighbouring controls cost one gutter', () => {
  assert.equal(rowWidth([divider], LOOSE_SPACING), 17);
  assert.equal(rowWidth([{ kind: 'item', width: 10 }, { kind: 'item', width: 20 }], LOOSE_SPACING), 36);
  // RULED 2026-09-26 owner: flip rows — the Arrow row measured 502px in the
  // tool bar with the leading rule; the formatting row draws it without that
  // rule, 485px, and that is the widest row any tool draws.
  const items = arrowRow().map((e) => (e.slot ? { kind: 'item', width: e.widths.full } : e));
  assert.equal(rowWidth(items, LOOSE_SPACING), 485);
  assert.equal(WIDEST_FORMAT_ROW, 485);
  assert.ok(rowWidth(items, TIGHT_SPACING) < 485);
});

test('normal widths keep the tool bar exactly as it was: centred, nothing moved', () => {
  for (const width of [1440, 1280, 1200]) {
    assert.deepEqual(planTopBar(bar(width)), { anchor: 'center', shift: 0 }, `@${width}`);
  }
});

test('the tool icons stay centred at every desktop width, whatever group is chosen', () => {
  // RULED 2026-09-26 owner: flip rows — below 1200px the icons used to sit left
  // to make room for the settings beside them. The settings are in their own row
  // now and the widest group's tools (Shapes: seven buttons, 249px with the
  // rule) fit beside the centred icons all the way down to the phone layout.
  assert.equal(WIDEST_SUBTOOLS_WIDTH, 7 * 28 + 6 * 6 + 17);
  for (let width = 721; width <= 1600; width += 7) {
    assert.deepEqual(planTopBar(bar(width)), { anchor: 'center', shift: 0 }, `@${width}`);
  }
});

test('if the tools ever did not fit, the icons would sit left by the same amount for every group', () => {
  // The plan reads a constant (the widest group), never the chosen group, so
  // switching groups can never move an icon.
  const plan = planTopBar({ ...bar(721), subtoolsWidth: 400 });
  assert.equal(plan.anchor, 'start');
  assert.ok(plan.shift > 0);
  assert.deepEqual(planTopBar({ ...bar(721), subtoolsWidth: 400 }), plan);
  // Pan then sits START_GAP right of Redo, clear of it.
  const clusterLeft = 721 / 2 - 48 - plan.shift;
  assert.ok(clusterLeft - 79 >= 72 + EDGE_CLEARANCE - 0.001);
});

test('the settings start under the Pan button whenever the widest row fits from there', () => {
  for (const width of [1440, 1280, 1024, 840]) {
    const span = rowSpan(width);
    for (const row of [arrowRow(), penRow()]) {
      const plan = planFormatRow({ ...span, row });
      assert.equal(plan.left, Math.round(span.preferredLeft), `@${width}`);
      assert.deepEqual(
        { tight: plan.tight, compact: plan.compact, overflow: plan.overflow, fits: plan.fits },
        { tight: false, compact: [], overflow: [], fits: true },
        `@${width}`,
      );
    }
  }
});

test('the colours start at the same spot for every tool (the window alone decides it)', () => {
  for (let width = 721; width <= 1600; width += 13) {
    for (const panels of [{}, { rightPanel: 272 }, { leftPanel: 224, rightPanel: 272 }]) {
      const span = rowSpan(width, panels);
      const pen = planFormatRow({ ...span, row: penRow() });
      const arrow = planFormatRow({ ...span, row: arrowRow() });
      assert.equal(pen.left, arrow.left, `@${width} ${JSON.stringify(panels)}`);
    }
  }
});

test('where the widest row would not fit under Pan, the start moves left, never past the inset', () => {
  // 760: Pan is at 205 in the row; 205 + 485 would end past the row's inset
  // (the row is 664 wide), so the start moves to 169 (live: 217 in the window).
  const span = rowSpan(760);
  const plan = planFormatRow({ ...span, row: arrowRow() });
  assert.equal(plan.left, span.usableRight - ROW_INSET - WIDEST_FORMAT_ROW);
  assert.ok(plan.left < span.preferredLeft);
  assert.equal(plan.fits, true);
  assert.deepEqual(plan.compact, []);
  // A side panel on the left: the start never goes under it.
  const withPanel = planFormatRow({ ...rowSpan(1024, { leftPanel: 224, rightPanel: 272 }), row: arrowRow() });
  assert.equal(withPanel.left, 224 + ROW_INSET);
});

test('the row gives ground in order: gutters, then labels (least useful first), then More', () => {
  // RULED 2026-09-26 owner: flip rows — planned on the formatting row now
  // (its own width, panels included) instead of beside the tool icons.
  // Between two open panels the row is short: tighter gutters, then Arrow ends
  // shows just its drawing, then the line style too.
  const at480 = planFormatRow({ usableLeft: 0, usableRight: 480, row: arrowRow() });
  assert.equal(at480.tight, true);
  assert.deepEqual(at480.compact, ['ends']);
  assert.deepEqual(at480.overflow, []);
  const at430 = planFormatRow({ usableLeft: 0, usableRight: 430, row: arrowRow() });
  assert.deepEqual(at430.compact, ['ends', 'style']);
  assert.deepEqual(at430.overflow, []);
});

test('labels collapse least-useful first and the width is the last to collapse', () => {
  assert.deepEqual(COMPACT_ORDER, ['ends', 'blend', 'style', 'arrowhead', 'width']);
});

test('settings move into More least-important first; the width is the last to go', () => {
  assert.deepEqual(OVERFLOW_ORDER, ['bump', 'start', 'ends', 'blend', 'style', 'aa', 'arrowhead', 'series', 'width']);
});

test('a pill reading "Mixed" never collapses; it moves into More instead', () => {
  // RULED 2026-09-26 owner: flip rows — planned on the formatting row now
  // (its own width, panels included) instead of beside the tool icons.
  const row = [
    colours, divider,
    slot('width', 72, 56), slot('style', 92, 47, false), slot('arrowhead', 90, 44, false), slot('ends', 96, 44, false),
  ];
  const plan = planFormatRow({ usableLeft: 0, usableRight: 440, row });
  assert.ok(!plan.compact.includes('style'));
  assert.ok(!plan.compact.includes('arrowhead'));
  assert.ok(!plan.compact.includes('ends'));
  assert.deepEqual(plan.overflow, ['ends']);
  assert.equal(plan.fits, true);
});

test('More takes settings in priority order and counts its own button', () => {
  // RULED 2026-09-26 owner: flip rows — planned on the formatting row now
  // (its own width, panels included) instead of beside the tool icons.
  // Pills far wider than today's, so More has to take several.
  const row = [
    colours, divider,
    slot('width', 150, 120), slot('style', 170, 150, false), slot('bump', 70, 70, false),
    slot('arrowhead', 170, 150, false), slot('ends', 170, 150, false),
    { kind: 'divider', slot: 'aa' }, slot('aa', 29, 29, false),
  ];
  const span = rowSpan(840);
  const plan = planFormatRow({ ...span, row });
  // bump, then ends, then style... in OVERFLOW_ORDER, never skipping one.
  const expected = OVERFLOW_ORDER.filter((id) => row.some((e) => e.slot === id)).slice(0, plan.overflow.length);
  assert.deepEqual(plan.overflow, expected);
  assert.ok(plan.overflow.length >= 2);
  assert.equal(plan.fits, true);
  // The chosen row, with More's own button, fits inside the row's inset.
  assert.ok(plan.left + keptWidth(row, plan) <= span.usableRight - ROW_INSET);
});

test('nothing ever overlaps: at every desktop width both rows stay inside their limits', () => {
  // RULED 2026-09-26 owner: flip rows — planned on the formatting row now
  // (its own width, panels included) instead of beside the tool icons.
  for (let width = 721; width <= 1600; width += 7) {
    // Row 1: Pan clear of Redo, the widest group's tools clear of Export.
    const top = planTopBar(bar(width));
    const clusterLeft = width / 2 - 48 - top.shift;
    assert.ok(clusterLeft - 79 >= 72 + EDGE_CLEARANCE - 0.001, `pan/select @${width}`);
    assert.ok(clusterLeft + 96 + WIDEST_SUBTOOLS_WIDTH <= width - 38 - EDGE_CLEARANCE, `tools @${width}`);
    // Row 2: the settings end inside the row's inset and clear of any panel.
    for (const panels of [{}, { rightPanel: 272 }, { leftPanel: 224, rightPanel: 272 }]) {
      const span = rowSpan(width, panels);
      if (span.usableRight - span.usableLeft < 300) continue;
      for (const row of [arrowRow(), penRow()]) {
        const plan = planFormatRow({ ...span, row });
        assert.equal(plan.fits, true, `@${width} ${JSON.stringify(panels)}`);
        assert.ok(plan.left >= span.usableLeft + ROW_INSET, `start @${width}`);
        assert.ok(plan.left + keptWidth(row, plan) <= span.usableRight - ROW_INSET, `end @${width} ${JSON.stringify(panels)}`);
      }
    }
  }
});

test('once settings move into More, labels that fit again come back', () => {
  // RULED 2026-09-26 owner: flip rows — planned on the formatting row now
  // (its own width, panels included) instead of beside the tool icons.
  // Style, Arrowhead and Ends read "Mixed" (cannot collapse) and are wide, so
  // they go to More; the width must then read "2 pt" again since it fits.
  const row = [
    colours, divider,
    slot('width', 72, 56), slot('style', 170, 150, false), slot('arrowhead', 170, 150, false), slot('ends', 170, 150, false),
  ];
  const plan = planFormatRow({ usableLeft: 0, usableRight: 500, row });
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
