// w42 (2026-09-26): the narrow desktop tool bar — the order it gives ground in
// (src/utils/responsiveToolbar.js) and the popover placement maths that keeps
// the colour pickers under their opener and inside the window.
//
// RULED 2026-09-26 owner: flip rows (w44). The tool bar now holds the tool
// groups and the chosen group's TOOLS; the settings moved down to their own
// formatting row, which has the whole width to itself. So the one w42 plan
// became two: planTopBar (row 1) and planFormatRow (row 2). Every assertion
// below that changed because of the flip says so.
//
// RULED 2026-09-26 owner: centre rows on canvas (w45). Every row — the tools
// row, the formatting row and the Aa text bar (planTextRow) — is centred on the
// canvas span between the rails (less any open side panel). Assertions that
// changed for it carry that line.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPACT_ORDER,
  EDGE_CLEARANCE,
  LOOSE_SPACING,
  MORE_BUTTON_WIDTH,
  OVERFLOW_ORDER,
  ROW_INSET,
  START_GAP,
  TEXT_ROW_CAPTION_ROOM,
  TIGHT_SPACING,
  WIDEST_SUBTOOLS_WIDTH,
  computeAnchoredPopoverPosition,
  planFormatRow,
  planTextRow,
  planTopBar,
  rowWidth,
} from '../src/utils/responsiveToolbar.js';

// The bar as measured in the live app (2026-09-26): Redo ends at 72, Export is
// 28px wide and 10px from the right edge, Draw/Shapes/Text are 96px, Pan/Select
// with its rule 79px.
// RULED 2026-09-26 owner: centre rows on canvas — the canvas runs between the
// two 48px rails; an open Pages (224) or Survey (272) panel narrows it.
const bar = (barWidth, { subtoolsWidth = WIDEST_SUBTOOLS_WIDTH, leftPanel = 0, rightPanel = 0 } = {}) => ({
  barWidth,
  undoRight: 72,
  exportLeft: barWidth - 38,
  clusterWidth: 96,
  leftBlockWidth: 79,
  subtoolsWidth,
  spanLeft: 48 + leftPanel,
  spanRight: barWidth - 48 - rightPanel,
});
// The tools row's edges once the plan is applied (the icons sit centred in the
// bar before any shift).
const toolsRow = (input, plan) => {
  const clusterLeft = (input.barWidth - input.clusterWidth) / 2 - plan.shift;
  return {
    left: clusterLeft - input.leftBlockWidth,
    right: clusterLeft + input.clusterWidth + input.subtoolsWidth,
  };
};
const centreOf = ({ left, right }) => (left + right) / 2;
// The formatting row runs between the two 48px rails (measured live: 48 to
// 1392 at 1440). Row coordinates: 0 is the row's left edge. An open Pages or
// Survey panel lies over one end of it.
const RAIL = 48;
const rowSpan = (width, { leftPanel = 0, rightPanel = 0 } = {}) => ({
  usableLeft: leftPanel,
  usableRight: width - 2 * RAIL - rightPanel,
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
  assert.ok(rowWidth(items, TIGHT_SPACING) < 485);
});

test('the tools row is centred on the canvas at every desktop width, whatever group is chosen', () => {
  // RULED 2026-09-26 owner: centre rows on canvas. It used to centre only the
  // group icons on the window (Pan / Select and the group's tools hung off
  // either side); now the whole row — Pan / Select, the icons and the chosen
  // group's tools — is centred on the span between the rails.
  assert.equal(WIDEST_SUBTOOLS_WIDTH, 7 * 28 + 6 * 6 + 17);
  for (let width = 721; width <= 2000; width += 7) {
    for (const subtoolsWidth of [0, 113, 170, WIDEST_SUBTOOLS_WIDTH]) {
      const input = bar(width, { subtoolsWidth });
      const plan = planTopBar(input);
      assert.equal(plan.anchor, 'center', `@${width} ${subtoolsWidth}`);
      assert.ok(Math.abs(centreOf(toolsRow(input, plan)) - width / 2) <= 0.5, `@${width} ${subtoolsWidth}`);
    }
  }
});

test('with a side panel open the tools row centres on the canvas that is left', () => {
  // RULED 2026-09-26 owner: centre rows on canvas.
  for (const width of [2000, 1440, 1280, 1024]) {
    for (const panels of [{ leftPanel: 224 }, { rightPanel: 272 }, { leftPanel: 224, rightPanel: 272 }]) {
      const input = bar(width, { subtoolsWidth: 170, ...panels });
      const plan = planTopBar(input);
      assert.equal(plan.anchor, 'center', `@${width} ${JSON.stringify(panels)}`);
      assert.ok(Math.abs(centreOf(toolsRow(input, plan)) - (input.spanLeft + input.spanRight) / 2) <= 0.5);
    }
  }
});

test('a row that would run into Undo/Redo or Export slides just far enough to clear them', () => {
  // RULED 2026-09-26 owner: centre rows on canvas — Undo/Redo stay far left and
  // Export far right; the row gives way to them, never the other way round.
  const narrow = bar(840, { subtoolsWidth: WIDEST_SUBTOOLS_WIDTH, rightPanel: 272 });
  const plan = planTopBar(narrow);
  assert.equal(plan.anchor, 'start');
  assert.equal(toolsRow(narrow, plan).left, 72 + START_GAP);
  // Same input, same answer: nothing in the plan depends on the last one.
  assert.deepEqual(planTopBar(narrow), plan);
  const nearExport = bar(1024, { subtoolsWidth: WIDEST_SUBTOOLS_WIDTH, leftPanel: 560 });
  const pushed = planTopBar(nearExport);
  assert.equal(pushed.anchor, 'start');
  assert.equal(toolsRow(nearExport, pushed).right, 1024 - 38 - EDGE_CLEARANCE);
});

