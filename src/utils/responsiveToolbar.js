/**
 * Responsive desktop tool bar (w42, 2026-09-26; rows flipped in w44) — the pure
 * maths.
 *
 * Owner report (w42): in a Chrome split view (~840px wide) the tool bar's
 * settings ran into the Export button, and the colour picker opened off to the
 * right, half under the right rail. Coordinator ruling: never overlap, never
 * switch to the phone layout on a desktop window, and never change the bar at
 * normal widths.
 *
 * RULED 2026-09-26 owner: flip rows. The desktop chrome is now
 *   row 1, the tool bar:    Undo/Redo · Pan/Select | Draw/Shapes/Text | the
 *                           chosen group's own tools (pen / highlighter /
 *                           eraser …) · Export;
 *   row 2, formatting:      the armed tool's — or the picked mark's — settings
 *                           (colours, width, line style, ends, Aa, More);
 *   row 3:                  the text-formatting bar Aa drops (unchanged).
 * So there are two plans:
 *
 *   TOOL BAR (planTopBar). RULED 2026-09-26 owner: fixed centred groups +
 *   animated loadouts (w47, supersedes w45's "re-centre on content"). Owner:
 *   "everything just keeps adjusting to stay centered, and it's throwing me
 *   off. I want consistency so there are not big jumps and snaps." So:
 *     - Undo/Redo sit pinned at the LEFT. RULED 2026-09-27 owner:
 *       Pan/Select beside the groups (w48, undoes w47's pin beside
 *       Undo/Redo): Pan / Select and their rule hang off the icons' LEFT
 *       edge at a fixed offset, so they move only when the icons do;
 *     - the Draw / Shapes / Text icons are centred on the canvas span (the
 *       span between the two side rails) and NEVER move when you switch
 *       tools, pick a mark or open something — their spot depends on the
 *       window only. Owner 2026-10-01: opening or closing a side panel
 *       (Pages / Search / Bookmarks / Spaces / Survey) must not move them
 *       either; the panels open below the tool bar, so the hook no longer
 *       takes an open panel off the span (useResponsiveToolbar);
 *     - the "loadout" (the chosen group's own tools, Select's Box / Lasso /
 *       Text, a picked mark's group tools) hangs off the icons' right edge
 *       and grows rightward from that fixed anchor, so nothing else moves
 *       when it changes. It fades and slides in and out
 *       (utils/loadoutTransition.js);
 *     - Export stays pinned right.
 *   The icons slide off the canvas centre only when the WIDEST loadout would
 *   otherwise run into Export, or Pan / Select into Undo/Redo — by the same
 *   amount whatever loadout is showing, so they still never move with the
 *   tool.
 *
 *   FORMATTING ROW (planFormatRow). RULED 2026-09-27 owner: rows 2/3
 *   centred, animated (w48, supersedes w47's fixed start under the icons).
 *   Owner: "also the subtool bar items are not centered." The settings are
 *   centred on the same centre as the Draw / Shapes / Text icons above them.
 *   A row whose controls change (a tool switch, Cloud adding Bump) re-centres,
 *   (RULED 2026-09-28 owner: one motion for row 2 — the row crossfades in
 *   place at its new spot; w48's glide is gone); a row whose controls have
 *   not changed never moves. Where the row
 *   would run past either inset it slides just far enough, and it gives
 *   ground in the w42 order:
 *     1. the gutters between the setting pills and the rules tighten;
 *     2. secondary labels collapse, one pill at a time, least useful first
 *        ("Solid" becomes just the line it draws, "2 pt" becomes "2");
 *     3. the least important settings move, one at a time, into a single
 *        "More" menu (the ⋯ button at the end of the settings). Same controls
 *        inside, same behaviour. Colours are never moved.
 *
 *   TEXT BAR (planTextRow). Row 3 is centred the same way (w48); its "Text"
 *   caption hangs off to the left of it. In a narrow row it gives ground in
 *   its own steps (planTextRowStep, owner Test 41).
 *
 * The phone layout is chosen by the screen, not the window (owner 2026-10-13,
 * utils/layoutMode.js), so a desktop window keeps these rows at any width.
 * The hook that measures the DOM and applies both plans is useResponsiveToolbar.
 */

/** The widest a group's tools get in the tool bar: Shapes' seven 28px buttons
 * on the 6px tool gutter, plus the rule (1px + 8px each side) that fences them
 * off from the group icons. 7 * 28 + 6 * 6 + 17 = 249. planTopBar's default
 * when the live width is not given. */
export const WIDEST_SUBTOOLS_WIDTH = 249;

/** The same widest loadout on a given tool gutter. A touch-first screen
 * opens the tool bar's gutter to 12px (styles/touchTargets.css, touch audit
 * 2026-10-13) so each button's invisible hit zone can reach 40px; the plan
 * then keeps that much wider loadout clear of Export. */
export const widestSubtoolsWidth = (toolGap = 6) => {
  const gap = Number.isFinite(toolGap) && toolGap >= 0 ? toolGap : 6;
  return 7 * 28 + 6 * gap + 17;
};

