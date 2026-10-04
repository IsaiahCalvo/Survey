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
 * Below the phone breakpoint (PHONE_LAYOUT_MAX_WIDTH, 720px) the phone layout
 * takes over, as before.
 * The hook that measures the DOM and applies both plans is useResponsiveToolbar.
 */

/** The widest a group's tools get in the tool bar: Shapes' seven 28px buttons
 * on the 6px tool gutter, plus the rule (1px + 8px each side) that fences them
 * off from the group icons. 7 * 28 + 6 * 6 + 17 = 249. planTopBar's default
 * when the live width is not given. */
export const WIDEST_SUBTOOLS_WIDTH = 249;

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

/** The desktop rails either side of rows 2 and 3 (48px each). */
export const DESKTOP_RAIL_WIDTH = 48;

/**
 * The phone layout takes over at or below this window width (AppShell's
 * isNarrowShell and the viewer's own mobile surface, PdfjsViewerContainer).
 * Owner Test 41 (2026-10-04): the desktop rows must never be covered above it.
 * With every step above, the narrowest desktop window whose rows still fit
 * (no side panel open) is minDesktopWindowWidth() = 554px (the tool bar sets it), well under this,
 * so there is no width at which the rails cover a control. The switch itself
 * stays at 720: below it the viewer switches to its touch surface (page gaps,
 * pinch, no trackpad overscroll), which is phone behaviour, not chrome.
 */
export const PHONE_LAYOUT_MAX_WIDTH = 720;

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
