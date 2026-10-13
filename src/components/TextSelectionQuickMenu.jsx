// KAL-240 — the floating quick menu for a finished PDF text selection.
//
// It is a shortcut onto the SAME actions the docked text-selection bar
// (TextSelectionActionBar) runs: PDFViewer passes the one handler both use, so
// a mark made here is the same text-markup record, with the same undo, save,
// sync and export as one made from the bar. The bar stays the place for each
// mark's colour, links and redaction; this menu is the quick path where the
// eye already is.
//
// When it shows (Drawboard / Acrobat feel):
//   - only once the selection is finished: never while the mouse button or a
//     finger is down, and only after the selection has stopped changing for a
//     beat (iOS moves a selection with its handles without telling the page
//     about the touch, so "stopped changing" is the only reliable signal);
//   - it goes away with Escape (the first Escape closes just the menu, the
//     next one clears the selection — the app's popover rule), with a click or
//     tap anywhere else, and after one of its actions runs;
//   - a menu that was dismissed stays away until the selection changes.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import { useTooltip } from './Tooltip';
import {
  TEXT_SELECTION_QUICK_MENU_MARKS,
  computeTextSelectionQuickMenuPosition,
  textSelectionQuickMenuKey,
  unionClientRects,
} from '../utils/textSelectionQuickMenu.js';
import './TextSelectionQuickMenu.css';

const SETTLE_MS_FINE = 120;
const SETTLE_MS_COARSE = 320;
const TAP_SLOP_PX = 10;

const isCoarsePointer = () => {
  try {
    return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
  } catch {
    return false;
  }
};

// The live native range, read fresh so the menu follows a scroll or zoom.
function liveSelectionRect() {
  try {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const inPdfText = (node) => {
      const element = node?.nodeType === 1 ? node : node?.parentElement;
      return Boolean(element?.closest?.('.pdfjsTextLayer'));
    };
    if (!inPdfText(range.startContainer) && !inPdfText(range.endContainer)) return null;
    return unionClientRects(Array.from(range.getClientRects?.() || []));
  } catch {
    return null;
  }
}

// Every opened document tab keeps its viewer mounted (AppShell hides the
// others with display: none), so a plain querySelector can return a hidden
// tab's zero-sized viewer and the menu never showed on later tabs (Codex,
// #817). Use the viewer that holds the selection, else the one on screen.
function selectionViewer() {
  try {
    const node = window.getSelection?.()?.anchorNode;
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    const owner = element?.closest?.('[data-testid="pdf-container"]');
    if (owner) return owner;
  } catch { /* fall through */ }
  const all = document.querySelectorAll('[data-testid="pdf-container"]');
  for (const element of all) if (element.getClientRects().length > 0) return element;
  return all[0] || null;
}

function viewerBounds() {
  const container = selectionViewer();
  const rect = container?.getBoundingClientRect?.();
  const viewport = window.visualViewport;
  const viewportTop = viewport ? viewport.offsetTop : 0;
  const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
  let top = Math.max(rect ? rect.top : 0, viewportTop);
  const bottom = Math.min(rect ? rect.bottom : window.innerHeight, viewportBottom);
  // The tool bar rows (and the phone's text strip) overlay the top of the
  // viewer; the menu stays under them.
  const host = document.getElementById('chrome-sub-toolbar-host');
  const hostRect = host && getComputedStyle(host).display !== 'none' ? host.getBoundingClientRect() : null;
  if (hostRect && hostRect.height > 0) top = Math.max(top, hostRect.bottom);
  let left = Math.max(rect ? rect.left : 0, 0);
  let right = Math.min(rect ? rect.right : window.innerWidth, window.innerWidth);
  // The phone's tool rail floats over the viewer's side edge; keep clear of it.
  const rail = document.querySelector('.mobile-pdf-tools');
  const railRect = rail?.getBoundingClientRect?.();
  if (railRect && railRect.width > 0 && railRect.height > 0) {
    if (railRect.left + railRect.width / 2 < (left + right) / 2) left = Math.max(left, railRect.right);
    else right = Math.min(right, railRect.left);
  }
  return { left, right, top, bottom };
}

const anchorRect = (anchor) => (anchor && Number.isFinite(Number(anchor.left)) ? {
  left: Number(anchor.left),
  top: Number(anchor.top),
  right: Number(anchor.left) + Number(anchor.width || 0),
  bottom: Number(anchor.top) + Number(anchor.height || 0),
} : null);

function QuickMenuButton({ label, tip, icon, pressed, paintColor, onActivate }) {
  const chromeTip = useTooltip();
  return (
    <button
      type="button"
      className="text-selection-quick-menu__button"
      aria-label={label}
      aria-pressed={pressed == null ? undefined : pressed}
      {...chromeTip(tip, 'below')}
      onClick={onActivate}
      onTouchEnd={(event) => {
        // A touch acts on release and must not reach the page behind (which
        // would collapse the very selection this is acting on).
        event.preventDefault();
        event.stopPropagation();
        onActivate();
      }}
    >
      <Icon name={icon} size={18} color={pressed ? 'var(--accent)' : 'var(--text-2)'} style={{ display: 'block', opacity: 1 }} />
      {paintColor && (
        <span
          aria-hidden="true"
          className="text-selection-quick-menu__paint"
          style={{ background: paintColor }}
        />
      )}
    </button>
  );
}