/** The widest formatting row any tool draws: the Arrow tool's colours, rule,
 * width, line style, arrowhead and ends — 485px on the loose gutters,
 * measured live 2026-09-26 (Callout 351, Polyline / Line 287, Text 255, Pen
 * 189). */
export const WIDEST_FORMAT_ROW_WIDTH = 485;

/** Clear space kept at either end of the formatting row. */
export const ROW_INSET = 10;

/** Room the text bar (row 3) keeps left of its controls for the "Text"
 * caption that hangs off them. */
export const TEXT_ROW_CAPTION_ROOM = 34;

/** Clear space kept between the widest loadout and Export. */
export const EDGE_CLEARANCE = 8;

/** Space kept between Redo and Pan when a narrow window pushes the icons
 * (and Pan / Select with them) left, off the canvas centre. */
export const START_GAP = 12;

/** Gutters: the normal settings row, and the tightened one (stage 1). */
export const LOOSE_SPACING = { gap: 6, inset: 8 };
export const TIGHT_SPACING = { gap: 4, inset: 4 };

/** The More (⋯) button: the shared 28px chrome control. */
export const MORE_BUTTON_WIDTH = 28;

/**
 * Every setting that may collapse or move, in the order the row draws them.
 * `keep` is its priority: the HIGHER, the longer it stays in the row. `label`
 * names its row inside the More menu. `compactWidth` is only a first guess
 * for the glyph-only look; the real width is measured once it has been drawn.
 *
 * Why this order: the width is what people change most, so it goes last; the
 * counter's series is what a counter IS, so it stays too. Cloud bump size and
 * the counter start number are rare tweaks, arrow ends and line style are set
 * once and left, the arrowhead is seen on every arrow, and the Aa button
 * (show / hide the text bar) still has the text bar itself to fall back on.
 */
export const TOOLBAR_SLOTS = [
  { id: 'series', label: 'Count', keep: 90, compactable: false, fullWidth: 80 },
  { id: 'blend', label: 'Blend', keep: 45, compactable: true, fullWidth: 118, compactWidth: 48 },
  { id: 'width', label: 'Width', keep: 100, compactable: true, fullWidth: 72, compactWidth: 56 },
  { id: 'start', label: 'Start', keep: 20, compactable: false, fullWidth: 72, selfLabelled: true },
  { id: 'style', label: 'Style', keep: 50, compactable: true, fullWidth: 92, compactWidth: 48 },
  { id: 'bump', label: 'Bump', keep: 10, compactable: false, fullWidth: 66, selfLabelled: true },
  { id: 'arrowhead', label: 'Arrowhead', keep: 60, compactable: true, fullWidth: 90, compactWidth: 44 },
  { id: 'ends', label: 'Ends', keep: 40, compactable: true, fullWidth: 96, compactWidth: 44 },
  { id: 'aa', label: 'Text', keep: 55, compactable: false, fullWidth: 29 },
];

const SLOT_BY_ID = new Map(TOOLBAR_SLOTS.map((slot) => [slot.id, slot]));
export const slotDefinition = (id) => SLOT_BY_ID.get(id) || null;

/** Labels collapse from the least important pill up. */
export const COMPACT_ORDER = TOOLBAR_SLOTS
  .filter((slot) => slot.compactable)
  .sort((a, b) => a.keep - b.keep)
  .map((slot) => slot.id);

/** Settings move into More from the least important up. */
export const OVERFLOW_ORDER = TOOLBAR_SLOTS
  .slice()
  .sort((a, b) => a.keep - b.keep)
  .map((slot) => slot.id);

/**
 * Width of one settings row. `items` is the row in order; each item is
 * `{ kind: 'divider' }` or `{ kind: 'item', width }`. A rule costs 1px plus its
 * inset on each side (the row's own gutter is cancelled on the side that has a
 * neighbour — see .chrome-divider in styles.css); two neighbouring controls
 * cost one gutter.
 */
export function rowWidth(items, { gap, inset }) {
  let total = 0;
  let previous = null;
  for (const item of items) {
    if (item.kind === 'divider') {
      total += 1 + 2 * inset;
    } else {
      total += item.width;
      if (previous && previous.kind !== 'divider') total += gap;
    }
    previous = item;
  }
  return total;
}

/**
 * Fit one settings row into `available` px: loose gutters, then tight ones,
 * then labels collapse (least useful first), then settings move into More
 * (least important first).
 *
 * `row` is the settings row in order. Each entry is `{ kind: 'divider', slot? }`
 * or `{ kind: 'item', width, slot? }`. An entry with `slot` belongs to that
 * setting (a divider with a slot goes with it). Slot entries carry
 * `widths: { full, compact }` (measured or guessed) and `canCompact` (false
 * while it shows "Mixed").
 * @returns {{ tight: boolean, compact: string[], overflow: string[], fits: boolean,
 *   width: number }} `width` is the chosen row's width.
 */
