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
//
// RULED 2026-09-27 owner: Pan/Select beside the groups (w48). Pan / Select
// hang off the icons' left edge again (Undo/Redo alone pinned left); the plan
// keeps them clear of Undo/Redo. RULED 2026-09-27 owner: rows 2/3 centred,
// animated — rows 2 and 3 centre under the icons (rowStart is gone). The
// "same spot in every state" tests stay.
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
  centredRowLeft,
  rowWidth,
  DESKTOP_RAIL_WIDTH,
  PHONE_LAYOUT_MAX_WIDTH,
  TEXT_ROW_STEPS,
  minDesktopWindowWidth,
  planTextRowStep,
  textRowLook,
  textRowWidth,
} from '../src/utils/responsiveToolbar.js';

// The bar as measured in the live app. RULED 2026-09-27 owner: Pan/Select
// beside the groups — Redo ends at 72 and the Pan / Select block (with its
// rule) is 79px, hung off the icons' left edge; Export is 28px wide and 10px
// from the right edge; Draw/Shapes/Text are 96px. The canvas runs between
// the two 48px rails; an open Pages (224) or Survey (272) panel narrows it.
const bar = (barWidth, { leftPanel = 0, rightPanel = 0 } = {}) => ({
  barWidth,
  startRight: 72,
  leftBlockWidth: 79,
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
  // widest one... RULED 2026-09-27 owner: Pan/Select beside the groups — it
  // reads the Pan / Select block again (the same width in every state).
  assert.doesNotMatch(String(planTopBar), /subtools/);
  // ...so the room kept is the only loadout number that can move the icons.
  const tight = bar(1024, { leftPanel: 560 });
  assert.notDeepEqual(planTopBar({ ...tight, loadoutReserve: 100 }), planTopBar(tight));
  for (let width = 721; width <= 2000; width += 7) {
    for (const panels of PANELS) {
      const input = bar(width, panels);
      const plan = planTopBar(input);
      for (const loadout of [0, 79, 113, 119, WIDEST_SUBTOOLS_WIDTH]) {
        assert.deepEqual(planTopBar({ ...input, subtoolsWidth: loadout }), plan,
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

test('the icons leave room for the WIDEST loadout before Export, and Pan / Select never run into Undo/Redo', () => {
  // RULED 2026-09-26 owner: fixed centred groups + animated loadouts — the
  // room kept is the widest loadout's, whatever is showing, so the icons slide
  // off centre by the same amount for every tool.
  const nearExport = bar(1024, { leftPanel: 560 });
  const pushed = planTopBar(nearExport);
  assert.equal(pushed.anchor, 'start');
  assert.equal(pushed.clusterLeft + 96 + WIDEST_SUBTOOLS_WIDTH, 1024 - 38 - EDGE_CLEARANCE);
  // Same input, same answer: nothing in the plan depends on the last one.
  assert.deepEqual(planTopBar(nearExport), pushed);
  // A panel so wide the canvas centre sits left of Undo/Redo: the icons stop
  // where Pan (hung off their left) is START_GAP clear of Redo. RULED
  // 2026-09-27 owner: Pan/Select beside the groups (w47 stopped them clear
  // of a pinned Select).
  const crowded = planTopBar(bar(900, { rightPanel: 600 }));
  assert.equal(crowded.anchor, 'start');
  assert.equal(crowded.clusterLeft - 79, 72 + START_GAP);
});

test('rows 2 and 3 are centred under the group icons', () => {
  // RULED 2026-09-27 owner: rows 2/3 centred, animated (w47 started every
  // row level with the icons' left edge). Owner: "the subtool bar items are
  // not centered." Each row centres on the icons' centre wherever it fits.
  for (let width = 721; width <= 2000; width += 13) {
    for (const panels of PANELS) {
      const span = rowSpan(width, panels);
      if (span.usableRight - span.usableLeft < WIDEST_FORMAT_ROW_WIDTH + 2 * ROW_INSET) continue;
      const centre = planTopBar(bar(width, panels)).clusterLeft + 48 - RAIL;
      for (const row of [arrowRow(), penRow()]) {
        const plan = planFormatRow({ ...span, centre, row });
        assert.equal(plan.fits, true);
        assert.equal(plan.width, keptWidth(row, plan), 'the worked-out width is the drawn row');
        assert.ok(plan.left >= span.usableLeft + ROW_INSET, 'starts inside the inset');
        assert.ok(plan.left + plan.width <= span.usableRight - ROW_INSET, 'ends inside the inset');
        const room = centre - plan.width / 2 >= span.usableLeft + ROW_INSET
          && centre + plan.width / 2 <= span.usableRight - ROW_INSET;
        if (room) {
          assert.ok(Math.abs(plan.left + plan.width / 2 - centre) <= 0.5, `@${width} ${JSON.stringify(panels)} centred`);
        }
      }
    }
  }
  // With no panel open the icons sit on the canvas centre, and so do rows 2
  // and 3.
  const span = rowSpan(1440);
  const centre = planTopBar(bar(1440)).clusterLeft + 48 - RAIL;
  assert.equal(centre, (span.usableLeft + span.usableRight) / 2);
  assert.equal(planFormatRow({ ...span, centre, row: penRow(), width: 189.4 }).left, Math.round(centre - 189.4 / 2));
  assert.equal(planTextRow({ ...span, centre, width: 602 }), Math.round(centre - 301));
});

test('a measured width wins; a row too wide to centre slides just far enough', () => {
  // RULED 2026-09-27 owner: rows 2/3 centred, animated.
  const span = rowSpan(1440);
  const plan = planFormatRow({ ...span, centre: 624, row: penRow(), width: 189.4 });
  assert.equal(plan.width, 189.4);
  assert.equal(plan.left, Math.round(624 - 189.4 / 2));
  // Centred on a spot near the right end: slides left to end at the inset.
  const nearRight = planFormatRow({ ...span, centre: span.usableRight - 100, row: penRow(), width: 485 });
  assert.equal(nearRight.left, span.usableRight - ROW_INSET - 485);
  // Wider than the span: keeps the inset and runs off the right.
  const wide = planFormatRow({ ...span, centre: 624, row: penRow(), width: 2000 });
  assert.equal(wide.left, span.usableLeft + ROW_INSET);
});

test('a row wider than its gap starts at the gap\'s inset, never under the left panel', () => {
  // RULED 2026-09-26 owner: centre rows on canvas — centring never pushes the
  // start past the row's inset or under a panel. RULED 2026-09-27 owner:
  // rows 2/3 centred, animated — the same holds centred under the icons.
  const span = rowSpan(1024, { leftPanel: 224, rightPanel: 272 });
  const withPanel = planFormatRow({ ...span, centre: 488 - RAIL, row: arrowRow() });
  assert.ok(withPanel.left >= 224 + ROW_INSET);
  assert.ok(withPanel.left + withPanel.width <= span.usableRight - ROW_INSET);
  // No centre measured yet: the middle of the uncovered span.
  assert.equal(centredRowLeft({ ...span, width: 100 }), Math.round((span.usableLeft + span.usableRight) / 2 - 50));
});

test('the text bar (row 3) centres like row 2, keeping room for its "Text" caption', () => {
  // RULED 2026-09-27 owner: rows 2/3 centred, animated (w47 started it at
  // row 2's fixed spot; w45 had it centred on the span; w44 left-aligned).
  const span = rowSpan(1440);
  const centre = 672 - RAIL + 48;
  assert.equal(planTextRow({ ...span, centre, width: 602 }), Math.round(centre - 301));
  // Wider than the room right of centre: it slides left just enough.
  const narrow = rowSpan(1024);
  assert.equal(planTextRow({ ...narrow, centre: narrow.usableRight - 200, width: 602 }), narrow.usableRight - ROW_INSET - 602);
  // Too little room left of it for the caption: it slides right just enough.
  assert.equal(planTextRow({ ...span, centre: 0, width: 602 }), span.usableLeft + ROW_INSET + TEXT_ROW_CAPTION_ROOM);
  // Wider than the gap: it keeps its start (caption room) and runs off the right.
  const both = rowSpan(840, { leftPanel: 224, rightPanel: 272 });
  assert.equal(planTextRow({ ...both, centre: 396 - RAIL, width: 602 }), 224 + ROW_INSET + TEXT_ROW_CAPTION_ROOM);
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
    // loadouts — the room checked is the widest loadout's, hanging off the
    // icons. RULED 2026-09-27 owner: Pan/Select beside the groups — Pan /
    // Select hang off the icons' left and stay clear of Undo/Redo.
    for (const panels of [{}, { rightPanel: 272 }, { leftPanel: 224, rightPanel: 272 }]) {
      const input = bar(width, panels);
      const { clusterLeft } = planTopBar(input);
      assert.ok(clusterLeft - input.leftBlockWidth >= input.startRight + START_GAP - 0.5, `Pan clear of Redo @${width}`);
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

// Owner Test 41 (2026-10-04), "narrow window": "around the 780-pixel mark, the
// more I shrink it, it doesn't really do anything. I can keep bringing the
// right rail closer in until it covers ... the alignment tool for text."
// Measured before the fix: the text bar (row 3) stayed 602px wide and ran
// under the right rail from 751px down to the phone switch at 720px (and much
// earlier beside an open side panel). It now gives ground in steps; the step
// depends only on the room the row has.
test('Test 41: the text bar\'s width at each step (fixed CSS widths, checked live)', () => {
  // Measured in Chromium: 602 / 554 / 523 / 492 / 464 / 406 / 328 (the live
  // bar rounds the last two a pixel down).
  const withVertical = TEXT_ROW_STEPS.map((step) => textRowWidth(step));
  assert.deepEqual(withVertical, [602, 554, 523, 492, 464, 407, 329, 329]);
  // Callout text has no top / middle / bottom: folding them is a no-op.
  const callout = TEXT_ROW_STEPS.map((step) => textRowWidth(step, { verticalAlign: false }));
  assert.deepEqual(callout, [507, 471, 471, 440, 412, 355, 277, 277]);
  assert.deepEqual(textRowLook('full'), {
    step: 'full', tight: false, foldVertical: false, foldAlign: false, shortFont: false, foldStyle: false, oneColour: false, caption: true,
  });
  assert.deepEqual(textRowLook('no-caption'), {
    step: 'no-caption', tight: true, foldVertical: true, foldAlign: true, shortFont: true, foldStyle: true, oneColour: true, caption: false,
  });
});

test('Test 41: which step the text bar takes for the room it has', () => {
  // span = the row's uncovered width (between the rails, less any open panel).
  // A step fits when its controls + 2 * 10 inset + 34 caption room <= span.
  const table = [
    [1344, 'full'], // 1440 window
    [656, 'full'], // 752: the narrowest window that keeps the full bar
    [655, 'tight'],
    [625, 'tight'], // 721: one px above the phone switch
    [608, 'tight'],
    [607, 'fold-vertical'],
    [577, 'fold-vertical'],
    [576, 'fold-align'],
    [546, 'fold-align'],
    [545, 'short-font'],
    [518, 'short-font'],
    [517, 'fold-style'],
    [461, 'fold-style'],
    [460, 'one-colour'],
    [383, 'one-colour'],
    [382, 'no-caption'],
    [349, 'no-caption'],
  ];
  for (const [span, step] of table) {
    const plan = planTextRowStep(span);
    assert.equal(plan.step, step, `span ${span}`);
    assert.equal(plan.fits, true, `span ${span} fits`);
  }
  // Too small even for the last step: it stays on the last step, flagged.
  assert.deepEqual(planTextRowStep(129), { step: 'no-caption', index: 7, width: 329, fits: false });
  // Callout text: tight already fits where fold-vertical would be needed, so
  // fold-vertical (a no-op for it) is never chosen.
  assert.equal(planTextRowStep(525, { verticalAlign: false }).step, 'tight');
  assert.equal(planTextRowStep(524, { verticalAlign: false }).step, 'fold-align');
  // Never steps back up as the room shrinks (no flip-flop as a window narrows).
  let last = 0;
  for (let span = 1400; span >= 300; span -= 1) {
    const { index } = planTextRowStep(span);
    assert.ok(index >= last, `span ${span}: step ${index} after ${last}`);
    last = index;
  }
});

test('Test 41: the text bar fits every desktop width above the phone switch', () => {
  // No side panel: the row spans the window less the two 48px rails.
  for (let width = PHONE_LAYOUT_MAX_WIDTH + 1; width <= 1440; width += 1) {
    const span = width - 2 * DESKTOP_RAIL_WIDTH;
    const plan = planTextRowStep(span);
    assert.ok(plan.fits, `${width}px`);
    // ...and only ever needs the first step (tighter gutters) to do it.
    assert.ok(plan.index <= 1, `${width}px uses ${plan.step}`);
  }
  // With the Pages (224) or Survey (272) panel open, it still fits all the
  // way down to the switch.
  for (const panel of [224, 272]) {
    for (let width = PHONE_LAYOUT_MAX_WIDTH + 1; width <= 1440; width += 1) {
      assert.ok(planTextRowStep(width - 2 * DESKTOP_RAIL_WIDTH - panel).fits, `${width}px beside a ${panel}px panel`);
    }
  }
  // The planned left edge keeps the controls inside the row.
  const span = rowSpan(721, { rightPanel: 272 });
  const plan = planTextRowStep(span.usableRight - span.usableLeft);
  const left = planTextRow({ ...span, centre: 300, width: plan.width, caption: textRowLook(plan.step).caption });
  assert.ok(left >= span.usableLeft + ROW_INSET);
  assert.ok(left + plan.width <= span.usableRight - ROW_INSET);
});

test('Test 41: the phone switch stays at 720px, below which the desktop rows would still fit', () => {
  // DELIBERATE: the brief asked for the switch to move to where even the most
  // compact desktop rows stop fitting. That is 554px (the tool bar: Undo/Redo,
  // Pan/Select, the group icons, the widest loadout and Export), but at 720px
  // the viewer itself turns into the phone's touch surface (page gaps, pinch,
  // no trackpad overscroll — PdfjsViewerContainer, out of scope), and ~20
  // stylesheet rules switch with it. So the switch stays at 720, and every
  // width above it now fits: no dead zone where a rail covers a control.
  assert.equal(PHONE_LAYOUT_MAX_WIDTH, 720);
  assert.equal(minDesktopWindowWidth(), 554);
  assert.ok(minDesktopWindowWidth() < PHONE_LAYOUT_MAX_WIDTH);
  // The tool bar's own plan agrees at the switch: the widest loadout ends
  // clear of Export.
  const plan = planTopBar(bar(PHONE_LAYOUT_MAX_WIDTH + 1));
  assert.ok(plan.clusterLeft + 96 + WIDEST_SUBTOOLS_WIDTH + EDGE_CLEARANCE <= PHONE_LAYOUT_MAX_WIDTH + 1 - 38);
});
