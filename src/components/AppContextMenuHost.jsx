import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import DismissBarrier from './DismissBarrier';
import { useTooltip } from './Tooltip';
import MenuRows from './MenuRows.jsx';
import { menuRowHeight } from '../utils/menuItems.js';
import { APP_CONTEXT_MENU_EVENT } from '../utils/nativeContextMenuGuard.js';
// The shared .hub-menu look; also loaded here for the standalone pages.
import '../home/hub.css';
import { textFieldMenuItems, selectionMenuItems, linkMenuItems } from '../utils/appContextMenuItems.js';

// The app's own right-click menu for a text field, selected text or a link
// (utils/nativeContextMenuGuard.js decides when). Mounted once at the app
// root. It wears the shared action menu look (.hub-menu, MenuRows), like the
// list row menus.
//
// Unlike the row menus it never takes focus: the field keeps its caret and
// selection (and does not blur, which would save and close a rename field)
// while Cut / Copy / Paste run against it.
export default function AppContextMenuHost() {
  const [menu, setMenu] = useState(null);
  const ref = useRef(null);
  const tip = useTooltip();

  useEffect(() => {
    const open = (event) => setMenu(event.detail || null);
    window.addEventListener(APP_CONTEXT_MENU_EVENT, open);
    return () => window.removeEventListener(APP_CONTEXT_MENU_EVENT, open);
  }, []);

  // Typing (Ctrl+V still pastes), scrolling or leaving the window closes it,
  // like a system menu.
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
      close();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', close, { passive: true, capture: true });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', close, { capture: true });
    };
  }, [menu]);

  if (!menu || typeof document === 'undefined') return null;
  const items = (menu.kind === 'field' ? textFieldMenuItems(menu.field)
    : menu.kind === 'selection' ? selectionMenuItems(menu.text)
      : menu.kind === 'link' ? linkMenuItems(menu.href)
        : []).filter(Boolean);
  if (!items.length) return null;
  const close = () => setMenu(null);
  const height = items.length * menuRowHeight() + 10;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 188));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - height - 8));
  return createPortal(<>
    <DismissBarrier insideRefs={[ref]} onDismiss={close} />
    <div
      ref={ref}
      role="menu"
      aria-label={menu.kind === 'field' ? 'Text actions' : menu.kind === 'link' ? 'Link actions' : 'Selected text actions'}
      className="hub-menu"
      data-app-context-menu={menu.kind}
      style={{ zIndex: 10003, '--menu-origin': 'top left', left, top, minWidth: 180 }}
      // Keep focus (and the caret) in the field: a press here must not move it.
      onMouseDown={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <MenuRows items={items} tip={tip} onClose={close} />
    </div>
  </>, document.body);
}