test('the settings are centred on the canvas span, with or without side panels', () => {
  // RULED 2026-09-26 owner: centre rows on canvas. The settings used to start
  // under the Pan button at a spot the window alone decided, so the colours
  // never moved between tools; now each tool's row is centred, and a tool with
  // more settings re-centres (the owner accepted that).
  for (let width = 721; width <= 2000; width += 13) {
    for (const panels of [{}, { leftPanel: 224 }, { rightPanel: 272 }, { leftPanel: 224, rightPanel: 272 }]) {
      const span = rowSpan(width, panels);
      if (span.usableRight - span.usableLeft < 520) continue;
      for (const row of [arrowRow(), penRow()]) {
        const plan = planFormatRow({ ...span, row });
        assert.equal(plan.fits, true);
        assert.equal(plan.width, keptWidth(row, plan), 'the worked-out width is the drawn row');
        const centre = plan.left + plan.width / 2;
        assert.ok(Math.abs(centre - (span.usableLeft + span.usableRight) / 2) <= 0.5, `@${width} ${JSON.stringify(panels)}`);
      }
    }
  }
});

test('a measured width wins over the worked-out one, so the row centres on what is drawn', () => {
  // RULED 2026-09-26 owner: centre rows on canvas.
  const span = rowSpan(1440);
  const plan = planFormatRow({ ...span, row: penRow(), width: 189.4 });
  assert.equal(plan.width, 189.4);
  assert.equal(plan.left, Math.round((span.usableLeft + span.usableRight) / 2 - 189.4 / 2));
});

test('a row wider than its gap starts at the gap\'s inset, never under the left panel', () => {
  // RULED 2026-09-26 owner: centre rows on canvas — centring never pushes the
  // start past the row's inset or under a panel.
  const withPanel = planFormatRow({ ...rowSpan(1024, { leftPanel: 224, rightPanel: 272 }), row: arrowRow() });
  assert.ok(withPanel.left >= 224 + ROW_INSET);
  assert.ok(withPanel.left + withPanel.width <= rowSpan(1024, { leftPanel: 224, rightPanel: 272 }).usableRight - ROW_INSET);
});

test('the text bar (row 3) centres on the same span, keeping room for its "Text" caption', () => {
  // RULED 2026-09-26 owner: centre rows on canvas (w44 had it left-aligned
  // with row 2's settings).
  const span = rowSpan(1440);
  const left = planTextRow({ ...span, width: 602 });
  assert.ok(Math.abs(left + 301 - (span.usableLeft + span.usableRight) / 2) <= 0.5);
  // Too little room left of centre for the caption: it slides right just enough.
  const tight = rowSpan(1024, { rightPanel: 272 });
  assert.equal(planTextRow({ ...tight, width: 602 }), tight.usableLeft + ROW_INSET + TEXT_ROW_CAPTION_ROOM);
  // Wider than the gap: it keeps its start (caption room) and runs off the right.
  const both = rowSpan(840, { leftPanel: 224, rightPanel: 272 });
  assert.equal(planTextRow({ ...both, width: 602 }), 224 + ROW_INSET + TEXT_ROW_CAPTION_ROOM);
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
    // RULED 2026-09-26 owner: centre rows on canvas — with any panel open too.
    for (const panels of [{}, { rightPanel: 272 }, { leftPanel: 224, rightPanel: 272 }]) {
      const input = bar(width, panels);
      const edges = toolsRow(input, planTopBar(input));
      assert.ok(edges.left >= 72 + EDGE_CLEARANCE - 0.5, `pan/select @${width}`);
      assert.ok(edges.right <= width - 38 - EDGE_CLEARANCE + 0.5, `tools @${width}`);
    }
    // Row 2: the settings end inside the row's inset and clear of any panel.
    for (const panels of [{}, { rightPanel: 272 }, { leftPanel: 224, rightPanel: 272 }]) {
      const span = rowSpan(width, panels);
      // Narrower than the widest row can shrink to: pinned separately below.
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

test('a narrow window with both side panels open: every setting but the colours moves into More, clear of the panels', () => {
  // w44 review: at 721px with the Pages (224) and Survey (272) panels open,
  // about 129px of the row is uncovered. The settings must not run under a
  // panel: they start inside the gap and everything but the colours waits in
  // More. The colours themselves never move into More, so the row may still
  // not fit a 100px colour group plus More in so small a gap; it starts at the
  // gap's inset either way and never under the left panel.
  const span = rowSpan(721, { leftPanel: 224, rightPanel: 272 });
  assert.equal(span.usableRight - span.usableLeft, 721 - 96 - 224 - 272);
  const plan = planFormatRow({ ...span, row: arrowRow() });
  assert.equal(plan.left, 224 + ROW_INSET);
  assert.deepEqual([...plan.overflow].sort(), ['arrowhead', 'ends', 'style', 'width']);
  // A lighter row (the pen's) in the same gap: only the width goes to More,
  // and the colours plus More end inside the gap.
  const pen = planFormatRow({ ...span, row: [{ kind: 'item', width: 48 }, divider, slot('width', 72, 56)] });
  assert.deepEqual(pen.overflow, ['width']);
  assert.equal(pen.fits, true);
  assert.ok(pen.left + rowWidth([{ kind: 'item', width: 48 }, divider, { kind: 'item', width: MORE_BUTTON_WIDTH }], TIGHT_SPACING)
    <= span.usableRight - ROW_INSET);
});
