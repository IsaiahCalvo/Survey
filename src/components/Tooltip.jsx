/**
 * Tooltip.jsx — the app's ONE tooltip surface (KAL-65).
 *
 * Before this module there were four separate hover-hint implementations that
 * looked and behaved differently:
 *   1. `chromeTip()` in AppShell + the floating chip PDFViewer rendered inline.
 *   2. A hardcoded `#1a1a1a` anchored box duplicated in SyncStatusChip and
 *      PresenceAvatars.
 *   3. Native `title=` attributes — the OS tooltip, which takes ~1.5s to appear
 *      and is styled by the operating system, not by us.
 *   4. `.survey-marker-review-tooltip` in styles.css (a CSS `:hover` popover).
 *
 * Worse, many controls carried BOTH (1) and (3) at once, so hovering a zoom or
 * page-navigation button showed the app's instant chip and then the OS tooltip
 * fading in on top of it about a second and a half later — two tooltips with
 * the same words in two different styles.
 *
 * Everything except (4) now renders from the tokens and components here. (4) is
 * a multi-line popover panel with an arrow and interactive content, not a hint
 * chip, so it deliberately stays in CSS.
 *
 * UX intent, and why:
 *   - A tooltip must appear the instant the pointer lands. A control that only
 *     answers "what is this?" after a delay reads as having no tooltip at all,
 *     which is exactly how users described the old mixed behavior.
 *   - Every tooltip in the viewer chrome must look identical, because they sit
 *     millimetres apart on the same toolbars and rails.
 *   - A tooltip is decoration for screen readers. It is never the accessible
 *     name — the control carries its own `aria-label`, and the chip is
 *     `aria-hidden`. That is why dropping a native `title=` never costs a
 *     control its accessible name, provided the `aria-label` is there.
 *
 * Reference behavior matched: the Draw/Shapes/Text category buttons, which had
 * the instant chip from the start.
 */
import { createContext, useContext, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FONT_FAMILY } from '../viewerShared.js';
import { viewportClampDelta } from '../utils/floatingUiGeometry.js';
import { tooltipForLabel } from '../utils/toolShortcuts.js';

/**
 * The canonical tooltip look. Every tooltip in the app is painted from this one
 * object so the chip that flies out of the right rail is indistinguishable from
 * the one under a top-bar button or beside the sync status indicator.
 *
 * Deliberately NOT backdrop-dependent: these are chrome hints over app chrome,
 * never over the PDF page content, so the colors are fixed.
 */
export const TOOLTIP_SURFACE = {
  background: '#181c24',
  color: '#e8e2d4',
  border: '1px solid #2a3140',
  padding: '4px 8px',
  borderRadius: '6px',
  fontSize: '11.5px',
  letterSpacing: 0,
  fontFamily: FONT_FAMILY,
  whiteSpace: 'nowrap',
  boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
  pointerEvents: 'none',
};

/** The empty tooltip state — hover-out resets to exactly this. */
export const TOOLTIP_HIDDEN = { visible: false, text: '', x: 0, y: 0 };

/**
 * Translate for each placement, given that (x, y) is the anchor point:
 *   below — anchors the chip's top-center at (x, y): it hangs under the control
 *           (top toolbar + the category sub-row).
 *   above — anchors the bottom-center at (x, y): it floats over the control
 *           (bottom rail, where there is room overhead).
 *   left  — anchors the right-middle at (x, y): it flies out leftward over the
 *           PDF from the collapsed right rail. An above/below chip on a 48px
 *           rail would cross the viewport edge and clip.
 *   right — anchors the left-middle at (x, y): mirror of `left`, for controls
 *           pinned to the left edge (collapsed sidebar rail).
 */
const PLACEMENT_TRANSFORM = {
  below: 'translate(-50%, 0)',
  above: 'translate(-50%, -100%)',
  left: 'translate(-100%, -50%)',
  right: 'translate(0, -50%)',
};