export function fitSettingsRow(row, available) {
  const slotsPresent = [...new Set(row.filter((entry) => entry.slot).map((entry) => entry.slot))];

  const widthOf = (compactSet, overflowSet, spacing) => {
    const items = [];
    for (const entry of row) {
      if (entry.slot && overflowSet.has(entry.slot)) continue;
      if (entry.kind === 'divider') { items.push(entry); continue; }
      if (entry.slot) {
        const useCompact = compactSet.has(entry.slot) && entry.canCompact !== false;
        items.push({ kind: 'item', width: useCompact ? entry.widths.compact : entry.widths.full });
      } else {
        items.push(entry);
      }
    }
    if (overflowSet.size > 0) items.push({ kind: 'item', width: MORE_BUTTON_WIDTH });
    return rowWidth(items, spacing);
  };
  const result = (tight, compact, overflow, fits) => ({
    tight,
    compact: [...compact],
    overflow: [...overflow],
    fits,
    width: widthOf(new Set(compact), new Set(overflow), tight ? TIGHT_SPACING : LOOSE_SPACING),
  });
  const empty = new Set();

  if (widthOf(empty, empty, LOOSE_SPACING) <= available) return result(false, empty, empty, true);
  // Stage 1: tighter gutters.
  if (widthOf(empty, empty, TIGHT_SPACING) <= available) return result(true, empty, empty, true);
  // Stage 2: collapse labels one pill at a time.
  const compact = new Set();
  const compactCandidates = COMPACT_ORDER.filter((id) => {
    if (!slotsPresent.includes(id)) return false;
    return row.some((entry) => entry.slot === id && entry.kind === 'item' && entry.canCompact !== false);
  });
  for (const id of compactCandidates) {
    compact.add(id);
    if (widthOf(compact, empty, TIGHT_SPACING) <= available) return result(true, compact, empty, true);
  }
  // Stage 3: move settings into More, least important first.
  const overflow = new Set();
  for (const id of OVERFLOW_ORDER) {
    if (!slotsPresent.includes(id)) continue;
    overflow.add(id);
    if (widthOf(compact, overflow, TIGHT_SPACING) <= available) {
      // With room freed by More, give labels back — most useful first — for
      // as long as the row still fits.
      const kept = new Set([...compact].filter((c) => !overflow.has(c)));
      for (const id of [...COMPACT_ORDER].reverse()) {
        if (!kept.has(id)) continue;
        kept.delete(id);
        if (widthOf(kept, overflow, TIGHT_SPACING) > available) kept.add(id);
      }
      return result(true, kept, overflow, true);
    }
  }
  return result(true, [...compact].filter((c) => !overflow.has(c)), overflow, false);
}

/**
 * Pick the tool bar's layout (row 1). RULED 2026-09-26 owner: fixed centred
 * groups + animated loadouts (w47) — the Draw / Shapes / Text icons are
 * centred on the canvas span and stay put whatever tool is chosen; the
 * loadout grows rightward from their right edge. RULED 2026-09-27 owner:
 * Pan/Select beside the groups (w48) — Pan / Select hang off the icons' left
 * edge, so the icons stop where Pan / Select would meet Undo/Redo.
 *
 * Nothing here reads the loadout showing NOW: the room kept for it is the
 * widest one (`loadoutReserve`), so the answer is the same for every tool,
 * pick and selection at a given window width and set of open panels. (The
 * Pan / Select block is the same width in every state.)
 *
 * @param {object} input
 * @param {number} input.barWidth       the tool bar's width
 * @param {number} input.startRight     Redo's right edge (bar coordinates)
 * @param {number} [input.leftBlockWidth] Pan / Select and their rule, hung
 *   off the icons' left edge
 * @param {number} input.exportLeft     Export's left edge (bar coordinates)
 * @param {number} input.clusterWidth   Draw / Shapes / Text icons
 * @param {number} [input.loadoutReserve] room kept right of the icons for the
 *   widest loadout and its rule
 * @param {number} [input.spanLeft]     the canvas span, bar coordinates
 * @param {number} [input.spanRight]
 * @param {number} [input.clusterNaturalLeft] where the icons sit with no
 *   shift (the bar centres them); defaults to the bar's centre
 * @returns {{ anchor: 'center'|'start', shift: number, clusterLeft: number }}
 *   `clusterLeft` is where the icons' left edge lands (bar coordinates);
 *   `shift` is how far that is LEFT of their natural spot (negative =
 *   right). `anchor` is 'start' when the widest loadout's room, or Undo /
 *   Redo, pushed the icons off the canvas centre.
 */
export function planTopBar({
  barWidth,
  startRight,
  leftBlockWidth = 0,
  exportLeft,
  clusterWidth,
  loadoutReserve = WIDEST_SUBTOOLS_WIDTH,
  spanLeft = 0,
  spanRight = barWidth,
  clusterNaturalLeft = (barWidth - clusterWidth) / 2,
}) {
  const minLeft = startRight + START_GAP + leftBlockWidth;
  const maxLeft = exportLeft - EDGE_CLEARANCE - loadoutReserve - clusterWidth;
  let clusterLeft = (spanLeft + spanRight) / 2 - clusterWidth / 2;
  let anchor = 'center';
  if (clusterLeft > maxLeft) { clusterLeft = maxLeft; anchor = 'start'; }
  // Pan / Select never over Undo/Redo, even if that leaves the widest
  // loadout short of room (a window a few px wider than the phone layout).
  if (clusterLeft < minLeft) { clusterLeft = minLeft; anchor = 'start'; }
  clusterLeft = Math.round(clusterLeft);
  const shift = clusterNaturalLeft - clusterLeft;
  return { anchor, shift: Math.abs(shift) < 0.01 ? 0 : shift, clusterLeft };
}

