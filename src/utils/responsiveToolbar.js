/**
 * Responsive desktop tool bar (w42, 2026-09-26) — the pure maths.
 *
 * Owner report: in a Chrome split view (~840px wide) the tool bar's settings
 * ran into the Export button, and the colour picker opened off to the right,
 * half under the right rail. Coordinator ruling: never overlap, never switch to
 * the phone layout on a desktop window, and never change the bar at normal
 * widths. As the window narrows the bar gives ground in a fixed order:
 *
 *   0. Wide window (>= CENTERED_MIN_WIDTH) and everything fits: exactly the
 *      bar as it has always been — the tool icons centred, Undo/Redo pinned
 *      left, Export pinned right.
 *   1. The tool icons stop being centred and sit just right of Undo/Redo, so
 *      the settings get the whole rest of the bar. Chosen by WIDTH alone, never
 *      by the armed tool, so switching tools never moves an icon.
 *   2. The gutters between the setting pills and the rules tighten.
 *   3. Secondary labels collapse, one pill at a time, least useful first
 *      ("Solid" becomes just the line it draws, "2 pt" becomes "2").
 *   4. The least important settings move, one at a time, into a single "More"
 *      menu (the ⋯ button at the end of the settings). Same controls inside,
 *      same behaviour. Tools, colours and Export are never moved.
 *
 * Below the phone breakpoint (720px) the phone layout takes over, as before.
 * The hook that measures the DOM and applies a plan is useResponsiveToolbar.
 */

/** At or above this bar width the tool icons stay centred (the look the bar has
 * always had). The widest settings row — the Arrow tool's, 502px — fits beside
 * the centred icons from about 1192px, so every tool keeps the centred look at
 * 1200 and above, and 1280 / 1440 are untouched. Below it the icons sit
 * left for EVERY tool, so the icons never jump when you change tool. */
export const CENTERED_MIN_WIDTH = 1200;

/** Clear space kept between the last setting (or More) and Export, and between
 * Undo/Redo and the Pan / Select block. */
export const EDGE_CLEARANCE = 8;

/** Space between Redo and Pan once the icons sit left. */
export const START_GAP = 12;

/** Gutters: the normal settings row, and the tightened one (stage 2). */
export const LOOSE_SPACING = { gap: 6, inset: 8 };
export const TIGHT_SPACING = { gap: 4, inset: 4 };

/** The More (⋯) button: the shared 28px chrome control. */
export const MORE_BUTTON_WIDTH = 28;

/**
 * Every setting that may collapse or move, in the order the row draws them.
 * `keep` is its priority: the HIGHER, the longer it stays in the bar. `label`
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
 * Pick the bar's layout.
 *
 * @param {object} input
 * @param {number} input.barWidth       the tool bar's width
 * @param {number} input.undoRight      Redo's right edge (bar coordinates)
 * @param {number} input.exportLeft     Export's left edge (bar coordinates)
 * @param {number} input.clusterWidth   Draw / Shapes / Text icons
 * @param {number} input.leftBlockWidth Pan / Select block (and its rule)
 * @param {Array}  input.row  the settings row in order. Each entry is
 *   `{ kind: 'divider', slot? }` or `{ kind: 'item', width, slot? }`. An entry
 *   with `slot` belongs to that setting (a divider with a slot goes with it).
 *   Slot entries carry `widths: { full, compact }` (measured or guessed) and
 *   `canCompact` (false while it shows "Mixed").
 * @returns {{ anchor: 'center'|'start', shift: number, tight: boolean,
 *   compact: string[], overflow: string[], fits: boolean }}
 *   `shift` is how far the icon cluster moves LEFT of centre.
 */
export function planToolbarLayout({
  barWidth,
  undoRight,
  exportLeft,
  clusterWidth,
  leftBlockWidth,
  row,
}) {
  const rightLimit = exportLeft - EDGE_CLEARANCE;
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

  const center = barWidth / 2;
  const centredLeftEdge = center - clusterWidth / 2 - leftBlockWidth;
  const centredSettingsLeft = center + clusterWidth / 2;
  const empty = new Set();

  if (barWidth >= CENTERED_MIN_WIDTH
    && centredLeftEdge >= undoRight + EDGE_CLEARANCE
    && centredSettingsLeft + widthOf(empty, empty, LOOSE_SPACING) <= rightLimit) {
    return { anchor: 'center', shift: 0, tight: false, compact: [], overflow: [], fits: true };
  }

  // Stage 1: the icons sit just right of Undo / Redo.
  const clusterLeft = undoRight + START_GAP + leftBlockWidth;
  const shift = Math.max(0, (center - clusterWidth / 2) - clusterLeft);
  const settingsLeft = center - clusterWidth / 2 - shift + clusterWidth;
  const available = rightLimit - settingsLeft;
  const result = (tight, compact, overflow, fits) => ({
    anchor: 'start', shift, tight, compact: [...compact], overflow: [...overflow], fits,
  });

  if (widthOf(empty, empty, LOOSE_SPACING) <= available) return result(false, empty, empty, true);
  // Stage 2: tighter gutters.
  if (widthOf(empty, empty, TIGHT_SPACING) <= available) return result(true, empty, empty, true);
  // Stage 3: collapse labels one pill at a time.
  const compact = new Set();
  const compactCandidates = COMPACT_ORDER.filter((id) => {
    if (!slotsPresent.includes(id)) return false;
    return row.some((entry) => entry.slot === id && entry.kind === 'item' && entry.canCompact !== false);
  });
  for (const id of compactCandidates) {
    compact.add(id);
    if (widthOf(compact, empty, TIGHT_SPACING) <= available) return result(true, compact, empty, true);
  }
  // Stage 4: move settings into More, least important first.
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
