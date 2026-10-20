/**
 * Pencil-only mode — Drawboard's "Annotate with Pencil or Touch" /
 * "Annotate with Pencil only" (drawboardAudit 2026-10-13, C2; the written
 * rules are docs/GESTURE-CONTRACT.md — keep the two in step).
 *
 * - `drawMode` 'touch' (default, today's behaviour): a finger runs the
 *   active tool like a pen or a mouse.
 * - `drawMode` 'pen': only a pen (pointerType 'pen', an Apple Pencil, a
 *   Surface/Wacom pen) runs the active tool. A finger always navigates: one
 *   finger pans, two fingers pan/pinch, a finger tap does nothing on the page,
 *   and a finger resting on the glass while the pen is down is ignored.
 * - The setting is offered only once a pen has been used on this device
 *   (`penSeen`, remembered). Using a pen never switches the mode by itself.
 *
 * How the finger is kept away from the tools: one window/capture pointer
 * gate, installed at module load. Every tool layer (SVG creation, selection
 * grab, Fabric eraser, text select, the select/eraser window listeners) hears
 * pointer events, so a finger press in Pencil-only mode is stopped there,
 * before any of them. Touch EVENTS are a separate stream and are never
 * stopped, so the viewer's touch pan/pinch (PdfjsViewerContainer) still runs.
 * dismissRules.js is imported first so its window guards keep the first look
 * (a finger on the bare page still closes an open popover, R2/R3).
 *
 * Browser storage is a per-device convenience: every read and write is
 * wrapped, and the in-memory value still works when storage is blocked.
 */
import '../components/dismissRules.js';
import { isLiveFormWidgetTarget } from './formWidgetPointerTargets.js';

export const DRAW_MODE_STORAGE_KEY = 'surveyDrawMode';
export const PEN_SEEN_STORAGE_KEY = 'surveyPenSeen';
export const DRAW_MODES = Object.freeze({ TOUCH: 'touch', PEN: 'pen' });
export const DRAW_MODE_OPTIONS = Object.freeze([
  Object.freeze({ mode: DRAW_MODES.TOUCH, label: 'Annotate with Pencil or Touch', short: 'Pencil or Touch', icon: 'touchDraw' }),
  Object.freeze({ mode: DRAW_MODES.PEN, label: 'Annotate with Pencil only', short: 'Pencil only', icon: 'pencilOnly' }),
]);

const isDrawMode = (mode) => mode === DRAW_MODES.TOUCH || mode === DRAW_MODES.PEN;

export function loadPencilModeState(storage = globalThis?.localStorage) {
  let drawMode = DRAW_MODES.TOUCH;
  let penSeen = false;
  try {
    const stored = storage?.getItem?.(DRAW_MODE_STORAGE_KEY);
    if (isDrawMode(stored)) drawMode = stored;
    penSeen = storage?.getItem?.(PEN_SEEN_STORAGE_KEY) === 'true';
  } catch (_) { /* storage blocked: defaults */ }
  // A device that never showed a pen has no way to turn Pencil-only off
  // again, so the mode only holds where the control is offered.
  if (!penSeen) drawMode = DRAW_MODES.TOUCH;
  return { drawMode, penSeen };
}

const write = (key, value, storage = globalThis?.localStorage) => {
  try { storage?.setItem?.(key, value); } catch (_) { /* in-memory only */ }
};

let state = loadPencilModeState();
const listeners = new Set();
const emit = () => { listeners.forEach((listener) => { try { listener(state); } catch (_) { /* keep going */ } }); };

export const getPencilModeState = () => state;
export const isPencilOnly = () => state.drawMode === DRAW_MODES.PEN;