/**
 * Where a row of `width` starts when centred on `centre` (row coordinates),
 * kept between `minLeft` and the row's right inset. RULED 2026-09-27 owner:
 * rows 2/3 centred, animated (w48). `centre` is the group icons' centre; with
 * none measured yet, the middle of the uncovered span. A row too wide for the
 * span keeps `minLeft` and runs off the right.
 */
export function centredRowLeft({ usableLeft, usableRight, centre, width, minLeft = usableLeft + ROW_INSET }) {
  const middle = Number.isFinite(centre) ? centre : (usableLeft + usableRight) / 2;
  return Math.round(Math.max(minLeft, Math.min(middle - width / 2, usableRight - ROW_INSET - width)));
}

/**
 * Pick the formatting row's layout (row 2). RULED 2026-09-27 owner: rows 2/3
 * centred, animated (w48, was w47's fixed start under the icons) — the
 * settings are centred under the group icons (`centre`), and fit into the
 * whole uncovered span in the w42 order.
 *
 * @param {object} input
 * @param {number} input.usableLeft   left edge of the row not under a side
 *   panel (row coordinates)
 * @param {number} input.usableRight  right edge of the row not under a panel
 * @param {number} [input.centre]     the group icons' centre (row coordinates)
 * @param {Array}  input.row  the settings row in order (see fitSettingsRow)
 * @param {number} [input.width] the row's drawn width, when the caller knows
 *   it (measured with this very plan applied); otherwise it is worked out
 * @returns {{ left: number, width: number, tight: boolean, compact: string[],
 *   overflow: string[], fits: boolean }}
 */
export function planFormatRow({
  usableLeft,
  usableRight,
  centre,
  row,
  width,
}) {
  const minLeft = usableLeft + ROW_INSET;
  const rightLimit = usableRight - ROW_INSET;
  const fit = fitSettingsRow(row, rightLimit - minLeft);
  const drawn = Number.isFinite(width) ? width : fit.width;
  const left = centredRowLeft({ usableLeft, usableRight, centre, width: drawn });
  return { left, ...fit, width: drawn };
}

/**
 * Where the text bar's controls (row 3) start. RULED 2026-09-27 owner: rows
 * 2/3 centred, animated (w48) — centred like row 2, keeping room left of them
 * for the "Text" caption. A bar that would run past the row's inset slides
 * left just enough; one too wide for the span keeps its start (caption room)
 * and runs off the right. (Owner Test 41: the bar now steps down first —
 * planTextRowStep — so that only happens beside a side panel too wide to
 * leave room for even its last step.) `caption: false` once the caption has
 * gone (the no-caption step).
 *
 * @param {object} input
 * @param {number} input.usableLeft  row coordinates, as planFormatRow
 * @param {number} input.usableRight
 * @param {number} [input.centre]    the group icons' centre (row coords)
 * @param {number} input.width       the controls' drawn width
 * @returns {number} the controls' left edge (row coordinates)
 */
export function planTextRow({ usableLeft, usableRight, centre, width, caption = true }) {
  return centredRowLeft({
    usableLeft, usableRight, centre, width, minLeft: usableLeft + ROW_INSET + (caption ? TEXT_ROW_CAPTION_ROOM : 0),
  });
}

/**
 * Narrow text bar (owner Test 41, 2026-10-04). Owner: "around the 780-pixel
 * mark, the more I shrink it, it doesn't really do anything. I can keep
 * bringing the right rail closer in until it covers ... the alignment tool for
 * text." Row 3 used to keep its full width and run under the right rail (or an
 * open side panel). It now gives ground in steps, each one only once the step
 * before it no longer fits the room it has (the row between the rails, less
 * any open side panel, less its insets and the "Text" caption room):
 *
 *   0 full          as drawn at normal widths (602px with both alignments);
 *   1 tight         gutters 6 -> 4px and the rules' inset 8 -> 4px, the same
 *                   tightening row 2 does first;
 *   2 fold-vertical top / middle / bottom become one pill showing the current
 *                   one (the rarest setting goes first);
 *   3 fold-align    left / center / right become one pill the same way;
 *   4 short-font    the font-name pill goes 104 -> 76px (a long name ends in
 *                   "..."; its list keeps the full width);
 *   5 fold-style    B / I / U / S become one pill whose card holds the four
 *                   toggles;
 *   6 one-colour    the three colour discs and the custom disc become one
 *                   disc in the current colour, which opens the same picker
 *                   (its presets include the three);
 *   7 no-caption    last resort: the "Text" caption goes, so its room does.
 *
 * Steps 2-7 are only reached beside an open side panel: with none open the
 * row fits at "tight" all the way down to the phone switch (721px).
 *
 * Every number is a fixed CSS width (the colour discs, the pills, the 22px
 * toggles), so the row's width at each step is known without measuring, and
 * the step depends only on the room, never on the row's own width: it cannot
 * flip back and forth.
 */
export const TEXT_ROW_STEPS = ['full', 'tight', 'fold-vertical', 'fold-align', 'short-font', 'fold-style', 'one-colour', 'no-caption'];