export default function TextSelectionQuickMenu({
  selection,
  activeMarkupTypes = [],
  paintByMark = {},
  onAction,
  onCopy,
}) {
  const key = textSelectionQuickMenuKey(selection);
  const keyRef = useRef(key);
  keyRef.current = key;
  const [settledKey, setSettledKey] = useState('');
  const [dismissedKey, setDismissedKey] = useState('');
  const [pressing, setPressing] = useState(false);
  const [position, setPosition] = useState(null);
  const menuRef = useRef(null);
  const coarseRef = useRef(false);
  coarseRef.current = isCoarsePointer();

  // Shown only once the selection has stopped changing for a beat.
  useEffect(() => {
    if (!key) {
      setSettledKey('');
      return undefined;
    }
    const timer = window.setTimeout(
      () => setSettledKey(key),
      coarseRef.current ? SETTLE_MS_COARSE : SETTLE_MS_FINE,
    );
    return () => window.clearTimeout(timer);
  }, [key]);

  // A dismissal belongs to one selection; a new one may show the menu again.
  useEffect(() => {
    if (dismissedKey && key !== dismissedKey) setDismissedKey('');
  }, [dismissedKey, key]);

  const visible = Boolean(key) && settledKey === key && !pressing && dismissedKey !== key;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  // Press anywhere but the menu: hide while it is down. A tap or click that
  // leaves the selection as it was is a "click elsewhere" and dismisses it;
  // a drag (a new selection, a scroll) does not.
  useEffect(() => {
    if (!key) return undefined;
    let down = null;
    let timer = 0;
    const onDown = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      down = { x: event.clientX, y: event.clientY, key: keyRef.current };
      setPressing(true);
    };
    const onUp = (event) => {
      const start = down;
      down = null;
      setPressing(false);
      if (!start) return;
      const moved = event.type === 'pointerup'
        && Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP_PX;
      if (moved) return;
      window.clearTimeout(timer);
      // The page records the new selection on the next tick; compare after it.
      timer = window.setTimeout(() => {
        if (start.key && keyRef.current === start.key) setDismissedKey(start.key);
      }, 60);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
  }, [key]);

  // First Escape closes only the menu (the selection stays, so Ctrl+C still
  // works); the page's own Escape handling takes the next one.
  useEffect(() => {
    if (!visible) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || !visibleRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setDismissedKey(keyRef.current);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [visible]);

  const place = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const selectionRect = liveSelectionRect() || anchorRect(selection?.anchor);
    const next = computeTextSelectionQuickMenuPosition({
      selectionRect,
      bounds: viewerBounds(),
      menuWidth: menu.offsetWidth,
      menuHeight: menu.offsetHeight,
      pointer: coarseRef.current ? 'coarse' : 'fine',
    });
    setPosition((current) => (
      current && next && current.left === next.left && current.top === next.top && current.placement === next.placement
        ? current
        : next
    ));
  }, [selection]);

  useLayoutEffect(() => {
    if (visible) place();
    else setPosition(null);
  }, [place, visible]);

  // Follow the selection through scrolls, zooms and window changes.
  useEffect(() => {
    if (!visible) return undefined;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        place();
      });
    };
    document.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener?.('resize', schedule);
    window.visualViewport?.addEventListener?.('scroll', schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener?.('resize', schedule);
      window.visualViewport?.removeEventListener?.('scroll', schedule);
    };
  }, [place, visible]);

  if (!key || typeof document === 'undefined') return null;
  const run = (action) => {
    setDismissedKey(keyRef.current);
    if (action === 'copy') onCopy?.(selection);
    else onAction?.(action);
  };
  return createPortal(
    <div
      ref={menuRef}
      className="text-selection-quick-menu"
      data-text-selection-quick-menu="true"
      data-placement={position?.placement || undefined}
      data-visible={visible && position ? 'true' : 'false'}
      role="toolbar"
      aria-label="Text selection actions"
      aria-hidden={visible && position ? undefined : 'true'}
      style={{
        left: position ? position.left : 0,
        top: position ? position.top : 0,
        visibility: visible && position ? 'visible' : 'hidden',
        pointerEvents: visible && position ? 'auto' : 'none',
      }}
      // Keep the native selection alive: a press on the menu must not move
      // focus or collapse the range it is about to act on.
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
    >
      {TEXT_SELECTION_QUICK_MENU_MARKS.map((mark) => {
        const active = activeMarkupTypes.includes(mark.id);
        return (
          <QuickMenuButton
            key={mark.id}
            label={`${active ? 'Remove' : 'Add'} ${mark.label.toLowerCase()} on selected text`}
            tip={active ? `Remove ${mark.label}` : mark.label}
            icon={mark.icon}
            pressed={active}
            paintColor={paintByMark?.[mark.id]?.color || null}
            onActivate={() => run(mark.id)}
          />
        );
      })}
      <span className="text-selection-quick-menu__divider" aria-hidden="true" />
      <QuickMenuButton
        label="Copy selected text"
        tip="Copy"
        icon="copy"
        onActivate={() => run('copy')}
      />
    </div>,
    document.body,
  );
}
