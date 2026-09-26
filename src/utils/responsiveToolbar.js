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
 *   TOOL BAR (planTopBar). The tool icons stay centred with Undo/Redo pinned
 *   left and Export pinned right — the look the bar has always had at normal
 *   widths. A group's tools hang off the right of the icons and are at most
 *   seven buttons (Shapes), so the centred look now fits at every desktop
 *   width; only if it ever did not would the icons sit just right of Undo /
 *   Redo. Chosen by WIDTH alone (the widest group's tools, never the armed
 *   group's), so switching tools never moves an icon.
 *
 *   FORMATTING ROW (planFormatRow). The settings start under the Pan button,
 *   at a spot chosen by the window (and any open side panel) alone — never by
 *   the armed tool — so the colours never jump sideways when you switch tools.
 *   Where the widest settings row (the Arrow's) would not fit from there, the
 *   start moves left, down to the row's own inset. Then the row gives ground
 *   in the w42 order, with the whole row to itself:
 *     1. the gutters between the setting pills and the rules tighten;
 *     2. secondary labels collapse, one pill at a time, least useful first
 *        ("Solid" becomes just the line it draws, "2 pt" becomes "2");
 *     3. the least important settings move, one at a time, into a single
 *        "More" menu (the ⋯ button at the end of the settings). Same controls
 *        inside, same behaviour. Colours are never moved.
 *
 * Below the phone breakpoint (720px) the phone layout takes over, as before.
 * The hook that measures the DOM and applies both plans is useResponsiveToolbar.
 */

/** The widest a group's tools get in the tool bar: Shapes' seven 28px buttons
 * on the 6px tool gutter, plus the rule (1px + 8px each side) that fences them
 * off from the group icons. 7 * 28 + 6 * 6 + 17 = 249. */
export const WIDEST_SUBTOOLS_WIDTH = 249;

/** The widest formatting row: the Arrow tool's colours, rule, width, line
 * style, arrowhead and ends — 485px on the loose gutters (w42 measured 502
 * with the rule that used to lead the settings in the tool bar, which the
 * formatting row does not draw). The row's start is picked so this row fits,
 * so no other tool's row ever moves the colours. */
export const WIDEST_FORMAT_ROW = 485;

/** Clear space kept at either end of the formatting row. */
export const ROW_INSET = 10;

/** Clear space kept between the group's tools and Export, and between
 * Undo/Redo and the Pan / Select block. */
export const EDGE_CLEARANCE = 8;

/** Space between Redo and Pan once the icons sit left. */
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
 * @returns {{ tight: boolean, compact: string[], overflow: string[], fits: boolean }}
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
    tight, compact: [...compact], overflow: [...overflow], fits,
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
 * Pick the tool bar's layout (row 1).
 *
 * @param {object} input
 * @param {number} input.barWidth       the tool bar's width
 * @param {number} input.undoRight      Redo's right edge (bar coordinates)
 * @param {number} input.exportLeft     Export's left edge (bar coordinates)
 * @param {number} input.clusterWidth   Draw / Shapes / Text icons
 * @param {number} input.leftBlockWidth Pan / Select block (and its rule)
 * @param {number} [input.subtoolsWidth] the widest group's tools — a constant,
 *   so the answer depends on the window alone
 * @returns {{ anchor: 'center'|'start', shift: number }}
 *   `shift` is how far the icon cluster moves LEFT of centre.
 */
export function planTopBar({
  barWidth,
  undoRight,
  exportLeft,
  clusterWidth,
  leftBlockWidth,
  subtoolsWidth = WIDEST_SUBTOOLS_WIDTH,
}) {
  const rightLimit = exportLeft - EDGE_CLEARANCE;
  const center = barWidth / 2;
  const centredLeftEdge = center - clusterWidth / 2 - leftBlockWidth;
  const centredRightEdge = center + clusterWidth / 2 + subtoolsWidth;
  if (centredLeftEdge >= undoRight + EDGE_CLEARANCE && centredRightEdge <= rightLimit) {
    return { anchor: 'center', shift: 0 };
  }
  // The icons sit just right of Undo / Redo.
  const clusterLeft = undoRight + START_GAP + leftBlockWidth;
  const shift = Math.max(0, (center - clusterWidth / 2) - clusterLeft);
  return { anchor: 'start', shift };
}

/**
 * Pick the formatting row's layout (row 2).
 *
 * @param {object} input
 * @param {number} input.usableLeft   left edge of the row not under a side
 *   panel (row coordinates)
 * @param {number} input.usableRight  right edge of the row not under a panel
 * @param {number} [input.preferredLeft] where the settings would like to
 *   start: under the Pan button (row coordinates)
 * @param {Array}  input.row  the settings row in order (see fitSettingsRow)
 * @param {number} [input.widestRow] the widest row any tool draws — a
 *   constant, so the start depends on the window (and panels) alone
 * @returns {{ left: number, tight: boolean, compact: string[],
 *   overflow: string[], fits: boolean }}
 */
export function planFormatRow({
  usableLeft,
  usableRight,
  preferredLeft,
  row,
  widestRow = WIDEST_FORMAT_ROW,
}) {
  const minLeft = usableLeft + ROW_INSET;
  const rightLimit = usableRight - ROW_INSET;
  const wanted = Number.isFinite(preferredLeft) ? preferredLeft : minLeft;
  const left = Math.round(Math.max(minLeft, Math.min(wanted, rightLimit - widestRow)));
  return { left, ...fitSettingsRow(row, rightLimit - left) };
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
