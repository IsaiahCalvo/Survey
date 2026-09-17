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
 *   the component does NOT maintain its own angle state. The input itself is
 *   uncontrolled (defaultValue + ref reads on commit) so user keystrokes are
 *   never lost to React reconciliation. A sync useEffect pushes external
 *   angle changes into input.value when the user is not focused.
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
 * - If the user starts a rotation drag, the sync useEffect pushes the live
 *   drag angle into input.value even while focused (isRotating overrides the
 *   isFocused guard). Drag always wins; any in-progress typing is overwritten
 *   character-by-character.
 *
 * Visual contract (UI-SPEC LOCKED — no new tokens may be introduced here):
 * - Container: 60×28px, #181c24 bg, 1px solid #2a3140 border (focused: #4A9EFF),
 *   borderRadius 6px, boxShadow '0 4px 12px rgba(0,0,0,0.3)'
 * - Input value: 13px / 500 weight / -0.2px letter-spacing / #e8e2d4 / center-aligned
 * - ° suffix span: 12px / 400 weight / #8d96a6 / pointer-events none
 * - z-index 101 (one above the overlay div's 100, below Pdfjs controls)
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
const LOG = false;
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
  // UNCONTROLLED INPUT (Round 5 fix): we use defaultValue + read inputRef on
  // commit instead of a controlled `value={...}` prop. The controlled-input
  // pattern was racing with React re-renders during typing and silently
  // dropping keystrokes (no `input` event despite valid keydowns). With an
  // uncontrolled input, React touches input.value only on mount and via the
  // sync useEffect below; user keystrokes flow through normally.
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

  // Round 7 diagnostic A — TRUE component lifecycle (empty deps). Distinct
  // from Debug log 1 above, which is gated on isVisible. This fires ONCE
  // when the React component instance mounts and ONCE on cleanup. If the
  // user types in the input and we see a cleanup→mount cycle here, the
  // parent (SVGAnnotationLayer) is unmounting/remounting RotationInputField,
  // which would explain focus loss.
  useEffect(() => {
    if (!LOG) return;
    console.log(`[RotationInputField] LIFECYCLE mount — instance created`);
    return () => {
      console.log(`[RotationInputField] LIFECYCLE unmount — instance destroyed`);
    };
  }, []);

  // Round 7 diagnostic B — document-level focusout listener with
  // relatedTarget, attached only when this instance is visible. The
  // relatedTarget property of focusout is the element that RECEIVES focus
  // next — this tells us conclusively WHO is stealing focus from our input.
  // Replaces the previous prototype monkey-patch which was broken at scale
  // (there are 7 RotationInputField instances mounted, one per PDF page,
  // and 7 nested prototype patches corrupted HTMLInputElement.prototype.blur).
  useEffect(() => {
    if (!LOG || !isVisible) return;
    const handleFocusOut = (e) => {
      if (e.target !== inputRef.current) return;
      const rt = e.relatedTarget;
      const rtTag = rt?.tagName ?? 'null';
      const rtAria = rt?.getAttribute?.('aria-label') ?? '';
      const rtCls = (rt?.className?.toString?.() ?? '').slice(0, 60);
      const rtId = rt?.id ?? '';
      const rtTxt = (rt?.textContent ?? '').trim().slice(0, 30);
      console.log(
        `[RotationInputField] FOCUSOUT — relatedTarget=${rtTag}${rtAria ? `(${rtAria})` : ''}${rtId ? ` id=${rtId}` : ''}${rtTxt ? ` text="${rtTxt}"` : ''}${rtCls ? ` class="${rtCls}"` : ''}`
      );
    };
    document.addEventListener('focusout', handleFocusOut, true);
    return () => document.removeEventListener('focusout', handleFocusOut, true);
  }, [isVisible]);

  // Round 7 diagnostic E — native input event listener on the input itself.
  // Confirms whether the browser actually inserted characters into
  // input.value after each keydown. If we see keydowns (line 224-225 of
  // 1.log) but no INPUT events, something is preventing default insertion.
  // If we see INPUT events but the value reverts, the sync useEffect is
  // overwriting valid typed chars after focus loss.
  useEffect(() => {
    if (!LOG || !isVisible || !inputRef.current) return;
    const inputEl = inputRef.current;
    const handler = (e) => {
      console.log(`[RotationInputField] INPUT event value="${e.target.value}"`);
    };
    inputEl.addEventListener('input', handler);
    return () => inputEl.removeEventListener('input', handler);
  }, [isVisible]);

  // Round 7 diagnostic C — track input DOM element identity across renders.
  // If React reconciles the <input> as a new element (different node than
  // the previous render), focus is lost as a side effect. Runs after every
  // render with no deps. Logs only when identity actually changes.
  // NOTE: never pass DOM nodes directly to console.log — Vite's HMR overlay
  // will JSON.stringify the args and crash on the React fiber circular ref.
  // Log stable descriptors (presence + tagName) instead.
  const lastInputElRef = useRef(null);
  const inputIdentityCounterRef = useRef(0);
  useEffect(() => {
    if (!LOG) return;
    if (lastInputElRef.current !== inputRef.current) {
      inputIdentityCounterRef.current += 1;
      const prevTag = lastInputElRef.current ? lastInputElRef.current.tagName : 'null';
      const nextTag = inputRef.current ? inputRef.current.tagName : 'null';
      console.log(
        `[RotationInputField] INPUT IDENTITY CHANGED #${inputIdentityCounterRef.current} prev=${prevTag} next=${nextTag}`
      );
      lastInputElRef.current = inputRef.current;
    }
  });

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

  // Sync external angle into the uncontrolled input.value when:
  // (a) the user is NOT focused (live updates from props/persisted state)
  // (b) OR a rotation drag is active (drag wins — Pitfall 9)
  // When the user has focus and is NOT dragging, we leave input.value alone
  // so their in-progress typing is never clobbered.
  useEffect(() => {
    if (!inputRef.current) return;
    if (!isFocused || isRotating) {
      const next = String(Math.round(angle));
      if (inputRef.current.value !== next) {
        inputRef.current.value = next;
      }
    }
  }, [angle, isFocused, isRotating]);

  // Round 6 fix: window-capture keydown guard. Runs FIRST in the DOM event
  // flow (before any document-capture listener including Pdfjs's PDF
  // viewer intercept). When our input has focus, this guard calls
  // e.stopPropagation() to prevent any downstream listener from firing —
  // crucially, no other listener can call preventDefault() on the keydown,
  // so the browser's default text-insertion action proceeds normally.
  // Digit-only filtering and Enter/Escape/Arrow handling move here too,
  // so the React onKeyDown handler on the input becomes redundant (kept as
  // a no-op stopPropagation safety net).
  useEffect(() => {
    if (!isVisible) return;
    const guard = (e) => {
      if (!inputRef.current || document.activeElement !== inputRef.current) return;
      // Stop propagation so Pdfjs / PAL / App handlers can't see this
      // event and can't preventDefault on it.
      e.stopPropagation();
      if (LOG) {
        console.log(`[RotationInputField] guard keydown key=${e.key} defaultPrevented=${e.defaultPrevented}`);
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        commitTypedRef.current?.();
        inputRef.current?.blur();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (inputRef.current) inputRef.current.value = String(Math.round(angleRef.current));
        onCancelRef.current?.();
        inputRef.current?.blur();
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const step = (e.shiftKey ? 45 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
        const cur = Number(inputRef.current?.value);
        const base = Number.isFinite(cur) ? cur : Math.round(angleRef.current);
        const next = normalizeTypedDegrees(base + step);
        if (next !== null) {
          if (inputRef.current) inputRef.current.value = String(next);
          onCommitRef.current?.(annotationIndexRef.current, next);
        }
        return;
      }
      // Navigation/edit keys — let the browser handle natively.
      const NAV = new Set(['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab']);
      if (NAV.has(e.key)) return;
      // Single printable char — accept digits 0-9, block everything else.
      if (e.key.length === 1 && !/^[0-9]$/.test(e.key)) {
        e.preventDefault();
      }
      // Multi-char keys (F1-F12, etc.) — let through.
    };
    window.addEventListener('keydown', guard, { capture: true });
    return () => window.removeEventListener('keydown', guard, { capture: true });
  }, [isVisible]);

  // Refs for the latest values so the window-capture guard (which has empty
  // deps) can read them without re-attaching on every render.
  const angleRef = useRef(angle);
  const annotationIndexRef = useRef(annotationIndex);
  const commitTypedRef = useRef(null);
  const onCommitRef = useRef(onCommit);
  const onCancelRef = useRef(onCancel);
  useEffect(() => { angleRef.current = angle; }, [angle]);
  useEffect(() => { annotationIndexRef.current = annotationIndex; }, [annotationIndex]);
  useEffect(() => { onCommitRef.current = onCommit; }, [onCommit]);
  useEffect(() => { onCancelRef.current = onCancel; }, [onCancel]);

  if (LOG) {
    console.log(
      `[RotationInputField] render angle=${angle} isRotating=${isRotating} isFocused=${isFocused} isVisible=${isVisible}`
    );
  }

  // Commit the typed value (Enter or blur). Reads directly from inputRef.
  const commitTyped = useCallback(() => {
    const raw = inputRef.current?.value;
    if (raw == null || raw === '') {
      // Empty = silent revert. Restore display to current persisted angle.
      if (inputRef.current) inputRef.current.value = String(Math.round(angle));
      onCancel?.();
      return;
    }
    const normalized = normalizeTypedDegrees(raw);
    if (normalized === null) {
      // CONTEXT.md: "Invalid input (non-numeric, empty) = silently revert".
      if (inputRef.current) inputRef.current.value = String(Math.round(angle));
      onCancel?.();
      return;
    }
    onCommit?.(annotationIndex, normalized);
  }, [angle, annotationIndex, onCommit, onCancel]);

  // Sync commitTyped into ref for the window-capture guard.
  useEffect(() => { commitTypedRef.current = commitTyped; }, [commitTyped]);

  const handleKeyDown = useCallback((e) => {
    // React onKeyDown is a no-op now — all key handling moved to the
    // window-capture guard below (see Round 6 fix). Reason: something in the
    // capture-phase chain (suspected: Pdfjs's PDF viewer document-level
    // listener, or Electron's keyboard intercept) was preventDefault-ing
    // digit keystrokes BEFORE they reached the input, blocking text
    // insertion entirely. The window-capture guard runs first in the event
    // flow and calls stopPropagation, so no other listener ever sees the
    // event — including the one that was killing default text insertion.
    e.stopPropagation();

    // Debug log 4 — every keydown the input sees, with stopPropagation +
    // activeElement so we can verify focus is actually on the input.
    if (LOG) {
      const ae = document.activeElement;
      const aeTag = ae?.tagName || 'null';
      const aeLabel = ae?.getAttribute?.('aria-label') || '';
      console.log(`[RotationInputField] keydown key=${e.key} activeEl=${aeTag}${aeLabel ? `(${aeLabel})` : ''} stopPropagation=true`);
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
      const current = Number(inputRef.current?.value);
      const base = Number.isFinite(current) ? current : Math.round(angle);
      const newValue = normalizeTypedDegrees(base + step);
      if (newValue !== null) {
        if (inputRef.current) inputRef.current.value = String(newValue);
        onCommit?.(annotationIndex, newValue);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const step = e.shiftKey ? 45 : 1;
      const current = Number(inputRef.current?.value);
      const base = Number.isFinite(current) ? current : Math.round(angle);
      const newValue = normalizeTypedDegrees(base - step);
      if (newValue !== null) {
        if (inputRef.current) inputRef.current.value = String(newValue);
        onCommit?.(annotationIndex, newValue);
      }
      return;
    }

    // UX: whole-integer-only input. The user wants the pill to accept 0-9
    // digits and nothing else — no letters, no spaces, no periods/minus
    // signs, no symbols. Navigation keys (Tab, Home, End, left/right arrow)
    // and text-editing keys (Backspace, Delete) are explicitly allowed so
    // the user can position the cursor and erase mistakes. Modifier-only
    // keystrokes (Shift, Ctrl, Alt, Meta) are multi-char `e.key` values and
    // so are not blocked by the single-printable-char filter below.
    const NAV_AND_EDIT_KEYS = new Set([
      'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab',
    ]);
    if (NAV_AND_EDIT_KEYS.has(e.key)) {
      // Let the browser handle cursor positioning and deletion natively.
      return;
    }
    if (e.key.length === 1) {
      // Printable single-character key. Accept only 0-9; block everything
      // else (letters, spaces, punctuation, symbols) via preventDefault so
      // no non-digit character ever reaches the input's value.
      if (!/^[0-9]$/.test(e.key)) {
        e.preventDefault();
      }
      return;
    }
    // Multi-char keys (F1-F12, PageUp, etc.) — harmless, let through.
  }, [angle, annotationIndex, onCommit, commitTyped]);

  // UX: also stop keyup so any global shortcut listening on keyup (less common
  // but possible) can't fire while the pill has focus. Symmetric with keydown.
  // NOTE: only the React synthetic stopPropagation — not nativeEvent
  // stopImmediatePropagation — for the same reason as handleKeyDown.
  const handleKeyUp = useCallback((e) => {
    e.stopPropagation();
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
      // UX: stop the FULL click cycle (down → up → click) from propagating to
      // the SVG layer below. Stopping only the down events let the up/click
      // events bubble to a parent handler that was stealing focus on mouseup
      // — symptom: "if I hold mouse down I can type, but releasing dismisses
      // the input." Stopping both down AND up events keeps focus stable.
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
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
        background: 'var(--surface-2)',
        border: isFocused ? '1px solid var(--border-strong)' : '1px solid var(--border)',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        // UX: zIndex 101 is one above the overlay div's 100 (App.jsx) so the
        // input sits visually above the SVG annotation layer inside the same
        // host div. Below Pdfjs's native page controls (>1000) per the
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
        // UNCONTROLLED: defaultValue seeds the initial render only; subsequent
        // external angle updates are pushed via the sync useEffect above.
        // Round 5 fix: controlled `value=` was racing with re-renders during
        // typing and dropping keystrokes silently.
        defaultValue={String(Math.round(angle))}
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
          // (#2a3140 → #4A9EFF), not the browser default outline. Matches the
          // zoom-input precedent at App.jsx:26468-26470.
          outline: 'none',
          color: 'var(--text-2)',
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
          color: 'var(--text-3)',
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
