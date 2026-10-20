import { useRef } from 'react';
import { createPortal } from 'react-dom';
import DismissBarrier from './DismissBarrier';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { COLORS } from '../theme';
export default function ListItemContextMenu({ point, items, onClose }) {
  const ref = useRef(null); useFocusTrap(ref, true, { onEscape: onClose });
  return createPortal(<>
    <DismissBarrier insideRefs={[ref]} onDismiss={onClose} menu />
    <div ref={ref} role="menu" aria-label="List item actions" style={{ position: 'fixed', zIndex: 10002, left: Math.max(8, Math.min(point.x, window.innerWidth - 188)), top: Math.max(8, Math.min(point.y, window.innerHeight - items.length * 32 - 16)), width: 180, padding: 4, background: COLORS.modal.surface, color: COLORS.modal.textPrimary, border: `1px solid ${COLORS.modal.border}`, borderRadius: 7, boxShadow: '0 8px 24px #0005' }} onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => {
      const buttons = [...ref.current.querySelectorAll('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); }
    }}>
      {items.map((item) => <button key={item.label} type="button" role="menuitem" className={`hub-menu__item${item.danger ? ' is-danger' : ''}`} disabled={item.disabled} onClick={() => { onClose(); item.onClick(); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', background: 'transparent', border: 0, color: item.danger ? 'var(--danger)' : 'inherit', cursor: 'pointer', fontSize: 13 }}>{item.label}</button>)}
    </div>
  </>, document.body);
}