/** useSyncExternalStore-shaped subscription. */
export function subscribePencilMode(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setDrawMode(mode) {
  if (!isDrawMode(mode) || state.drawMode === mode) return;
  state = { ...state, drawMode: mode };
  write(DRAW_MODE_STORAGE_KEY, mode);
  emit();
}

/** The first pen press on this device reveals the setting (never switches it). */
export function notePenSeen() {
  if (state.penSeen) return;
  state = { ...state, penSeen: true };
  write(PEN_SEEN_STORAGE_KEY, 'true');
  emit();
}

/** Test seam: reset the in-memory state (e.g. after swapping storage). */
export function __resetPencilModeForTests(next = loadPencilModeState()) {
  state = { ...next };
  emit();
}

// ---------------------------------------------------------------------------
// Pure routing rules (unit-tested in tests/pencilMode.test.mjs)
// ---------------------------------------------------------------------------

/** iOS reports an Apple Pencil contact as a Touch with touchType 'stylus'. */
export const isStylusTouch = (touch) => touch?.touchType === 'stylus';
export function hasStylusTouch(list) {
  if (!list) return false;
  for (let i = 0; i < list.length; i += 1) if (isStylusTouch(list[i])) return true;
  return false;
}

/** May a pointer of this type run the active tool? (Rule P1.) */
export function pointerMayUseTool(pointerType, drawMode = state.drawMode) {
  return !(drawMode === DRAW_MODES.PEN && pointerType === 'touch');
}

/**
 * Desktop-surface press routing (PdfjsViewerContainer onPointerDown).
 * 'pan' — the viewer pans this drag (momentum and edges as the Pan tool);
 * 'pass' — leave the press to the tools / the browser.
 *
 * - middle mouse button: always pans, never changes or runs the tool (C5);
 * - primary press in the grey margin around pages: pans with any tool (C3);
 * - Pan tool or a held Space: pans;
 * - a finger in Pencil-only mode: pans (the gate stopped it from the tools).
 */
export function resolveViewerPressRoute({ pointerType = 'mouse', button = 0, panArmed = false, onGutter = false, drawMode = state.drawMode } = {}) {
  if (pointerType === 'touch') return drawMode === DRAW_MODES.PEN ? 'pan' : 'pass';
  if (pointerType === 'mouse' && button === 1) return 'pan';
  if (button !== 0) return 'pass';
  if (panArmed || onGutter) return 'pan';
  return 'pass';
}

/**
 * Phone/tablet touchstart routing (PdfjsViewerContainer onTouchStart).
 * 'pen-tool' — the pen owns this contact (the tool runs; resting fingers are
 *   left alone); 'ignore' — a finger while the pen is down in Pencil-only
 *   mode: no pan, no pinch, no tool; 'pinch'; 'pan'; 'tool'.
 */
export function resolveTouchStartRoute({ touches = [], changedTouches = [], drawMode = state.drawMode, penDown = false, toolIsPan = false } = {}) {
  const pencilOnly = drawMode === DRAW_MODES.PEN;
  // P3 in both modes: a pen contact is never a finger, so a finger or knuckle
  // landing while the pen writes is set aside instead of turning the stroke
  // into a pinch/pan (T2 would drop the stroke and move the page).
  if (penDown || hasStylusTouch(touches)) {
    return hasStylusTouch(changedTouches) ? 'pen-tool' : 'ignore';
  }
  if (touches.length >= 2) return 'pinch';
  if (toolIsPan || pencilOnly) return 'pan';
  return 'tool';
}

// ---------------------------------------------------------------------------
// The window/capture gate (finger presses in Pencil-only mode) + pen tracking
// ---------------------------------------------------------------------------

const VIEWER_SELECTOR = '[data-mobile-pdf-surface]';
// Controls inside the viewer keep working with a finger (the same list the
// selection grab never claims, plus the toolbars layered on the page).
const FINGER_CONTROL_SELECTOR = 'button, input, textarea, select, a[href], [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="dialog"], [role="toolbar"], [data-pan-interactive="true"], [data-counter-caret-popup], [data-text-edit-overlay], [data-rich-text-toolbar], [data-mini-toolbar]';
const CLICK_AFTER_GATED_TAP_MS = 700;

const elementOf = (target) => (target && target.nodeType === 3 ? target.parentElement : target);

/** True for a finger press the tools must never see (Pencil-only mode). */
export function isGatedFingerTarget(target, drawMode = state.drawMode, penDown = false) {
  if (drawMode !== DRAW_MODES.PEN && !penDown) return false;
  const element = elementOf(target);
  if (!element || typeof element.closest !== 'function') return false;
  if (!element.closest(VIEWER_SELECTOR)) return false;
  if (element.closest(FINGER_CONTROL_SELECTOR)) return false;
  if (isLiveFormWidgetTarget(element)) return false;
  return true;
}

const gatedPointers = new Set();
const penPointers = new Set();
const gatedListeners = new Set();
let lastGatedUpAt = -Infinity;

export const isPenDown = () => penPointers.size > 0;
export const isGatedFingerPointer = (pointerId) => gatedPointers.has(pointerId);

/**
 * Hear the finger pointer events the gate kept from the tools (desktop
 * surface: they drive the viewer's pointer pan). Also told 'pen-down'.
 */
export function subscribeGatedPointers(listener) {
  gatedListeners.add(listener);
  return () => gatedListeners.delete(listener);
}
const tellGated = (event, kind) => {
  gatedListeners.forEach((listener) => { try { listener(event, kind); } catch (_) { /* keep going */ } });
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function onPointer(event) {
  const type = event.type;
  if (event.pointerType === 'pen') {
    if (type === 'pointerdown') {
      penPointers.add(event.pointerId);
      notePenSeen();
      tellGated(event, 'pen-down');
    } else if (type === 'pointerup' || type === 'pointercancel') {
      penPointers.delete(event.pointerId);
    }
    return;
  }
  if (event.pointerType !== 'touch') return;
  if (type === 'pointerdown') {
    // While a pen is down a finger never reaches the tools in either mode (P3).
    if (!isGatedFingerTarget(event.target, state.drawMode, penPointers.size > 0)) return;
    gatedPointers.add(event.pointerId);
  } else if (!gatedPointers.has(event.pointerId)) {
    return;
  }
  if (type === 'pointerup' || type === 'pointercancel') {
    gatedPointers.delete(event.pointerId);
    lastGatedUpAt = now();
  }
  event.stopImmediatePropagation();
  tellGated(event, 'finger');
}

// The click a finger tap makes after a gated press must not reach a tool
// either (a Text-tool or Survey-marker click, a select pick).
function onClick(event) {
  if (now() - lastGatedUpAt > CLICK_AFTER_GATED_TAP_MS) return;
  const fromTouch = event.pointerType === 'touch' || event.sourceCapabilities?.firesTouchEvents === true;
  // lastGatedUpAt already means this finger was gated. Do not re-read live
  // pen state: the pen has usually lifted by the time the leftover click
  // arrives, and isGatedFingerTarget defaults penDown to false.
  if (!fromTouch || !isGatedFingerTarget(event.target, state.drawMode, true)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

const gate = { onPointer, onClick };

/** Installs once; thin forwarders so a dev hot-reload swaps the logic. */
export function installPencilModeGate(win) {
  if (!win) return;
  win.__surveyPencilModeGate = gate;
  if (win.__surveyPencilModeGateInstalled) return;
  win.__surveyPencilModeGateInstalled = true;
  const forward = (event) => win.__surveyPencilModeGate?.onPointer(event);
  ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach((type) => {
    win.addEventListener(type, forward, { capture: true, passive: true });
  });
  ['click', 'dblclick'].forEach((type) => {
    win.addEventListener(type, (event) => win.__surveyPencilModeGate?.onClick(event), true);
  });
}

if (typeof window !== 'undefined') installPencilModeGate(window);

export const __pencilModeGateForTests = { onPointer, onClick, gatedPointers, penPointers };