/** The text bar's fixed widths (styles.css tokens), px. */
export const TEXT_ROW_PARTS = Object.freeze({
  colours: 100, // three discs + the custom disc: 4 * 22 + 3 * 4
  oneColour: 22, // one disc
  font: 104, // --chrome-field-w-font
  shortFont: 76,
  size: 62, // --chrome-field-w-fontsize
  toggle: 22, // --chrome-text-toggle-w
  // A folded group: a compact pill — 8px inset, 14px glyph, 6px gutter, 9px
  // chevron, 6px inset.
  fold: 43,
});

const stepIndex = (step) => (typeof step === 'number' ? step : Math.max(0, TEXT_ROW_STEPS.indexOf(step)));

/**
 * What the text bar draws at `step`: { tight, foldVertical, foldAlign,
 * shortFont, foldStyle, oneColour, caption }.
 */
export function textRowLook(step) {
  const at = stepIndex(step);
  return {
    step: TEXT_ROW_STEPS[at],
    tight: at >= 1,
    foldVertical: at >= 2,
    foldAlign: at >= 3,
    shortFont: at >= 4,
    foldStyle: at >= 5,
    oneColour: at >= 6,
    caption: at < 7,
  };
}

/**
 * The text bar's controls' width at `step` (the caption hangs outside them).
 * `verticalAlign: false` for a callout, which has no top / middle / bottom.
 */
export function textRowWidth(step, { verticalAlign = true } = {}) {
  const look = textRowLook(step);
  const P = TEXT_ROW_PARTS;
  const toggles = (n) => Array.from({ length: n }, () => ({ kind: 'item', width: P.toggle }));
  const fold = { kind: 'item', width: P.fold };
  const divider = { kind: 'divider' };
  const items = [
    { kind: 'item', width: look.oneColour ? P.oneColour : P.colours }, divider,
    { kind: 'item', width: look.shortFont ? P.shortFont : P.font }, { kind: 'item', width: P.size }, divider,
    ...(look.foldStyle ? [fold] : toggles(4)), divider,
    ...(look.foldAlign ? [fold] : toggles(3)),
  ];
  if (verticalAlign) items.push(divider, ...(look.foldVertical ? [fold] : toggles(3)));
  return rowWidth(items, look.tight ? TIGHT_SPACING : LOOSE_SPACING);
}

/**
 * Pick the text bar's step for a row whose uncovered span is `span` px wide
 * (row coordinates: usableRight - usableLeft). The first step whose controls,
 * the row's two insets and (while it shows) the caption room fit; the last
 * step when none does.
 * @returns {{ step: string, index: number, width: number, fits: boolean }}
 */
export function planTextRowStep(span, { verticalAlign = true } = {}) {
  const room = (index) => span - 2 * ROW_INSET - (textRowLook(index).caption ? TEXT_ROW_CAPTION_ROOM : 0);
  for (let index = 0; index < TEXT_ROW_STEPS.length; index += 1) {
    const width = textRowWidth(index, { verticalAlign });
    if (width <= room(index)) return { step: TEXT_ROW_STEPS[index], index, width, fits: true };
  }
  const last = TEXT_ROW_STEPS.length - 1;
  return { step: TEXT_ROW_STEPS[last], index: last, width: textRowWidth(last, { verticalAlign }), fits: false };
}

/**
 * SURVEY BAR (the strip under the tool bar in Survey).
 *   [gold glyph + template v] .......  [Module v] | (C)(D)(AC) | Reuse  ....... [Done]
 *    ^ start end piece                 ^------- the CENTRE group -------^        ^ end piece
 * Owner 2026-10-13: "When you ... open the survey panel, the panel pushes the
 * sub-toolbar out of place ... The sub-toolbar must remain fixed." / "The
 * things in the center should stay in the center. The peripherals on the left
 * and right, like the templates dropdown and the done button, those can move
 * in and out." / "It should sit centered, just like the other annotation tools
 * sit centered." So:
 *   - the CENTRE group (module menu, category chips, Reuse) is centred on the
 *     tool bar's own centre (the Draw / Shapes / Text icons - the same centre
 *     rows 2 and 3 use) and NEVER moves when a side panel opens or closes;
 *   - the two END pieces (template menu at the left end, Done at the right)
 *     sit at the edges of what the open panels leave visible, and move in and
 *     out with them.
 * Rule: nothing ever overlaps, runs under an open panel, or hides out of
 * sight. When room runs out the END pieces give ground first (they are what
 * moves anyway): the template name ends in "...", then goes (the gold glyph
 * and its chevron stay, and still open the menu); Done becomes its check
 * glyph. Then the centre, which stays centred whatever it shows:
 *   0 full           everything at its natural width;
 *   1 short-module   the module name ends in "..." (down to a few letters);
 *   2 compact-reuse  Reuse keeps its switch and drops its word (the tooltip
 *                    and the accessible name still say "Reuse category");
 *   3 fold           the module menu and Reuse move into a "..." (More) menu
 *                    that joins the template menu at the left end (so the
 *                    centre is the chips alone);
 *   4 tight          the chips' gutters tighten (6px -> 4px);
 *   5 fewer          last resort (a narrow window): fewer chips before the
 *                    "All N" chip - every category is still one click away
 *                    in its list. (Lead decision 2026-10-13: the old sideways
 *                    scroll, which hid chips out of sight, is gone.)
 * The centre's step is planned for the WORST case - both side panels open -
 * so opening or closing a panel never changes what it shows, only the window
 * width does. Only when that worst case would leave fewer than 4 chips and
 * "All N" (a narrow window, under ~1000px) is it planned for the panels
 * actually open, so a narrow window with its panels shut does not lose
 * chips for nothing.
 * Which chips show is otherwise decided by COUNT, never by width
 * (utils/surveyPickLists.js): up to 8, all; above 8, 7 and "All N". The
 * entity bar under it (planSurveyBar's `entityRowMax`) follows the same rule
 * in its own room.
 */
