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
// RULED 2026-09-26 owner: centre rows on canvas (w45) — since superseded:
// RULED 2026-09-26 owner: fixed centred groups + animated loadouts (w47).
// Pan / Select pin left after Undo/Redo; the Draw / Shapes / Text icons are
// centred on the canvas span and never move with the tool, pick or loadout;
// the loadout grows rightward from the icons; rows 2 and 3 start at one fixed
// spot under the icons (rowStart). Assertions that changed for it carry that
// line.
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
  WIDEST_FORMAT_ROW_WIDTH,
  WIDEST_SUBTOOLS_WIDTH,
  computeAnchoredPopoverPosition,
  planFormatRow,
  planTextRow,
  planTopBar,
  rowStart,
  rowWidth,
} from '../src/utils/responsiveToolbar.js';

// The bar as measured in the live app (2026-09-26, w47): Undo/Redo, a rule,
// then Pan / Select pinned left — Select ends at 151; Export is 28px wide and
// 10px from the right edge; Draw/Shapes/Text are 96px. The canvas runs between
// the two 48px rails; an open Pages (224) or Survey (272) panel narrows it.
const bar = (barWidth, { leftPanel = 0, rightPanel = 0 } = {}) => ({
  barWidth,
  startRight: 151,
  exportLeft: barWidth - 38,
  clusterWidth: 96,
  spanLeft: 48 + leftPanel,
  spanRight: barWidth - 48 - rightPanel,
});
const spanCentre = (input) => (input.spanLeft + input.spanRight) / 2;
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
const PANELS = [{}, { leftPanel: 224 }, { rightPanel: 272 }, { leftPanel: 224, rightPanel: 272 }];

test('a rule costs 1px plus its inset each side; neighbouring controls cost one gutter', () => {
  assert.equal(rowWidth([divider], LOOSE_SPACING), 17);
  assert.equal(rowWidth([{ kind: 'item', width: 10 }, { kind: 'item', width: 20 }], LOOSE_SPACING), 36);
  // RULED 2026-09-26 owner: flip rows — the Arrow row measured 502px in the
  // tool bar with the leading rule; the formatting row draws it without that
  // rule, 485px, and that is the widest row any tool draws.
  const items = arrowRow().map((e) => (e.slot ? { kind: 'item', width: e.widths.full } : e));
  assert.equal(rowWidth(items, LOOSE_SPACING), 485);
  assert.equal(WIDEST_FORMAT_ROW_WIDTH, 485);
  assert.ok(rowWidth(items, TIGHT_SPACING) < 485);
});

test('the group icons sit at the same x whatever tool, pick or loadout is showing', () => {
  // RULED 2026-09-26 owner: fixed centred groups + animated loadouts. The
  // plan has no input for the loadout showing now (w45 took its width and
  // re-centred on it): whatever a caller measures of the loadout, the answer
  // is the same.
  assert.equal(WIDEST_SUBTOOLS_WIDTH, 7 * 28 + 6 * 6 + 17);
  // It reads no measure of the loadout at all — only the room kept for the
  // widest one...
  assert.doesNotMatch(String(planTopBar), /subtools|leftBlockWidth|undoRight/);
  // ...so the room kept is the only loadout number that can move the icons.
  const tight = bar(1024, { leftPanel: 560 });
  assert.notDeepEqual(planTopBar({ ...tight, loadoutReserve: 100 }), planTopBar(tight));
  for (let width = 721; width <= 2000; width += 7) {
    for (const panels of PANELS) {
      const input = bar(width, panels);
      const plan = planTopBar(input);
      for (const loadout of [0, 79, 113, 119, WIDEST_SUBTOOLS_WIDTH]) {
        assert.deepEqual(planTopBar({ ...input, subtoolsWidth: loadout, leftBlockWidth: 79, undoRight: 72 }), plan,
          `@${width} ${JSON.stringify(panels)} loadout ${loadout}`);
      }
    }
  }
});

