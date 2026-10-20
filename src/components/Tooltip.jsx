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
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  background: 'var(--surface-2)',
  color: 'var(--text-2)',
  border: '1px solid var(--border)',
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
  // KAL-66 (WCAG 1.4.13): Escape puts away the chip on screen without moving
  // focus - a keyboard user whose focus raised it can read what is under it.
  // The key is not consumed: an open menu or dialog still closes on the same
  // press. The next chip (another control, or the same one shown again) shows.
  const shownKey = tooltip?.visible ? `${tooltip.text}|${tooltip.x}|${tooltip.y}` : '';
  const [dismissedKey, setDismissedKey] = useState('');
  useEffect(() => {
    if (!shownKey || typeof window === 'undefined') return undefined;
    const onKeyDown = (event) => { if (event.key === 'Escape') setDismissedKey(shownKey); };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [shownKey]);
  useEffect(() => { if (!shownKey) setDismissedKey(''); }, [shownKey]);

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

  if (!tooltip?.visible || shownKey === dismissedKey || typeof document === 'undefined') return null;
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
      // KAL-65: a button held down means something is being dragged (a row
      // by its grip, a slider, a text selection). Rows slide under the
      // pointer while they reorder; their grips must not pop chips mid-drag.
      if (e?.buttons) return;
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
    // KAL-65 (2026-10-13): React drops onMouseEnter on a DISABLED button, so a
    // control whose hint explains why it is off ("Nothing to select",
    // "Templates is a Pro feature") never showed its chip - the native title=
    // it replaced did. Pointer events still reach a disabled control, so a
    // mouse pointer entering or leaving drives the chip too. Touch and pen are
    // ignored here exactly as before: a finger never raises a chip.
    const fromMouse = (handler) => (e) => {
      if (e?.pointerType && e.pointerType !== 'mouse') return;
      handler(e);
    };
    return {
      onMouseEnter: show,
      onMouseLeave: resetAfterLeave,
      onPointerEnter: fromMouse(show),
      onPointerLeave: fromMouse(resetAfterLeave),
      onFocus: show,
      onBlur: resetAfterLeave,
      onMouseDown: hideOnPress,
      onPointerDown: hideOnPress,
    };
  };
}

/**
 * Join a tooltip bundle with a control's own handlers of the same names
 * (a drag grip's pointerdown, a hover colour change), so spreading the bundle
 * never silently drops either side. The tooltip runs first, then the control.
 */
export function withOwnHandlers(bundle, own = {}) {
  const merged = { ...(bundle || {}) };
  Object.entries(own).forEach(([name, handler]) => {
    if (typeof handler !== 'function') return;
    const tipHandler = merged[name];
    merged[name] = tipHandler
      ? (event) => { tipHandler(event); handler(event); }
      : handler;
  });
  return merged;
}

/**
 * Hover-only bundle, for a text field whose hint ("Click to rename") is about
 * the pointer: once the caret is in the field the chip would only sit over
 * what the user is typing next to.
 */
export function hoverOnly(bundle) {
  const { onFocus, onBlur, ...rest } = bundle || {};
  return rest;
}

/**
 * Context carrying the live `setTooltip` down the viewer tree so rail and
 * sidebar controls can opt in without every intermediate component threading a
 * prop through. PDFViewer owns the state and renders <FloatingTooltip>;
 * AppShell publishes its setter here.
 */
export const TooltipContext = createContext(null);

/**
 * Returns the `tip(text, placement)` binder. Safe to call outside a provider —
 * it degrades to a no-op bundle rather than throwing, so a component can be
 * rendered somewhere with no tooltip host at all (a test, a dev route) unchanged.
 */
const NOOP_BINDING = () => ({});
export function useTooltip() {
  return useContext(TooltipContext) || NOOP_BINDING;
}

/**
 * A self-contained tooltip host: owns the chip state, renders one
 * <FloatingTooltip>, and publishes the binder to everything inside it.
 *
 * KAL-65 (2026-10-13): the viewer's chip lives in PDFViewer, so it only exists
 * while a document is mounted. The home hub and the tab strip are on screen
 * without one, which is why they kept native `title=` tooltips. They now sit
 * inside one of these, so a hub control and a viewer control show the same
 * chip, with the same instant timing, whether or not a document is open.
 *
 * The state lives in a child (<TooltipChipHost>), not here, so a hover only
 * re-renders the chip — never the hub or tab strip wrapped by this provider.
 * The binder is created once and stays stable for the provider's lifetime.
 *
 * Touch: nothing extra is needed here. The binder's press guard (see
 * makeTooltipBinding) marks a control on pointerdown, and a tap's emulated
 * mouseenter/focus arrive after it, so a tap never raises a chip over the
 * thing the finger just pressed.
 */
function TooltipChipHost({ setterRef }) {
  const [tooltip, setTooltip] = useState(TOOLTIP_HIDDEN);
  setterRef.current = setTooltip;
  return <FloatingTooltip tooltip={tooltip} />;
}

export function TooltipProvider({ children }) {
  const setterRef = useRef(null);
  const tip = useMemo(
    () => makeTooltipBinding((next) => setterRef.current?.(next)),
    [],
  );
  return (
    <TooltipContext.Provider value={tip}>
      {children}
      <TooltipChipHost setterRef={setterRef} />
    </TooltipContext.Provider>
  );
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
      // Lets states.css section 5 leave the hint out when the chrome icon it
      // sits inside grows or tightens (owner 2026-10-02).
      data-anchored-tooltip=""
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
