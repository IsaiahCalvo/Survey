// The rows of an action menu (a list of things to DO: the home row "..."
// menus, right-click on a document or project). Design review 2026-10-27:
// these menus had drifted apart - some rows had icons and some did not (even
// inside one menu), Delete sat in the middle, and the text was 11, 12 or 13px
// depending on the menu. Every action menu now draws its rows here:
//   - every row has an icon, picked from its label when the caller gives none;
//   - Delete (any danger row) goes last, below a line;
//   - size and type come from the menu tokens (tokens.css --menu-*), through
//     the shared .hub-menu__item class.
// Value pickers (a toolbar pill's list, Fit page / width / height) are a
// different kind of menu: they show the current choice and stay as they are.
import Icon from '../Icons';
import { activateOrExplain } from '../utils/disabledReasonToast.js';
import { arrangeMenuItems, menuIconFor } from '../utils/menuItems.js';

export { arrangeMenuItems, menuIconFor };

/**
 * Rows for an action menu. `items`: { label, onClick, danger?, disabled?,
 * reason? (a disabled-with-a-reason row that explains itself), icon? (false:
 * none, for a row that is a name, not an action), iconNode? }.
 * `tip` is useTooltip()'s function; `onClose` runs before an item's action.
 */
export default function MenuRows({ items, tip, onClose, tipSide }) {
  const rows = arrangeMenuItems(items);
  // A list of names (say, the hidden module tabs) has no icons at all; then no
  // row keeps an empty icon slot either.
  const iconOf = (it) => (it.icon === false ? null : (it.icon || menuIconFor(it.label)));
  const anyIcon = rows.some((it) => !it.separator && (it.iconNode || iconOf(it)));
  return rows.map((it) => {
    if (it.separator) return <div key={it.key} role="separator" className="hub-menu__separator" />;
    const icon = iconOf(it);
    return (
      <button
        key={it.label}
        type="button"
        role="menuitem"
        className={`hub-menu__item${it.danger ? ' is-danger' : ''}`}
        disabled={it.reason ? undefined : it.disabled}
        aria-disabled={it.reason ? true : undefined}
        {...(it.reason && tip ? tip(it.reason, tipSide) : {})}
        onClick={() => { if (it.disabled && !it.reason) return; onClose?.(); activateOrExplain(it.reason, it.onClick); }}
      >
        {it.iconNode || (icon ? <Icon name={icon} size={14} color="currentColor" /> : (anyIcon ? <span className="hub-menu__icon-gap" aria-hidden="true" /> : null))}
        {it.label}
      </button>
    );
  });
}