export const SURVEY_BAR_STEPS = ['full', 'short-module', 'compact-reuse', 'fold', 'tight', 'fewer'];

export const SURVEY_BAR_PARTS = Object.freeze({
  inset: 8, // the bar's own inset at each end
  gap: 8, // between the centre group and an end piece
  divider: 17, // .chrome-divider: 1px + 8px each side
  // Template trigger: 6px inset, 14px glyph, 6px, the name, 6px, 9px chevron, 6px.
  templateChrome: 47,
  templateGlyph: 41, // the same with no name
  templateMax: 260,
  // Module pill: 21px start inset (centres the name), the name, 6px, 9px chevron, 6px.
  moduleChrome: 42,
  moduleMax: 220,
  nameMin: 40, // the fewest pixels of a name worth showing ("Exis...")
  reuse: 67, // the switch and its word
  reuseCompact: 28, // the switch alone
  more: 28, // the More (...) button
  moreGap: 4, // between the template menu and More
  done: 50,
  doneGlyph: 32,
  chip: 28, // a category chip (wider when its initials need it: measured)
  chipGap: 6, // --chrome-tool-gap
  chipGapTight: 4,
  allPadding: 16, // the "All N" chip: its words plus 8px each side
  allChip: 46, // "All 40" (a guess; the hook measures the words)
  empty: 80, // "No categories"
  swatch: 22, // an entity swatch (the tool bar's colour disc)
  swatchGap: 6,
  slack: 2, // text is measured, not drawn: a hair of room for rounding
});

/** The side panels drawn over the bar (worst case for the centre's plan). */
export const SURVEY_BAR_PANEL_INSETS = Object.freeze({ left: 272, right: 320 });

/** The most items a bar row draws (7 and "All N" above it: surveyPickLists). */
const ROW_MAX = 8;
/** The fewest slots (4 chips and "All N") a row keeps for the WORST case
 * before the plan follows the panels actually open instead. */
const ROW_STABLE_MIN = 5;

/**
 * Width of a bar row of `count` items, drawing at most `max` slots: up to
 * `max` items all show; above it, `max - 1` items and the "All N" chip.
 */
export function surveyRowWidth({ count = 0, item, gap, allChip = SURVEY_BAR_PARTS.allChip, empty = 0, max = ROW_MAX }) {
  if (!(count > 0)) return empty;
  if (count <= max) return count * item + (count - 1) * gap;
  const shown = Math.max(0, max - 1);
  return shown * (item + gap) + allChip;
}

/**
 * The largest `max` (1..8) whose row fits `room`, or 0 when not even the
 * "All N" chip alone does.
 */
export function surveyRowMaxFor(room, row) {
  for (let max = ROW_MAX; max >= 1; max -= 1) {
    if (surveyRowWidth({ ...row, max }) + SURVEY_BAR_PARTS.slack <= room) return max;
  }
  return 0;
}

/**
 * What the survey bar's centre draws at `step`.
 * @returns {{ step: string, index: number, module: 'full'|'short'|'more',
 *   reuse: 'full'|'compact'|'more', more: boolean, tight: boolean, fewer: boolean }}
 */
export function surveyBarLook(step) {
  const at = typeof step === 'number' ? step : Math.max(0, SURVEY_BAR_STEPS.indexOf(step));
  return {
    step: SURVEY_BAR_STEPS[at],
    index: at,
    module: at >= 3 ? 'more' : at >= 1 ? 'short' : 'full',
    reuse: at >= 3 ? 'more' : at >= 2 ? 'compact' : 'full',
    more: at >= 3,
    tight: at >= 4,
    fewer: at >= 5,
  };
}

/** The category chips' row for `sizes` (see planSurveyBar) at gap `gap`. */
const categoryRow = ({ categoryCount = 0, chip = SURVEY_BAR_PARTS.chip, allChip = SURVEY_BAR_PARTS.allChip, empty = SURVEY_BAR_PARTS.empty } = {}, gap) => ({
  count: categoryCount, item: chip, gap, allChip, empty,
});

/**
 * The centre group's width at `step` (`rowMax`: the chips' row limit, 8
 * except at the last step). `moduleText` is the LONGEST module name's text
 * width (the pill is sized to it).
 * @returns {{ centre: number, moduleFull: number, moduleShort: number, categories: number }}
 */
