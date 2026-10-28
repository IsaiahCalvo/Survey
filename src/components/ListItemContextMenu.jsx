import { useRef } from 'react';
import { createPortal } from 'react-dom';
import DismissBarrier from './DismissBarrier';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useTooltip } from './Tooltip';
import MenuRows from './MenuRows.jsx';
import { menuRowHeight } from '../utils/menuItems.js';

// The right-click menu of a list row. It wears the shared action menu (hub.css
// .hub-menu, rows from MenuRows) so it matches the home row menus.
export default function ListItemContextMenu({ point, items, onClose }) {
  const ref = useRef(null); useFocusTrap(ref, true, { onEscape: onClose });
  const tip = useTooltip();
  // Rows are 44px on a touch screen (hub.css), 28 on a mouse; the line
  // above Delete is 9.
  const list = items.filter(Boolean);
  const height = list.length * menuRowHeight() + (list.some((item) => item.danger) ? 9 : 0) + 10;
  return createPortal(<>
    <DismissBarrier insideRefs={[ref]} onDismiss={onClose} menu />
    <div ref={ref} role="menu" aria-label="List item actions" className="hub-menu" style={{ zIndex: 10002, '--menu-origin': 'top left', left: Math.max(8, Math.min(point.x, window.innerWidth - 188)), top: Math.max(8, Math.min(point.y, window.innerHeight - height - 8)), minWidth: 180 }} onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => {
      const buttons = [...ref.current.querySelectorAll('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); }
    }}>
      <MenuRows items={items} tip={tip} onClose={onClose} />
    </div>
  </>, document.body);
}
