// KAL-240 — the small floating menu that appears next to a finished PDF text
// selection (Text Select): Highlight / Underline / Squiggle / Strike Through,
// then Copy. Everything here is pure so the placement rules can be tested
// without a browser; the component is components/TextSelectionQuickMenu.jsx.
//
// Placement (owner brief: copy Drawboard's feel, never cover the selection):
//   - Mouse: the menu sits ABOVE the selection, centred on it, and drops
//     BELOW only when there is no room above inside the viewer.
//   - Touch: the menu sits BELOW the selection, clear of the end handle. iOS
//     draws its own Copy / Look Up callout ABOVE a selection whenever it fits,
//     so the two never stack on top of each other. When the selection is so
//     close to the top that iOS has to put its callout below as well, ours
//     moves further down by one callout height.
//   - It never goes over the tool bars: the viewer bounds passed in already
//     start under them.

export const TEXT_SELECTION_QUICK_MENU_MARKS = Object.freeze([
  // Same order and names as the docked text-selection bar
  // (TextSelectionActionBar MARKS), so the two read as one set.
  Object.freeze({ id: 'highlight', label: 'Highlight', icon: 'formatHighlight' }),
  Object.freeze({ id: 'underline', label: 'Underline', icon: 'formatUnderline' }),
  Object.freeze({ id: 'squiggly', label: 'Squiggle', icon: 'formatSquiggle' }),
  Object.freeze({ id: 'strikeout', label: 'Strike Through', icon: 'formatStrikethrough' }),
]);

// Gap between the selection and the menu.
export const QUICK_MENU_GAP = 8;
// Extra room under a touch selection for the end handle's knob.
export const QUICK_MENU_TOUCH_HANDLE_GAP = 22;
// iOS edit-menu height (Copy / Look Up / ...), with its own little gap.
export const IOS_CALLOUT_HEIGHT = 52;
// iOS keeps its callout above the selection when this much room is free there.
export const IOS_CALLOUT_ROOM_ABOVE = 64;

const finite = (value) => Number.isFinite(Number(value));

/** Union of client rects (a Range's getClientRects()) as {left, top, right, bottom}. */
export function unionClientRects(rects) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects || []) {
    if (!rect) continue;
    const l = Number(rect.left);
    const t = Number(rect.top);
    const r = finite(rect.right) ? Number(rect.right) : l + Number(rect.width);
    const b = finite(rect.bottom) ? Number(rect.bottom) : t + Number(rect.height);
    if (![l, t, r, b].every(Number.isFinite) || r - l <= 0 || b - t <= 0) continue;
    left = Math.min(left, l);
    top = Math.min(top, t);
    right = Math.max(right, r);
    bottom = Math.max(bottom, b);
  }
  if (!Number.isFinite(left)) return null;
  return { left, top, right, bottom };
}

const rectsOverlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * Where the menu goes.
 *
 * @param {object} args
 * @param {{left:number,top:number,right:number,bottom:number}} args.selectionRect
 *   the selection's union rect in client pixels.
 * @param {{left:number,top:number,right:number,bottom:number}} args.bounds
 *   the visible viewer area (under the tool bars, above the phone's bottom bar).
 * @param {number} args.menuWidth
 * @param {number} args.menuHeight
 * @param {'fine'|'coarse'} [args.pointer] mouse or finger.
 * @param {number} [args.margin] distance kept from the bounds' edges.
 * @returns {{left:number, top:number, placement:'above'|'below'|'pinned', coversSelection:boolean} | null}
 */
export function computeTextSelectionQuickMenuPosition({
  selectionRect,
  bounds,
  menuWidth,
  menuHeight,
  pointer = 'fine',
  margin = 8,
} = {}) {
  if (!selectionRect || !bounds) return null;
  const sel = {
    left: Number(selectionRect.left),
    top: Number(selectionRect.top),
    right: Number(selectionRect.right),
    bottom: Number(selectionRect.bottom),
  };
  const box = {
    left: Number(bounds.left),
    top: Number(bounds.top),
    right: Number(bounds.right),
    bottom: Number(bounds.bottom),
  };
  if (![...Object.values(sel), ...Object.values(box)].every(Number.isFinite)) return null;
  // A selection scrolled wholly out of the viewer has nothing to point at.
  if (sel.bottom <= box.top || sel.top >= box.bottom || sel.right <= box.left || sel.left >= box.right) return null;
  const width = Math.max(1, Math.min(Number(menuWidth) || 1, box.right - box.left - margin * 2));
  const height = Math.max(1, Number(menuHeight) || 1);
  const minLeft = box.left + margin;
  const maxLeft = box.right - margin - width;
  const minTop = box.top + margin;
  const maxTop = box.bottom - margin - height;

  // Centre on the part of the selection that is on screen.
  const visibleLeft = Math.max(sel.left, box.left);
  const visibleRight = Math.min(sel.right, box.right);
  const centre = (visibleLeft + visibleRight) / 2;
  const left = Math.round(Math.max(minLeft, Math.min(maxLeft, centre - width / 2)));

  const touch = pointer === 'coarse';
  const aboveTop = sel.top - QUICK_MENU_GAP - height;
  let belowGap = QUICK_MENU_GAP + (touch ? QUICK_MENU_TOUCH_HANDLE_GAP : 0);
  // iOS falls back to drawing its callout under the selection when it has no
  // room above (measured against the whole web view, so the window top).
  if (touch && sel.top < IOS_CALLOUT_ROOM_ABOVE) belowGap += IOS_CALLOUT_HEIGHT;
  const belowTop = sel.bottom + belowGap;
  const fitsAbove = aboveTop >= minTop;
  const fitsBelow = belowTop <= maxTop;
  const order = touch ? ['below', 'above'] : ['above', 'below'];
  for (const side of order) {
    if (side === 'above' && fitsAbove) return { left, top: Math.round(aboveTop), placement: 'above', coversSelection: false };
    if (side === 'below' && fitsBelow) return { left, top: Math.round(belowTop), placement: 'below', coversSelection: false };
  }

  // The selection fills the viewer top to bottom. Pin the menu to whichever
  // edge leaves it covering the least of the selection (the menu has to be
  // somewhere; the bottom edge on a tie, where a thumb or the eye ends up).
  const pinnedLow = Math.round(Math.max(minTop, maxTop));
  const pinnedHigh = Math.round(minTop);
  const overlapAt = (top) => Math.max(0, Math.min(top + height, sel.bottom) - Math.max(top, sel.top));
  const top = overlapAt(pinnedHigh) < overlapAt(pinnedLow) ? pinnedHigh : pinnedLow;
  const menuRect = { left, top, right: left + width, bottom: top + height };
  return { left, top, placement: 'pinned', coversSelection: rectsOverlap(menuRect, sel) };
}

/**
 * Identity of a live selection, so a menu the user dismissed stays dismissed
 * until the selection itself changes (a new drag, a moved handle).
 */
export function textSelectionQuickMenuKey(selection) {
  if (!selection?.pages?.length) return '';
  return selection.pages.map((page) => {
    const range = page?.textRange;
    if (range && finite(range.start) && finite(range.end)) return `${page.pageNumber}:${range.start}-${range.end}`;
    const quads = Array.isArray(page?.quads) ? page.quads : [];
    return `${page.pageNumber}:${quads.map((q) => [q.x1, q.y1, q.x4, q.y4].map((n) => Math.round(Number(n) || 0)).join(',')).join(';')}`;
  }).join('|');
}

/**
 * Copy text with the async Clipboard API, falling back to the legacy command
 * (which copies the live native selection) where the API is missing or
 * refused — older WKWebViews and non-secure dev origins.
 */
export async function copyTextSelection(text, { clipboard, execCommand } = {}) {
  const value = String(text ?? '');
  if (!value) return false;
  const api = clipboard ?? (typeof navigator !== 'undefined' ? navigator.clipboard : null);
  if (api?.writeText) {
    try {
      await api.writeText(value);
      return true;
    } catch { /* fall through to the legacy command */ }
  }
  const legacy = execCommand ?? (typeof document !== 'undefined' && document.execCommand
    ? (command) => document.execCommand(command)
    : null);
  try {
    return Boolean(legacy?.('copy'));
  } catch {
    return false;
  }
}
