import { useRef } from 'react';
import { createPortal } from 'react-dom';
import DismissBarrier from './DismissBarrier';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useTooltip } from './Tooltip';
import MenuRows from './MenuRows.jsx';

// The right-click menu of a list row. It wears the shared action menu (hub.css
// .hub-menu, rows from MenuRows) so it matches the home row menus.
export default function ListItemContextMenu({ point, items, onClose }) {
  const ref = useRef(null); useFocusTrap(ref, true, { onEscape: onClose });
  const tip = useTooltip();
  const rows = items.filter(Boolean).length + (items.some((item) => item?.danger) ? 1 : 0);
  return createPortal(<>
    <DismissBarrier insideRefs={[ref]} onDismiss={onClose} menu />
    <div ref={ref} role="menu" aria-label="List item actions" className="hub-menu" style={{ zIndex: 10002, left: Math.max(8, Math.min(point.x, window.innerWidth - 188)), top: Math.max(8, Math.min(point.y, window.innerHeight - rows * 28 - 16)), minWidth: 180 }} onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => {
      const buttons = [...ref.current.querySelectorAll('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); }
    }}>
      <MenuRows items={items} tip={tip} onClose={onClose} />
    </div>
  </>, document.body);
}