test('the group icons are centred on the canvas at every desktop width with no panel open', () => {
  // RULED 2026-09-26 owner: fixed centred groups + animated loadouts — the
  // icons alone are centred (w45 centred Pan / Select + icons + loadout).
  for (let width = 721; width <= 2000; width += 7) {
    const input = bar(width);
    const plan = planTopBar(input);
    assert.equal(plan.anchor, 'center', `@${width}`);
    assert.ok(Math.abs(plan.clusterLeft + input.clusterWidth / 2 - spanCentre(input)) <= 0.5, `@${width}`);
    assert.equal(plan.shift, (width - 96) / 2 - plan.clusterLeft, 'shift is measured from the bar centre');
  }
});

test('with a side panel open the icons centre on the canvas that is left, room permitting', () => {
  // RULED 2026-09-26 owner: fixed centred groups + animated loadouts.
  for (const width of [2000, 1440, 1280]) {
    for (const panels of PANELS.slice(1)) {
      const input = bar(width, panels);
      const plan = planTopBar(input);
      assert.equal(plan.anchor, 'center', `@${width} ${JSON.stringify(panels)}`);
      assert.ok(Math.abs(plan.clusterLeft + input.clusterWidth / 2 - spanCentre(input)) <= 0.5);
    }
  }
});

test('the icons leave room for the WIDEST loadout before Export, and never run into Pan / Select', () => {
  // RULED 2026-09-26 owner: fixed centred groups + animated loadouts — the
  // room kept is the widest loadout's, whatever is showing, so the icons slide
  // off centre by the same amount for every tool.
  const nearExport = bar(1024, { leftPanel: 560 });
  const pushed = planTopBar(nearExport);
  assert.equal(pushed.anchor, 'start');
  assert.equal(pushed.clusterLeft + 96 + WIDEST_SUBTOOLS_WIDTH, 1024 - 38 - EDGE_CLEARANCE);
  // Same input, same answer: nothing in the plan depends on the last one.
  assert.deepEqual(planTopBar(nearExport), pushed);
  // A panel so wide the canvas centre sits left of Select: the icons stop
  // START_GAP clear of Select.
  const crowded = planTopBar(bar(900, { rightPanel: 600 }));
  assert.equal(crowded.anchor, 'start');
  assert.equal(crowded.clusterLeft, 151 + START_GAP);
});

test('rows 2 and 3 start level with the group icons, the same spot for every tool', () => {
  // RULED 2026-09-26 owner: fixed centred groups + animated loadouts. w45
  // centred each tool's settings, so a tool with more settings re-centred;
  // now the pen's row and the arrow's row (the widest) start at one spot.
  for (let width = 721; width <= 2000; width += 13) {
    for (const panels of PANELS) {
      const span = rowSpan(width, panels);
      if (span.usableRight - span.usableLeft < WIDEST_FORMAT_ROW_WIDTH + 2 * ROW_INSET) continue;
      const anchorLeft = planTopBar(bar(width, panels)).clusterLeft - RAIL;
      const start = rowStart({ ...span, anchorLeft });
      for (const row of [arrowRow(), penRow()]) {
        const plan = planFormatRow({ ...span, anchorLeft, row });
        assert.equal(plan.fits, true);
        assert.equal(plan.width, keptWidth(row, plan), 'the worked-out width is the drawn row');
        assert.equal(plan.left, start, `@${width} ${JSON.stringify(panels)}`);
        assert.ok(plan.left + plan.width <= span.usableRight - ROW_INSET, 'ends inside the inset');
      }
      // Level with the icons wherever the widest row fits from there.
      if (anchorLeft + WIDEST_FORMAT_ROW_WIDTH <= span.usableRight - ROW_INSET && anchorLeft >= span.usableLeft + ROW_INSET) {
        assert.equal(start, Math.round(anchorLeft), `@${width} ${JSON.stringify(panels)} level with the icons`);
      }
    }
  }
  // The live 840px window: the icons start at 372 (row 324); the Arrow row
  // could not end inside the row from there, so every row starts at 297 - 48.
  assert.equal(rowStart({ ...rowSpan(840), anchorLeft: 324 }), 840 - 2 * RAIL - ROW_INSET - WIDEST_FORMAT_ROW_WIDTH);
});

