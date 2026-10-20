/**
 * contextMenuLayout.js — how the mark menu (right-click / long-press) is laid
 * out. Drawboard canvas audit, chunk 7 (2026-10-13).
 *
 * Drawboard's mark menu opens with a row of icon buttons for the everyday
 * actions, then a short list with the rarer ones in submenus ("Arrange ▸").
 * Survey listed all ten items in a column. The menu now has:
 *
 *   [Duplicate] [Cut] [Copy] [Paste] [Delete]      <- icon row
 *   ─────────────
 *   Lock / Unlock
 *   Arrange                               ›        <- the four order items
 *
 * Only menus on marks (a shape, callout, Survey Marker or a selection) take
 * this layout; the short menus (text markup, Counter, the page) and the phone
 * menu keep their plain list. The items themselves (what they do, when they
 * are greyed out) are unchanged: this file only sorts them.
 */

// Drawboard's order for the icon row.
export const QUICK_ACTION_KEYS = Object.freeze(['duplicate', 'cut', 'copy', 'paste', 'delete']);
// The four stacking-order items, folded into "Arrange".
export const ARRANGE_KEYS = Object.freeze(['bringToFront', 'bringForward', 'sendBackward', 'sendToBack']);
// Glyph per icon-row action (src/Icons.jsx names).
export const QUICK_ACTION_ICONS = Object.freeze({
  duplicate: 'duplicate',
  cut: 'scissors',
  copy: 'copy',
  paste: 'paste',
  delete: 'trash',
});

/**
 * Sort a flat item list ({ key, label, disabled, onClick } and separators)
 * into the icon-row layout. Returns null when the list is not a mark menu
 * (fewer than three of the everyday actions), so the caller draws it as before.
 *
 * @returns {null | { quick: object[], rows: object[] }} rows may contain one
 *   { key: 'arrange', label: 'Arrange', submenu: [...], disabled } entry, placed
 *   where the first order item was.
 */
export function layoutContextMenuItems(items) {
  const list = Array.isArray(items) ? items.filter((it) => it && !it.separator) : [];
  const quick = QUICK_ACTION_KEYS
    .map((key) => list.find((it) => it.key === key))
    .filter(Boolean);
  if (quick.length < 3) return null;
  const arrange = ARRANGE_KEYS
    .map((key) => list.find((it) => it.key === key))
    .filter(Boolean);
  const rows = [];
  let arrangePlaced = false;
  list.forEach((it) => {
    if (QUICK_ACTION_KEYS.includes(it.key)) return;
    if (ARRANGE_KEYS.includes(it.key)) {
      if (!arrangePlaced && arrange.length > 0) {
        rows.push({
          key: 'arrange',
          label: 'Arrange',
          submenu: arrange,
          disabled: arrange.every((a) => a.disabled),
        });
        arrangePlaced = true;
      }
      return;
    }
    rows.push(it);
  });
  return { quick, rows };
}

/**
 * Keyboard movement through the menu. `stops` is the menu as rows of focusable
 * item keys (the icon row is one row; each list row is its own row; disabled
 * items left out). `current` is { row, col } or null (nothing focused yet).
 * Up / Down move between rows (wrapping), Left / Right along the icon row
 * (wrapping), Home / End to the first / last row. Returns the new { row, col }
 * or null when the key does not move.
 */
export function moveMenuFocus(stops, current, key) {
  const rows = (stops || []).filter((row) => Array.isArray(row) && row.length > 0);
  if (rows.length === 0) return null;
  const last = rows.length - 1;
  if (!current) {
    if (key === 'ArrowUp' || key === 'End') return { row: last, col: 0 };
    if (key === 'ArrowDown' || key === 'Home' || key === 'ArrowLeft' || key === 'ArrowRight') return { row: 0, col: 0 };
    return null;
  }
  const row = Math.min(Math.max(0, current.row), last);
  const width = rows[row].length;
  const col = Math.min(Math.max(0, current.col), width - 1);
  switch (key) {
    case 'ArrowDown': return { row: row === last ? 0 : row + 1, col: 0 };
    case 'ArrowUp': return { row: row === 0 ? last : row - 1, col: 0 };
    case 'ArrowRight': return width > 1 ? { row, col: (col + 1) % width } : null;
    case 'ArrowLeft': return width > 1 ? { row, col: (col - 1 + width) % width } : null;
    case 'Home': return { row: 0, col: 0 };
    case 'End': return { row: last, col: 0 };
    default: return null;
  }
}

/**
 * Which side the submenu opens on: to the right of the menu, or to the left
 * when it would run past `boundRight` (the window edge, less the desktop right
 * rail). Returns 'right' | 'left'.
 */
export function submenuSide({ menuLeft, menuRight, submenuWidth, boundLeft = 0, boundRight }) {
  const gap = 2;
  const fitsRight = menuRight + gap + submenuWidth <= boundRight;
  if (fitsRight) return 'right';
  const fitsLeft = menuLeft - gap - submenuWidth >= boundLeft;
  return fitsLeft ? 'left' : 'right';
}
