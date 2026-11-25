import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import { useTooltip } from './Tooltip';

/**
 * Compact split-button / sub-toolbar group for the desktop Text (`review`) row.
 * When only one item is enabled in the group, it renders as a plain 1-click
 * toolbar button. When two or more items are enabled, clicking opens a compact
 * floating sub-toolbar directly below the button so the main row never sprawls
 * off to the right.
 */
export default function ReviewToolGroupButton({
  groupId,
  groupLabel,
  defaultIconName,
  items = [],
  glyphSize = 18,
  onSelectItem,
}) {
  const chromeTip = useTooltip();
  const [open, setOpen] = useState(false);
  const [lastPickedId, setLastPickedId] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (buttonRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  if (!items || items.length === 0) return null;

  // Single enabled tool: render as a plain direct button (no extra click).
  if (items.length === 1) {
    const single = items[0];
    return (
      <button
        type="button"
        data-morph-icon={single.iconName}
        data-tool-switch="true"
        onClick={(e) => onSelectItem(single, e)}
        {...chromeTip(single.label, 'below')}
        className={`btn chrome-subcontrol ${single.active ? 'btn-active' : 'btn-ghost'}`}
        aria-pressed={Boolean(single.active)}
        aria-label={single.label}
      >
        <Icon name={single.iconName} size={glyphSize} />
      </button>
    );
  }

  const activeItem = items.find((item) => item.active) || null;
  const faceItem = activeItem || items.find((item) => item.id === lastPickedId) || items[0];
  const faceIcon = faceItem?.iconName || defaultIconName;
  const isActive = Boolean(activeItem);
  const rect = open ? buttonRef.current?.getBoundingClientRect() : null;
  const menuLeft = rect
    ? Math.max(8, Math.min(rect.left, (typeof window !== 'undefined' ? window.innerWidth : 1440) - 210))
    : 8;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={isActive}
        aria-label={groupLabel}
        data-review-group-button={groupId}
        data-morph-icon={faceIcon}
        data-tool-switch="true"
        {...chromeTip(open ? undefined : (activeItem ? `${groupLabel}: ${activeItem.label}` : groupLabel), 'below')}
        className={`btn chrome-subcontrol ${isActive || open ? 'btn-active' : 'btn-ghost'}`}
        onClick={() => setOpen((was) => !was)}
        style={{ position: 'relative', width: 'auto', minWidth: 34, paddingLeft: 6, paddingRight: 15 }}
      >
        <Icon name={faceIcon} size={glyphSize} />
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 4,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 10,
            color: 'var(--text-3)',
            pointerEvents: 'none',
          }}
        >
          ▾
        </span>
      </button>
      {open && rect && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={groupLabel}
          data-review-group-menu={groupId}
          style={{
            position: 'fixed',
            top: rect.bottom + 6,
            left: menuLeft,
            minWidth: 186,
            padding: 4,
            background: 'var(--surface-2)',
            border: '1px solid var(--surface-3)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
            zIndex: 5800,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              aria-label={item.label}
              aria-pressed={Boolean(item.active)}
              data-review-group-item={item.id}
              onClick={(e) => {
                setLastPickedId(item.id);
                setOpen(false);
                onSelectItem(item, e);
              }}
              onMouseEnter={(e) => { if (!item.active) e.currentTarget.style.background = 'var(--hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = item.active ? 'var(--surface-3)' : 'transparent'; }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                width: '100%',
                height: 34,
                padding: '0 10px',
                border: 'none',
                borderRadius: 6,
                background: item.active ? 'var(--surface-3)' : 'transparent',
                color: item.active ? 'var(--accent)' : 'var(--text-1)',
                fontSize: 12.5,
                fontWeight: item.active ? 600 : 400,
                cursor: 'pointer',
                textAlign: 'left',
                whiteSpace: 'nowrap',
              }}
            >
              <Icon name={item.iconName} size={16} color={item.active ? 'var(--accent)' : 'var(--text-2)'} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