export function surveyBarCentreWidth(step, sizes = {}, rowMax = ROW_MAX) {
  const P = SURVEY_BAR_PARTS;
  const look = surveyBarLook(step);
  const moduleFull = Math.min(P.moduleMax, P.moduleChrome + (sizes.moduleText || 0));
  const moduleShort = Math.min(moduleFull, P.moduleChrome + P.nameMin);
  const categories = surveyRowWidth({ ...categoryRow(sizes, look.tight ? P.chipGapTight : P.chipGap), max: rowMax });
  let centre = categories;
  if (look.module !== 'more') {
    centre += (look.module === 'full' ? moduleFull : moduleShort) + P.divider;
    centre += P.divider + (look.reuse === 'full' ? P.reuse : P.reuseCompact);
  }
  return { centre, moduleFull, moduleShort, categories };
}

/**
 * Plan the survey bar and the entity bar under it (all in bar coordinates, px).
 * @param {object} input
 * @param {number} input.barWidth
 * @param {number} input.centre       the tool bar's centre
 * @param {number} [input.insetLeft]  the side panels open over the bar now
 * @param {number} [input.insetRight]
 * @param {number} [input.templateText]  the names' text widths
 * @param {number} [input.moduleText]
 * @param {number} [input.categoryCount] the chosen module's categories
 * @param {number} [input.chip]          the widest category chip
 * @param {number} [input.allChip]       the categories' "All N" chip
 * @param {number} [input.empty]         "No categories"
 * @param {number} [input.entityCount]   the template's entities
 * @param {number} [input.entityAllChip] the entities' "All N" chip
 * @param {number} [input.swatchGap]     the entity swatches' gutter as drawn
 *   (6px; a touch-first tablet draws the roomier colour gutter, touchTargets.css)
 * @returns {{ step: string, index: number, stable: boolean, centreWidth: number,
 *   rowMax: number, template: 'full'|'glyph', templateRoom: number,
 *   done: 'word'|'glyph', entityRowMax: number, entityStable: boolean,
 *   moduleShort: number }}
 */
export function planSurveyBar({
  barWidth,
  centre = barWidth / 2,
  insetLeft = 0,
  insetRight = 0,
  insetLeftMax = SURVEY_BAR_PANEL_INSETS.left,
  insetRightMax = SURVEY_BAR_PANEL_INSETS.right,
  templateText = 0,
  moduleText = 0,
  categoryCount = 0,
  chip = SURVEY_BAR_PARTS.chip,
  allChip = SURVEY_BAR_PARTS.allChip,
  empty = SURVEY_BAR_PARTS.empty,
  entityCount = 0,
  entityAllChip = SURVEY_BAR_PARTS.allChip,
  swatchGap = SURVEY_BAR_PARTS.swatchGap,
}) {
  const P = SURVEY_BAR_PARTS;
  const sizes = { moduleText, categoryCount, chip, allChip, empty };
  // The start end piece's smallest look: the template glyph, and from the
  // fold step on the More menu beside it.
  const startMin = (index) => P.templateGlyph + (surveyBarLook(index).more ? P.moreGap + P.more : 0);
  // Half the room the centre may take around its fixed spot, keeping the end
  // pieces' smallest looks (glyph, More, check) and a gutter clear of it.
  const halfRoom = (left, right, index) => Math.min(
    centre - left - P.inset - startMin(index) - P.gap,
    barWidth - right - P.inset - P.doneGlyph - P.gap - centre,
  );
  const last = SURVEY_BAR_STEPS.length - 1;
  // The first step that fits, and at the last step the most chips that do.
  const pick = (left, right) => {
    for (let index = 0; index < last; index += 1) {
      if (surveyBarCentreWidth(index, sizes).centre + P.slack <= 2 * halfRoom(left, right, index)) {
        return { index, rowMax: ROW_MAX };
      }
    }
    const rowMax = surveyRowMaxFor(2 * halfRoom(left, right, last), categoryRow(sizes, P.chipGapTight));
    return { index: last, rowMax };
  };
  const worstL = Math.max(insetLeft, insetLeftMax);
  const worstR = Math.max(insetRight, insetRightMax);
  let { index, rowMax } = pick(worstL, worstR);
  let stable = true;
  if (index === last && rowMax < ROW_STABLE_MIN) {
    // Not even 4 chips and "All N" sit beside both panels (a narrow window):
    // plan for the panels actually open, so shut panels never cost chips.
    ({ index, rowMax } = pick(insetLeft, insetRight));
    rowMax = Math.max(1, rowMax);
    stable = false;
  }
  const { centre: natural, moduleShort } = surveyBarCentreWidth(index, sizes, rowMax);
  const drawnHalf = natural / 2;
  // The start side's room (the template menu, and More once folded).
  const templateRoom = Math.max(0, Math.floor(centre - drawnHalf - P.gap - insetLeft - P.inset));
  const moreRoom = surveyBarLook(index).more ? P.moreGap + P.more : 0;
  const templateNeed = P.templateChrome + Math.min(templateText, P.nameMin) + moreRoom;
  const doneRoom = barWidth - insetRight - P.inset - P.gap - (centre + drawnHalf);
  // The entity bar under it: centred on the same spot, never under a panel,
  // planned for the worst case the same way.
  const entityRoom = (left, right) => 2 * Math.min(centre - left - P.inset, barWidth - right - P.inset - centre);
  const entityRow = { count: entityCount, item: P.swatch, gap: Number.isFinite(swatchGap) && swatchGap >= 0 ? swatchGap : P.swatchGap, allChip: entityAllChip };
  let entityRowMax = surveyRowMaxFor(entityRoom(worstL, worstR), entityRow);
  let entityStable = true;
  if (entityRowMax < ROW_STABLE_MIN) {
    entityRowMax = Math.max(1, surveyRowMaxFor(entityRoom(insetLeft, insetRight), entityRow));
    entityStable = false;
  }
  return {
    step: SURVEY_BAR_STEPS[index],
    index,
    stable,
    centreWidth: natural,
    rowMax,
    template: templateRoom >= templateNeed ? 'full' : 'glyph',
    templateRoom: Math.min(templateRoom, P.templateMax + moreRoom),
    done: doneRoom >= P.done ? 'word' : 'glyph',
    entityRowMax,
    entityStable,
    moduleShort,
  };
}

