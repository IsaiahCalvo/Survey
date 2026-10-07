// The page menu's rows, drawn from the one list in sidebar/pageMenuItems.js.
// Used by the Pages tab (PagesPanel) and the viewer's page menu
// (hooks/useAnnotationContextMenu.jsx), so both show the same rows.
import Icon from '../Icons';

/* One row of the page menu (polish 3, 2026-10-04). The menu used to spell out
   the same 15-line style on each of its eleven buttons, and they had drifted:
   Move up / down had no font size (13.3px), Paste was dimmed twice (grey AND
   50% opacity) and Move up / down by opacity alone. Now:
     - off is --text-disabled, never an opacity (tokens.css);
     - the phone row is the phone menu row every other phone menu uses
       (--sheet-menu-item-h, 15px/400, --text-1, 16px glyph: the More menu);
     - the desktop row is unchanged (13px, 8px 12px, --text-2, 14px glyph).
   The hover fill is passed through unchanged (menu shades: owner decision
   pending). */
export const PageMenuItem = ({ mobile = false, icon, label, disabled = false, danger = false, hoverBg = 'var(--hover)', onClick, itemKey }) => (
  <button
    type="button"
    role="menuitem"
    disabled={disabled}
    data-page-menu-item={itemKey}
    onClick={onClick}
    style={{
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      textAlign: 'left',
      background: 'transparent',
      border: 'none',
      ...(mobile
        ? { minHeight: 'var(--sheet-menu-item-h)', padding: '0 12px', gap: '12px', borderRadius: 'var(--radius-xs)', font: '400 15px/20px var(--font-ui)' }
        : { padding: '8px 12px', gap: '8px', borderRadius: '4px', fontSize: '13px' }),
      // Off is the shared look (states.css section 6: --disabled-ink, not-allowed).
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      color: danger ? 'var(--danger-text)' : (mobile ? 'var(--text-1)' : 'var(--text-2)'),
    }}
    onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = hoverBg; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
  >
    {icon ? (
      <Icon
        name={icon}
        size={mobile ? 16 : 14}
        color={danger ? 'var(--danger)' : (mobile ? 'currentColor' : 'var(--text-3)')}
      />
    ) : null}
    {label}
  </button>
);

/* A hairline between groups. --border, the divider token: the old
   --surface-3 line vanished on the desktop menu, whose fill IS --surface-3. */
export const PageMenuDivider = () => (
  <div role="separator" style={{ height: '1px', margin: '4px 0', background: 'var(--border)' }} />
);

/* The menu's muted title row ("Page 3"): the phone's section label type
   (--sheet-section); on desktop the same muted ink at 11px. */
export const PageMenuHeader = ({ mobile = false, label }) => (
  <div
    style={mobile
      ? { color: 'var(--text-3)', font: 'var(--sheet-section)', padding: '4px 6px' }
      : { color: 'var(--text-3)', fontSize: '11px', fontWeight: 600, padding: '4px 12px 2px' }}
  >
    {label}
  </div>
);

/**
 * The rows for `items` (buildPageMenuItems). `onPick(key)` runs an item.
 * `dangerHoverBg` is the Delete row's hover fill (it differs per menu fill).
 */
export function PageMenuList({ items, mobile = false, onPick, hoverBg, dangerHoverBg }) {
  return items.map((item) => {
    if (item.separator) return <PageMenuDivider key={item.key} />;
    if (item.header) return <PageMenuHeader key={item.key} mobile={mobile} label={item.label} />;
    return (
      <PageMenuItem
        key={item.key}
        itemKey={item.key}
        mobile={mobile}
        icon={item.icon}
        label={item.label}
        disabled={Boolean(item.disabled)}
        danger={Boolean(item.danger)}
        hoverBg={item.danger && dangerHoverBg ? dangerHoverBg : (hoverBg || 'var(--hover)')}
        onClick={item.disabled ? undefined : () => onPick?.(item.key)}
      />
    );
  });
}