/**
 * Compute the anchor point + placement for a control's bounding rect. Shared by
 * every binder so a given placement always lands the same distance from the
 * control, no matter which surface asked for it.
 */
export function tooltipAnchorFor(rect, placement = 'below') {
  if (placement === 'left') {
    return { x: rect.left - 8, y: rect.top + rect.height / 2 };
  }
  if (placement === 'right') {
    return { x: rect.right + 8, y: rect.top + rect.height / 2 };
  }
  if (placement === 'above') {
    return { x: rect.left + rect.width / 2, y: rect.top - 10 };
  }
  return { x: rect.left + rect.width / 2, y: rect.bottom + 10 };
}

/**
 * The floating chip itself, portaled to document.body.
 *
 * Portaled because the viewer tab wrapper is a stacking context at z 5000,
 * BELOW every chrome host (5400-5600) — an in-tree fixed chip could never paint
 * over the toolbars regardless of its own z-index. Same escape hatch the
 * counter caret popup uses.
 */
export function FloatingTooltip({ tooltip }) {
  const tooltipRef = useRef(null);

  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!tooltip?.visible || !el || typeof window === 'undefined') return undefined;

    const clampToViewport = () => {
      el.style.left = `${tooltip.x}px`;
      el.style.top = `${tooltip.y}px`;
      const rect = el.getBoundingClientRect();
      const delta = viewportClampDelta(rect, window.innerWidth, window.innerHeight);
      el.style.left = `${tooltip.x + delta.x}px`;
      el.style.top = `${tooltip.y + delta.y}px`;
    };

    clampToViewport();
    window.addEventListener('resize', clampToViewport);
    return () => window.removeEventListener('resize', clampToViewport);
  }, [tooltip?.placement, tooltip?.text, tooltip?.visible, tooltip?.x, tooltip?.y]);

  if (!tooltip?.visible || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={tooltipRef}
      // aria-hidden: the chip duplicates the control's own aria-label, so
      // announcing it would read every control's name twice.
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: tooltip.x,
        top: tooltip.y,
        transform: PLACEMENT_TRANSFORM[tooltip.placement] || PLACEMENT_TRANSFORM.above,
        zIndex: 10000,
        ...TOOLTIP_SURFACE,
      }}
    >
      {tooltip.text}
    </div>,
    document.body,
  );
}

/**
 * Build the prop bundle that opts one control into the shared tooltip.
 *
 * Spread the result onto any interactive element:
 *   <button {...tip('Zoom in', 'left')} aria-label="Zoom in">
 *
 * The control keeps its own `aria-label`; do NOT also give it a native `title=`
 * or the OS tooltip will fade in on top of this one ~1.5s later.
 *
 * Also binds focus/blur so keyboard users get the same hint as mouse users, and
 * hides on click so the chip does not sit over a menu the control just opened.
 */
