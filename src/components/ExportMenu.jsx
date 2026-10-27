// KAL-393: the caret beside the top bar's Export button. The download button
// itself still exports the annotated PDF in one click; this caret opens the
// list of every export, so new formats (XFDF now, a review bundle later) have
// one place to live without crowding the bar.

import { useCallback, useEffect, useRef, useState } from 'react';
import AnchoredPopover from './AnchoredPopover';
import Icon from '../Icons';
import { useTooltip } from './Tooltip';

export default function ExportMenu({ items = [], tooltip = {}, glyphSize = 10 }) {
  const tip = useTooltip();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const getAnchor = useCallback(() => buttonRef.current, []);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (buttonRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    menuRef.current?.querySelector('button')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  const visibleItems = items.filter((item) => typeof item?.onSelect === 'function');
  if (!visibleItems.length) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="chrome-control"
        aria-label="More export options"
        aria-haspopup="menu"
        aria-expanded={open}
        data-export-menu-trigger="true"
        onClick={() => setOpen((value) => !value)}
        {...tooltip}
        style={{ border: 'none', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', width: 'auto', minWidth: 16, padding: '0 2px' }}
      >
        <Icon name="chevronDown" size={glyphSize} />
      </button>
      {open && (
        <AnchoredPopover getAnchor={getAnchor} gap={6}>
          <div
            ref={menuRef}
            role="menu"
            aria-label="Export"
            data-export-menu="true"
            // Design review 2026-10-27: an action menu, so it wears the shared
            // action menu (hub.css .hub-menu / .hub-menu__item, an icon on
            // each row) like the home row menus and the right-click menus.
            className="hub-menu"
            // AnchoredPopover clamps a centred card, so the menu stays centred
            // on its zero-width wrapper.
            style={{ position: 'absolute', top: '100%', left: '50%', marginTop: 6, minWidth: 220, transform: 'translate(-50%, 0)' }}
          >
            {visibleItems.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className="hub-menu__item"
                {...tip(item.title, 'left')}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon ? <Icon name={item.icon} size={14} color="currentColor" /> : null}
                {item.label}
              </button>
            ))}
          </div>
        </AnchoredPopover>
      )}
    </>
  );
}