test('a row wider than the widest known one slides left just enough; a measured width wins', () => {
  // RULED 2026-09-26 owner: fixed centred groups + animated loadouts.
  const span = rowSpan(1440);
  const anchorLeft = 672 - RAIL;
  const plan = planFormatRow({ ...span, anchorLeft, row: penRow(), width: 189.4 });
  assert.equal(plan.width, 189.4);
  assert.equal(plan.left, 624);
  const wide = planFormatRow({ ...span, anchorLeft, row: penRow(), width: 760 });
  assert.equal(wide.left, span.usableRight - ROW_INSET - 760);
});

test('a row wider than its gap starts at the gap\'s inset, never under the left panel', () => {
  // RULED 2026-09-26 owner: centre rows on canvas — centring never pushes the
  // start past the row's inset or under a panel.
  // RULED 2026-09-26 owner: fixed centred groups + animated loadouts — the
  // same holds from the icons' spot.
  const span = rowSpan(1024, { leftPanel: 224, rightPanel: 272 });
  const withPanel = planFormatRow({ ...span, anchorLeft: 440 - RAIL, row: arrowRow() });
  assert.ok(withPanel.left >= 224 + ROW_INSET);
  assert.ok(withPanel.left + withPanel.width <= span.usableRight - ROW_INSET);
  // No anchor measured yet: the row's inset.
  assert.equal(rowStart({ ...span }), 224 + ROW_INSET);
});

test('the text bar (row 3) starts at row 2\'s spot, keeping room for its "Text" caption', () => {
  // RULED 2026-09-26 owner: fixed centred groups + animated loadouts (w45 had
  // it centred; w44 left-aligned with row 2's settings).
  const span = rowSpan(1440);
  const anchorLeft = 672 - RAIL;
  assert.equal(planTextRow({ ...span, anchorLeft, width: 602 }), rowStart({ ...span, anchorLeft }));
  // Wider than the room right of that spot: it slides left just enough.
  const narrow = rowSpan(1024);
  assert.equal(planTextRow({ ...narrow, anchorLeft: 464 - RAIL, width: 602 }), narrow.usableRight - ROW_INSET - 602);
  // Too little room left of it for the caption: it slides right just enough.
  assert.equal(planTextRow({ ...span, anchorLeft: 0, width: 602 }), span.usableLeft + ROW_INSET + TEXT_ROW_CAPTION_ROOM);
  // Wider than the gap: it keeps its start (caption room) and runs off the right.
  const both = rowSpan(840, { leftPanel: 224, rightPanel: 272 });
  assert.equal(planTextRow({ ...both, anchorLeft: 348 - RAIL, width: 602 }), 224 + ROW_INSET + TEXT_ROW_CAPTION_ROOM);
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
    // Row 1: the icons clear of Pan / Select, the widest loadout clear of
    // Export. RULED 2026-09-26 owner: centre rows on canvas — with any panel
    // open too. RULED 2026-09-26 owner: fixed centred groups + animated
    // loadouts — Pan / Select are pinned left now, and the room checked is
    // the widest loadout's, hanging off the icons.
    for (const panels of [{}, { rightPanel: 272 }, { leftPanel: 224, rightPanel: 272 }]) {
      const input = bar(width, panels);
      const { clusterLeft } = planTopBar(input);
      assert.ok(clusterLeft >= input.startRight + START_GAP - 0.5, `icons clear of Select @${width}`);
      assert.ok(clusterLeft + input.clusterWidth + WIDEST_SUBTOOLS_WIDTH <= width - 38 - EDGE_CLEARANCE + 0.5, `loadout @${width}`);
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
