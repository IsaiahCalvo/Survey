/**
 * RotationInputField
 *
 * EDIT-12 (Phase 12 Plan 02): An HTML portal degree input that overlays the
 * SVG rotation handle (mtr) and lets the user type an exact rotation angle.
 *
 * Architecture (per CONTEXT.md + UI-SPEC):
 * - Native HTML <input> portaled into the persistent overlay div that hosts
 *   SVGAnnotationLayer. NOT inside the SVG <g> — avoids foreignObject focus/
 *   IME quirks and avoids counter-rotation math.
 * - Self-positions via getBoundingClientRect() on the mtr handle group, which
 *   is queried by `data-rotation-handle="mtr"` (Task 2).
 * - 16px above the handle's top edge in screen pixels, always upright (never
 *   rotates with the shape).
 * - Single source of truth: the live drag angle is read from `angle` prop —
 *   the component does NOT maintain its own angle state. Internal state ONLY
 *   tracks the typed (uncommitted) value while the input has focus.
 *
 * Visibility (parent-owned state machine — see SVGAnnotationLayer.jsx):
 * - Hidden by default
 * - Visible after 150ms hover-intent on the mtr handle, OR immediately on
 *   rotation drag start
 * - 500ms grace period after cursor leaves the handle so the user can travel
 *   to the input pill
 * - Disappears on commit + blur + grace expiry, OR on deselect
 *
 * Keyboard semantics (scoped to the focused input — no global listeners):
 * - Enter   = commit typed value, normalized to [0, 360)
 * - Escape  = cancel + revert to pre-edit angle
 * - Blur    = commit (Figma/Excalidraw convention)
 * - ArrowUp/ArrowDown    = ±1° immediate commit
 * - Shift+ArrowUp/Down   = ±45° immediate commit
 * - Invalid input (non-numeric, empty) on commit/blur = silent revert
 *
 * Drag-wins rule (Pitfall 9):
 * - If the user starts a rotation drag while the input has focus and a
 *   pending typed value, the drag's live angle overwrites the displayed value
 *   character-by-character. Drag always wins; the typed value is silently
 *   discarded. Implemented by clearing typedValue when isRotating becomes true.
 *
 * Visual contract (UI-SPEC LOCKED — no new tokens may be introduced here):
 * - Container: 60×28px, #2D2D2D bg, 1px solid #3A3A3A border (focused: #4A9EFF),
 *   borderRadius 6px, boxShadow '0 4px 12px rgba(0,0,0,0.3)'
 * - Input value: 13px / 500 weight / -0.2px letter-spacing / #ddd / center-aligned
 * - ° suffix span: 12px / 400 weight / #999 / pointer-events none
 * - z-index 101 (one above the overlay div's 100, below Syncfusion controls)
 * - FONT_FAMILY: project-wide stack re-declared locally (house style — used
 *   in 14+ files; the 2026-04-08 Fabric.js single-name gotcha does NOT apply
 *   to HTML <input>; the browser handles fallback stacks correctly)
 *
 * Phase 12 Plan 02 Task 3.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { normalizeTypedDegrees, computeInputPosition } from '../utils/rotationInputHelpers';

// UX: project-wide font stack re-declared locally per house style (used in 14+
// files including App.jsx:116). The 2026-04-08 Fabric.js multi-font gotcha
// does NOT apply here — this is an HTML <input>, not a Fabric Textbox; the
// browser resolves fallback stacks correctly for DOM elements.
const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

// UX: input pill dimensions locked in 12-UI-SPEC.md. 60px fits a 3-digit
// integer + ° suffix; 28px matches the zoom-input clickable area; 16px gap
// above mirrors the `md` spacing token (8-point scale); 4px edge margin
// keeps the input on-screen near page edges at low zoom.
const INPUT_WIDTH = 60;
const INPUT_HEIGHT = 28;
const GAP_ABOVE = 16;
const EDGE_MARGIN = 4;

// Debug logging toggle. Set to false to silence all [RotationInputField] logs.
// Live-angle log is throttled to ~100ms so it doesn't spam the console at 60fps.
const LOG = true;
const LIVE_LOG_THROTTLE_MS = 100;

function RotationInputField({
  svgRef,             // React ref to the SVGAnnotationLayer's root <svg>
  hostEl,             // The DOM <div> that hosts SVGAnnotationLayer (portal target)
  angle,              // Current angle in degrees [0, 360). Live drag angle when
                      // isRotating, otherwise the persisted obj.angle.
  annotationIndex,    // Index of the selected annotation in annotations.objects[]
  isRotating,         // True while a rotation drag is active (visualTransform.rotate set)
  isVisible,          // True when input should render (parent-owned visibility gate)
  shapeCenterViewBox, // { x, y } in viewBox (page) coords — pill anchors radially OUTWARD from this point through the mtr handle. Converted to screen via svgRef.current.getScreenCTM().
  onCommit,           // (annotationIndex, newAngle) => void — parent saves
  onCancel,           // () => void — parent reverts/clears any pending state
  onHoverChange,      // (hovered: boolean) => void — drives 500ms grace timer
}) {
  // Internal state ONLY tracks the typed (uncommitted) value while focused.
  // Live drag angle is read from props — single source of truth (Pitfall 9).
  const [typedValue, setTypedValue] = useState(null);
  const [isFocused, setIsFocused] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  const inputRef = useRef(null);
  // UX: cache host rect once per visible session to avoid 60fps layout reflow
  // jank during rotation drag (Pitfall 11). Only the handle rect needs to be
  // recomputed on each pointermove; the host div doesn't move during a drag.
  const cachedHostRectRef = useRef(null);
  // Debug-only refs: throttle live-angle log + remember whether we already
  // logged the "drag started" event for the current drag session.
  const lastLiveLogTsRef = useRef(0);
  const dragLoggedRef = useRef(false);

  // Recompute position when angle changes (drives "input follows handle during
  // drag") OR when visibility transitions hidden → visible (one-shot position).
  useEffect(() => {
    if (!isVisible || !svgRef?.current || !hostEl) return;

    const handleEl = svgRef.current.querySelector('[data-rotation-handle="mtr"]');
    if (!handleEl) return;

    // Cache host rect on first compute (avoid 60fps reflow — Pitfall 11)
    if (!cachedHostRectRef.current) {
      cachedHostRectRef.current = hostEl.getBoundingClientRect();
    }

    const handleRect = handleEl.getBoundingClientRect();

    // Convert shape center from viewBox (page) coords → screen coords using
    // the SVG's CTM. The handle's getBoundingClientRect() is already in
    // screen coords, so both values land in the same frame for the radial
    // vector math in computeInputPosition.
    let shapeCenterScreen = null;
    if (shapeCenterViewBox) {
      const ctm = svgRef.current.getScreenCTM();
      if (ctm) {
        const point = new DOMPoint(shapeCenterViewBox.x, shapeCenterViewBox.y);
        const screenPt = point.matrixTransform(ctm);
        shapeCenterScreen = { x: screenPt.x, y: screenPt.y };
      }
    }

    const newPos = computeInputPosition(
      handleRect,
      cachedHostRectRef.current,
      shapeCenterScreen,
      INPUT_WIDTH,
      INPUT_HEIGHT,
      GAP_ABOVE,
      EDGE_MARGIN
    );

    // Debug log 2 — position computation. Throttled with the same gate as
    // the live-angle log so a 60fps rotation drag doesn't spam the console.
    if (LOG) {
      const now = Date.now();
      const handleCx = (handleRect.left + handleRect.width / 2).toFixed(1);
      const handleCy = (handleRect.top + handleRect.height / 2).toFixed(1);
      const sc = shapeCenterScreen
        ? `(${shapeCenterScreen.x.toFixed(1)}, ${shapeCenterScreen.y.toFixed(1)})`
        : 'null';
      let vec = 'n/a';
      let unit = 'n/a';
      if (shapeCenterScreen) {
        const vx = parseFloat(handleCx) - shapeCenterScreen.x;
        const vy = parseFloat(handleCy) - shapeCenterScreen.y;
        const len = Math.hypot(vx, vy);
        vec = `(${vx.toFixed(1)}, ${vy.toFixed(1)})`;
        if (len > 0.0001) {
          unit = `(${(vx / len).toFixed(3)}, ${(vy / len).toFixed(3)})`;
        }
      }
      // Always log on visibility transition (lastLiveLogTsRef==0), throttle otherwise.
      const shouldLog = !isRotating || (now - lastLiveLogTsRef.current >= LIVE_LOG_THROTTLE_MS);
      if (shouldLog) {
        console.log(
          `[RotationInputField] position handle=(${handleCx}, ${handleCy}) shapeCenter=${sc} vec=${vec} unit=${unit} pillTopLeft=(${newPos.left.toFixed(1)}, ${newPos.top.toFixed(1)})`
        );
      }
    }

    // Issue 4 fix B: only call setPosition when the new value actually
    // differs from the previous. This prevents object-reference jitter from
    // upstream (e.g. parent re-render with a new newPos object that's
    // numerically identical) from triggering a needless re-render that
    // could interfere with controlled-input onChange.
    setPosition(prev => {
      if (prev.left === newPos.left && prev.top === newPos.top) return prev;
      return newPos;
    });
  }, [angle, isVisible, isRotating, svgRef, hostEl, shapeCenterViewBox]);

  // Invalidate cached host rect when visibility goes hidden so the next show
  // recomputes against fresh layout (handles scroll/zoom between sessions).
  useEffect(() => {
    if (!isVisible) {
      cachedHostRectRef.current = null;
    }
  }, [isVisible]);

  // Debug log 1 — mount / unmount transition tied to the visibility gate.
  useEffect(() => {
    if (!LOG) return;
    if (isVisible) {
      console.log(`[RotationInputField] mount angle=${Math.round(angle)} visible=true annotationIndex=${annotationIndex}`);
    } else {
      console.log(`[RotationInputField] unmount visible=false`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible]);

  // Debug log 6 + 7 — track rotation drag start (one-shot per drag session)
  // and live-angle updates (throttled to LIVE_LOG_THROTTLE_MS).
  useEffect(() => {
    if (!LOG) return;
    if (isRotating) {
      if (!dragLoggedRef.current) {
        dragLoggedRef.current = true;
        console.log(`[RotationInputField] drag started, live-tracking angle`);
      }
      const now = Date.now();
      if (now - lastLiveLogTsRef.current >= LIVE_LOG_THROTTLE_MS) {
        lastLiveLogTsRef.current = now;
        console.log(`[RotationInputField] live angle=${Math.round(angle)} (integer rounded)`);
      }
    } else if (dragLoggedRef.current) {
      // Drag just ended — reset the one-shot flag for next session.
      dragLoggedRef.current = false;
      console.log(`[RotationInputField] drag ended`);
    }
  }, [isRotating, angle]);

  // Drag-wins rule (Pitfall 9): when isRotating becomes true, clear any
  // pending typed value so the displayed value snaps back to the live drag
  // angle. Typed input during an active drag is silently discarded.
  useEffect(() => {
    if (isRotating && typedValue !== null) {
      // Issue 4 diagnostic: log when drag clobbers a pending typed value.
      // If this fires unexpectedly on every keystroke, the drag-wins rule
      // is misfiring and silently dropping the user's input.
      if (LOG) {
        console.log(`[RotationInputField] DRAG RESETS typedValue="${typedValue}" → null (drag-wins rule)`);
      }
      setTypedValue(null);
    }
  }, [isRotating, typedValue]);

  // Display value: live drag angle wins over typed value. When not rotating
  // and no pending typed value, show the integer-rounded current angle
  // (CONTEXT.md: "integer degrees only — display and accept whole numbers 0-359").
  const displayValue = (isRotating || typedValue === null)
    ? String(Math.round(angle))
    : typedValue;

  // Issue 4 diagnostic: log every render with the full input-state snapshot
  // so we can see whether typedValue is being reset between user keystrokes.
  // Critical sequence to watch for in DevTools:
  //   onChange prevTyped=null newValue="9"  ← user typed
  //   render typedValue="9" displayValue="9"  ← React reflected the new state
  // If you see:
  //   onChange prevTyped=null newValue="9"
  //   render typedValue=null displayValue="0"  ← typedValue was clobbered
  // …then something is resetting typedValue between onChange and the next render.
  if (LOG) {
    console.log(
      `[RotationInputField] render typedValue=${JSON.stringify(typedValue)} displayValue="${displayValue}" angle=${angle} isRotating=${isRotating} isFocused=${isFocused} isVisible=${isVisible}`
    );
  }

  // Commit the typed value (Enter or blur).
  const commitTyped = useCallback(() => {
    if (typedValue === null) return;  // No pending typed value to commit
    const normalized = normalizeTypedDegrees(typedValue);
    if (normalized === null) {
      // Silent revert — CONTEXT.md: "Invalid input (non-numeric, empty) =
      // silently revert on commit/blur". No error UI, no red border, no toast.
      setTypedValue(null);
      onCancel?.();
      return;
    }
    onCommit?.(annotationIndex, normalized);
    setTypedValue(null);
  }, [typedValue, annotationIndex, onCommit, onCancel]);

  const handleChange = useCallback((e) => {
    // Issue 4 diagnostic: log every onChange so we can verify the controlled
    // input is actually receiving keystrokes from the browser. If onChange
    // never fires after a keydown, that means a capture-phase listener
    // somewhere is calling preventDefault on the keydown before the browser
    // can perform the default text-insertion action.
    if (LOG) {
      console.log(`[RotationInputField] onChange prevTyped=${JSON.stringify(typedValue)} newValue="${e.target.value}" angle=${angle}`);
    }
    setTypedValue(e.target.value);
  }, [typedValue, angle]);

  const handleKeyDown = useCallback((e) => {
    // UX: ALL keydowns inside the input are isolated from document/window-level
    // shortcut handlers so Backspace/Delete don't delete the underlying shape
    // and ArrowLeft/ArrowRight don't flip pages in single-scroll mode. The
    // shape stays SELECTED — only the KEYBOARD events are stopped at the pill
    // boundary. We stop propagation FIRST so even branches that early-return
    // below still block the bubble.
    //
    // Belt-and-suspenders: stop both the React synthetic event and the native
    // event. nativeEvent.stopImmediatePropagation() prevents any subsequent
    // bubble-phase listener from receiving the event (capture-phase listeners
    // that already ran before this React handler can't be undone — they rely
    // on their own document.activeElement guards, which are present in all
    // known cases at App.jsx, PageAnnotationLayer.jsx, SVGAnnotationLayer.jsx,
    // and Callout/index.jsx).
    e.stopPropagation();
    if (e.nativeEvent && typeof e.nativeEvent.stopImmediatePropagation === 'function') {
      e.nativeEvent.stopImmediatePropagation();
    }

    // Debug log 4 — every keydown the input sees, with the stopPropagation
    // confirmation so the user can verify the bubble-block is actually firing.
    if (LOG) {
      console.log(`[RotationInputField] keydown key=${e.key} stopPropagation=true`);
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      commitTyped();
      inputRef.current?.blur();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      // Revert: clear pending typed value, blur input, parent restores angle.
      setTypedValue(null);
      onCancel?.();
      inputRef.current?.blur();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      // UX: ±1° per press matches engineering-drawing intuition; Shift+Arrow
      // jumps by 45° (the Phase 12 snap increment) so users can quickly cycle
      // 0/45/90/135. Scoped to this input — no global keydown listener.
      const step = e.shiftKey ? 45 : 1;
      const base = typedValue !== null
        ? (Number(typedValue) || 0)
        : Math.round(angle);
      const newValue = normalizeTypedDegrees(base + step);
      if (newValue !== null) {
        onCommit?.(annotationIndex, newValue);
        setTypedValue(null);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const step = e.shiftKey ? 45 : 1;
      const base = typedValue !== null
        ? (Number(typedValue) || 0)
        : Math.round(angle);
      const newValue = normalizeTypedDegrees(base - step);
      if (newValue !== null) {
        onCommit?.(annotationIndex, newValue);
        setTypedValue(null);
      }
      return;
    }
    // All other keys (digits, Backspace, Delete, letters) flow through to the
    // browser's native input handling — already stopPropagation'd above so
    // they NEVER reach SVGAnnotationLayer's Delete/Backspace shortcut.
  }, [typedValue, angle, annotationIndex, onCommit, commitTyped]);

  // UX: also stop keyup so any global shortcut listening on keyup (less common
  // but possible) can't fire while the pill has focus. Symmetric with keydown,
  // and uses the same React + native stop pattern.
  const handleKeyUp = useCallback((e) => {
    e.stopPropagation();
    if (e.nativeEvent && typeof e.nativeEvent.stopImmediatePropagation === 'function') {
      e.nativeEvent.stopImmediatePropagation();
    }
  }, []);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    // Debug log 3 — focus enter; user should see this once per click-into.
    if (LOG) {
      console.log(`[RotationInputField] focus — isolating keyboard`);
    }
  }, []);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    // Debug log 5 — focus leave; user should see this on Tab-out, click-away,
    // Enter (which calls inputRef.current?.blur()), or Escape.
    if (LOG) {
      console.log(`[RotationInputField] blur — resuming global keys`);
    }
    // Figma/Excalidraw convention: blur commits the typed value (not cancels).
    commitTyped();
  }, [commitTyped]);

  const handlePointerEnter = useCallback(() => {
    onHoverChange?.(true);
  }, [onHoverChange]);

  const handlePointerLeave = useCallback(() => {
    onHoverChange?.(false);
  }, [onHoverChange]);

  if (!isVisible || !hostEl) return null;

  return createPortal(
    <div
      data-rotation-input-field
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      // UX: stop pointer/mouse events from propagating to the SVG layer below
      // so clicking into the input doesn't trigger a deselect or a new drag.
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: position.left,
        top: position.top,
        width: INPUT_WIDTH,
        height: INPUT_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // UX: 4px gap (xs token) between input and ° suffix, 8px horizontal
        // padding (sm token) inside the pill — matches MiniToolbar precedent.
        gap: 4,
        padding: '0 8px',
        // UI-SPEC LOCKED tokens — DO NOT change without re-running the UI checker.
        background: '#2D2D2D',
        border: isFocused ? '1px solid #4A9EFF' : '1px solid #3A3A3A',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        // UX: zIndex 101 is one above the overlay div's 100 (App.jsx) so the
        // input sits visually above the SVG annotation layer inside the same
        // host div. Below Syncfusion's native page controls (>1000) per the
        // v2.0 portal architecture.
        zIndex: 101,
        fontFamily: FONT_FAMILY,
        boxSizing: 'border-box',
      }}
    >
      <input
        ref={inputRef}
        type="text"
        // UX: inputMode + pattern surfaces a numeric keypad on touch devices
        // (iPad Electron builds) — matches the zoom input accessibility pattern.
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label="Rotation angle in degrees"
        value={displayValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        // UX: belt-and-suspenders click stop — focusing the input via click
        // shouldn't propagate to the SVG layer below. The container's
        // onMouseDown/onPointerDown already stop pointer events; this catches
        // click events specifically (different React event channel).
        onClick={(e) => e.stopPropagation()}
        onFocus={handleFocus}
        onBlur={handleBlur}
        style={{
          width: '32px',
          height: '20px',
          background: 'transparent',
          border: 'none',
          // UX: outline none — focus is expressed by the container border swap
          // (#3A3A3A → #4A9EFF), not the browser default outline. Matches the
          // zoom-input precedent at App.jsx:26468-26470.
          outline: 'none',
          color: '#ddd',
          fontFamily: FONT_FAMILY,
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: '-0.2px',
          textAlign: 'center',
          padding: 0,
        }}
      />
      <span
        style={{
          fontFamily: FONT_FAMILY,
          fontSize: 12,
          fontWeight: 400,
          color: '#999',
          // UX: ° suffix is decorative — pointerEvents none so clicks pass
          // through to the input below it; userSelect none prevents accidental
          // text-selection drag on the symbol.
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        °
      </span>
    </div>,
    hostEl
  );
}

export default RotationInputField;