export function makeTooltipBinding(setTooltip) {
  // UX 2026-09-16: every chip goes through tooltipForLabel on the way in, so a
  // control whose name IS a tool name automatically shows the key that arms it
  // ("Rectangle  R"). Doing it here rather than at each call site means a tool
  // added later cannot be the one that forgets its badge, and the hundreds of
  // non-tool chips ("Zoom in", "Undo", "Font color") are returned untouched
  // because no shortcut answers to those names.
  // Reference behavior matched: Drawboard PDF's tool tooltips, which print the
  // name followed by a keycap. The control's own aria-label is NOT touched —
  // a screen reader must not read a keycap as part of a control's name.
  // A pointer press is followed by focus on most buttons. Without this guard,
  // onMouseDown hides the tooltip and onFocus paints it again at once. Keep the
  // pressed control quiet until the pointer leaves it, then allow a fresh hover.
  const pressedControls = new WeakSet();
  let anchorObserver = null;
  const stopWatchingAnchor = () => { anchorObserver?.disconnect(); anchorObserver = null; };
  return (rawText, placement = 'below') => {
    const text = tooltipForLabel(rawText);
    if (!text) return {};
    const show = (e) => {
      const el = e?.currentTarget;
      if (!el?.getBoundingClientRect) return;
      if (pressedControls.has(el)) return;
      if (e?.type === 'focus' && !el.matches?.(':focus-visible')) return;
      const { x, y } = tooltipAnchorFor(el.getBoundingClientRect(), placement);
      stopWatchingAnchor();
      setTooltip?.({ visible: true, text, x, y, placement });
      // UX: a shortcut may unmount the hovered control without mouseleave.
      // Watch that anchor without replacing the control's own React ref.
      const doc = el.ownerDocument;
      const Observer = doc?.defaultView?.MutationObserver;
      if (Observer && doc.body) {
        anchorObserver = new Observer(() => {
          if (el.isConnected) return;
          stopWatchingAnchor();
          setTooltip?.((current) => current?.text === text ? { ...TOOLTIP_HIDDEN } : current);
        });
        anchorObserver.observe(doc.body, { childList: true, subtree: true });
      }
    };
    const hide = () => { stopWatchingAnchor(); setTooltip?.({ ...TOOLTIP_HIDDEN }); };
    const hideOnPress = (e) => {
      const el = e?.currentTarget;
      if (el && (typeof el === 'object' || typeof el === 'function')) {
        pressedControls.add(el);
      }
      hide();
    };
    const resetAfterLeave = (e) => {
      const el = e?.currentTarget;
      if (el && (typeof el === 'object' || typeof el === 'function')) {
        pressedControls.delete(el);
      }
      hide();
    };
    return {
      onMouseEnter: show,
      onMouseLeave: resetAfterLeave,
      onFocus: show,
      onBlur: resetAfterLeave,
      onMouseDown: hideOnPress,
      onPointerDown: hideOnPress,
    };
  };
}

/**
 * Context carrying the live `setTooltip` down the viewer tree so rail and
 * sidebar controls can opt in without every intermediate component threading a
 * prop through. PDFViewer owns the state and renders <FloatingTooltip>;
 * AppShell publishes its setter here.
 */
export const TooltipContext = createContext(null);

export function TooltipProvider({ setTooltip, children }) {
  const binding = useMemo(() => makeTooltipBinding(setTooltip), [setTooltip]);
  return <TooltipContext.Provider value={binding}>{children}</TooltipContext.Provider>;
}

/**
 * Returns the `tip(text, placement)` binder. Safe to call outside a provider —
 * it degrades to a no-op bundle rather than throwing, so a component can be
 * rendered on the hub (where there is no viewer tooltip host) unchanged.
 */
const NOOP_BINDING = () => ({});
export function useTooltip() {
  return useContext(TooltipContext) || NOOP_BINDING;
}

/**
 * Anchored variant for indicators that own their own hover state and want the
 * chip positioned relative to themselves rather than to the viewport — the sync
 * status and active users indicators in the sidebar rail.
 *
 * The parent must be `position: relative`. `side` mirrors the placement names
 * used by the floating chip so the two read the same in code.
 */
const ANCHORED_POSITION = {
  right: { left: 'calc(100% + 8px)', top: '50%', transform: 'translateY(-50%)' },
  left: { right: 'calc(100% + 8px)', top: '50%', transform: 'translateY(-50%)' },
  above: { left: '50%', bottom: 'calc(100% + 8px)', transform: 'translateX(-50%)' },
  below: { left: '50%', top: 'calc(100% + 8px)', transform: 'translateX(-50%)' },
};

export function AnchoredTooltip({ visible = true, side = 'right', position = null, children }) {
  if (!visible || !children) return null;
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        ...(position || ANCHORED_POSITION[side] || ANCHORED_POSITION.right),
        zIndex: 1000,
        ...TOOLTIP_SURFACE,
      }}
    >
      {children}
    </div>
  );
}

export default FloatingTooltip;