/** The desktop rails either side of rows 2 and 3 (48px each). */
export const DESKTOP_RAIL_WIDTH = 48;

/* Owner Test 41 (2026-10-04): the desktop rows must never be covered. With
 * every step above they fit every window from 720px up even beside an open
 * side panel, and with no side panel down to minDesktopWindowWidth() = 554px.
 * 720px used to be where the phone layout took over; since 2026-10-13 the
 * screen picks the layout (utils/layoutMode.js), so a desktop window dragged
 * narrower than 554px keeps the desktop layout and its rows can run into each
 * other there (the owner's call: never switch a desktop to the phone layout).
 */

/**
 * The narrowest window (no side panel open) at which every desktop row fits in
 * its most compact look while keeping the "Text" caption: the tool bar (Undo /
 * Redo, Pan / Select, the group icons, the widest loadout, Export) and the
 * text bar (rows 2 and 3 run between the rails). Row 2 always fits: its
 * settings move into More.
 */
export function minDesktopWindowWidth({
  undoRedoRight = 72,
  leftBlockWidth = 79,
  clusterWidth = 96,
  exportWidth = 28,
  exportInset = 10,
} = {}) {
  const topBar = undoRedoRight + START_GAP + leftBlockWidth + clusterWidth
    + WIDEST_SUBTOOLS_WIDTH + EDGE_CLEARANCE + exportWidth + exportInset;
  const keepsCaption = TEXT_ROW_STEPS.indexOf('no-caption') - 1;
  const textRow = textRowWidth(keepsCaption) + 2 * ROW_INSET + TEXT_ROW_CAPTION_ROOM + 2 * DESKTOP_RAIL_WIDTH;
  return Math.max(topBar, textRow);
}

/**
 * Where to put a popover so it opens UNDER the control that opened it and
 * stays wholly inside the window. Centred on the opener, then slid sideways
 * just enough to keep `margin` clear of either window edge; flipped above the
 * opener only when it does not fit below and there is more room above; and as
 * a last resort pinned `margin` from the top so its top edge is never lost.
 *
 * @returns {{ left: number, top: number, placement: 'below'|'above' }}
 */
export function computeAnchoredPopoverPosition({
  anchorRect,
  popoverWidth,
  popoverHeight,
  viewportWidth,
  viewportHeight,
  gap = 10,
  margin = 8,
}) {
  const anchorCentre = anchorRect.left + anchorRect.width / 2;
  const maxLeft = viewportWidth - margin - popoverWidth;
  let left = anchorCentre - popoverWidth / 2;
  left = Math.min(left, maxLeft);
  left = Math.max(left, margin);

  const below = anchorRect.bottom + gap;
  const roomBelow = viewportHeight - margin - below;
  const roomAbove = anchorRect.top - gap - margin;
  let top = below;
  let placement = 'below';
  if (popoverHeight > roomBelow && roomAbove > roomBelow) {
    top = anchorRect.top - gap - popoverHeight;
    placement = 'above';
  }
  top = Math.min(top, viewportHeight - margin - popoverHeight);
  top = Math.max(top, margin);
  return { left: Math.round(left), top: Math.round(top), placement };
}

/**
 * The text-mark palette opens under the control that opened it like every
 * other popover — unless there it would cover the very text the user has
 * selected, which they need to see while they choose. Returns the spot under
 * the opener, or null when that spot covers `avoidRect` (the caller then falls
 * back to the palette's own "clear of the selection" placement).
 */
export function placeUnderOpenerAvoiding({ avoidRect, ...input }) {
  const position = computeAnchoredPopoverPosition(input);
  if (!avoidRect) return position;
  const left = Number(avoidRect.left);
  const top = Number(avoidRect.top);
  const right = Number(avoidRect.right ?? (left + Number(avoidRect.width)));
  const bottom = Number(avoidRect.bottom ?? (top + Number(avoidRect.height)));
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return position;
  const covers = position.left < right
    && position.left + input.popoverWidth > left
    && position.top < bottom
    && position.top + input.popoverHeight > top;
  return covers ? null : position;
}
