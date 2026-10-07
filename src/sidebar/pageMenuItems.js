// The page menu's one list (owner 2026-10-07): the Pages tab's page menu
// (right-click a thumbnail, or its "..." button) and the viewer's page menu
// (right-click / long-press a page with Pan or Select) are built from THIS
// list and run THIS dispatcher, so the two can never drift.
//
// Pure: no React, no DOM. sidebar/PageActionsMenu.jsx draws the entries.

/**
 * @param {object} o
 * @param {number} o.pageNumber     the page the menu acts on
 * @param {number} o.pageCount      pages in the document
 * @param {number|null} o.clipboardPage  page on the page clipboard
 * @param {'cut'|'copy'|null} o.clipboardType
 * @param {boolean} o.hasTransform  the page has a mirror (Reset has work to do)
 * @param {object|null} o.move      { canUp, canDown } adds Move up / down (the
 *                                  phone Pages sheet, which has no drag)
 * @param {object} o.available      { [handler]: false } hides the items of a
 *                                  page operation the host does not have
 *                                  (availableActions below)
 * @returns {Array<{key:string,label?:string,icon?:string,disabled?:boolean,danger?:boolean,separator?:boolean,header?:boolean}>}
 */
export function buildPageMenuItems({
  pageNumber,
  pageCount,
  clipboardPage = null,
  clipboardType = null,
  hasTransform = false,
  move = null,
  available = {},
} = {}) {
  const has = (key) => available[key] !== false;
  const hasClipboard = Boolean(clipboardPage);
  // Pasting a cut page onto itself would do nothing.
  const pasteIsNoop = clipboardType === 'cut' && clipboardPage === pageNumber;
  const pasteOff = !hasClipboard || pasteIsNoop;
  const groups = [
    [{ key: 'header', header: true, label: `Page ${pageNumber}` }],
    move ? [
      { key: 'moveUp', label: 'Move up', icon: 'chevronUp', disabled: !move.canUp },
      { key: 'moveDown', label: 'Move down', icon: 'chevronDown', disabled: !move.canDown },
    ] : [],
    [
      has('cut') && { key: 'cut', label: 'Cut', icon: 'scissors' },
      has('copy') && { key: 'copy', label: 'Copy', icon: 'copy' },
      has('paste') && { key: 'pasteAbove', label: 'Paste above', icon: 'paste', disabled: pasteOff },
      has('paste') && { key: 'pasteBelow', label: 'Paste below', icon: 'paste', disabled: pasteOff },
      has('duplicate') && { key: 'duplicate', label: 'Duplicate', icon: 'duplicate' },
    ],
    [
      has('insertBlank') && { key: 'insertAbove', label: 'Blank page above', icon: 'plus' },
      has('insertBlank') && { key: 'insertBelow', label: 'Blank page below', icon: 'plus' },
    ],
    [
      has('rotate') && { key: 'rotateLeft', label: 'Rotate left', icon: 'rotateCcw' },
      has('rotate') && { key: 'rotateRight', label: 'Rotate right', icon: 'rotateCw' },
      has('mirror') && { key: 'mirrorH', label: 'Mirror horizontally', icon: 'flipHorizontal' },
      has('mirror') && { key: 'mirrorV', label: 'Mirror vertically', icon: 'flipVertical' },
      // Owner 2026-10-06: an item with nothing to act on is disabled.
      has('reset') && { key: 'reset', label: 'Reset', icon: 'reset', disabled: !hasTransform },
    ],
    [
      // A document cannot have zero pages.
      has('delete') && { key: 'delete', label: 'Delete', icon: 'trash', danger: true, disabled: !(pageCount > 1) },
    ],
  ].map((group) => group.filter(Boolean)).filter((group) => group.length > 0);

  const items = [];
  groups.forEach((group, index) => {
    if (index > 0) items.push({ key: `sep-${index}`, separator: true });
    items.push(...group);
  });
  return items;
}

/**
 * Runs a page menu item. `handlers` are the page operations
 * (hooks/usePageOperations.js through the host's props):
 *   cut(page) copy(page) paste(targetPage, position) duplicate(page)
 *   insertBlank(afterPage) rotate(page, delta) mirror(page, direction)
 *   reset(page) delete(page) move(page, offset)
 * Returns true when it ran something.
 */
export function runPageMenuAction(key, pageNumber, handlers = {}) {
  const call = (name, ...args) => {
    const fn = handlers[name];
    if (typeof fn !== 'function') return false;
    fn(...args);
    return true;
  };
  switch (key) {
    case 'moveUp': return call('move', pageNumber, -1);
    case 'moveDown': return call('move', pageNumber, 1);
    case 'cut': return call('cut', pageNumber);
    case 'copy': return call('copy', pageNumber);
    case 'pasteAbove': return call('paste', pageNumber, 'above');
    case 'pasteBelow': return call('paste', pageNumber, 'below');
    case 'duplicate': return call('duplicate', pageNumber);
    // A blank page goes after the page above it: above page n = after n - 1
    // (0 = the very top).
    case 'insertAbove': return call('insertBlank', pageNumber - 1);
    case 'insertBelow': return call('insertBlank', pageNumber);
    case 'rotateLeft': return call('rotate', pageNumber, -90);
    case 'rotateRight': return call('rotate', pageNumber, 90);
    case 'mirrorH': return call('mirror', pageNumber, 'horizontal');
    case 'mirrorV': return call('mirror', pageNumber, 'vertical');
    case 'reset': return call('reset', pageNumber);
    case 'delete': return call('delete', pageNumber);
    default: return false;
  }
}

/** { [handler name]: boolean } for buildPageMenuItems' `available`. */
export function availableActions(handlers = {}) {
  return Object.fromEntries(
    ['cut', 'copy', 'paste', 'duplicate', 'insertBlank', 'rotate', 'mirror', 'reset', 'delete']
      .map((name) => [name, typeof handlers[name] === 'function']),
  );
}
