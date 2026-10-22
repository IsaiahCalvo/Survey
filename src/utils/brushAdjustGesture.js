/**
 * brushAdjustGesture.js — change the armed tool's width and opacity by
 * dragging on the page, copied from Photoshop (owner 2026-10-22).
 *
 * Photoshop: Windows, hold Alt and drag with the RIGHT button; Mac, hold
 * Control + Option and drag with the left button. Left / right changes the
 * brush size, up / down its hardness or (with the "Vary Round Brush Hardness
 * based on HUD vertical movement" preference off) its opacity. A preview of
 * the brush stays where the press began while the pointer moves away.
 *
 * Survey's version:
 *   - Same keys, on both systems (either works anywhere): Alt + right-button
 *     drag, or Ctrl + Alt (Control + Option) + left-button drag. A pen's
 *     barrel button is a right button, so Alt + barrel button works too.
 *     Touch never starts it (touch is pan-only).
 *   - Left / right = Width (Size for the eraser), up / down = Opacity. Survey
 *     strokes have no hardness, so vertical is always opacity; up = more solid.
 *   - The first clear direction locks the drag to that one setting until the
 *     button is let go. Photoshop changes both at once, and its most common
 *     complaint is opacity drifting while resizing.
 *   - Width steps grow with the width (every 120 px of drag doubles or halves
 *     it), because Survey widths are small numbers (1 to 50 pt) where a
 *     pixel-per-point drag would be far too twitchy at the low end.
 *   - The preview is a dot at the true on-screen size, in the tool's colour at
 *     the new opacity, with the values written under it.
 *   - Let go = the new values are set exactly as if picked in the toolbar
 *     (saved per tool, one change). Escape, losing the window or a cancelled
 *     pointer = nothing changes.
 *   - Only for tools that draw a stroke with a width: pen, highlighter,
 *     line, arrow, rectangle, ellipse, polygon, polyline, and the eraser (size
 *     only). Only while the toolbar is working for that tool (no picked mark
 *     it would restyle instead).
 *
 * The listeners are installed once, on window in the capture phase, when this
 * module is first imported — before any page layer registers its own — so a
 * press that starts the gesture never also starts a stroke, a marquee or the
 * right-click menu. The pure parts below are what the Node tests import.
 */

export const BRUSH_ADJUST_TOOLS = Object.freeze(new Set([
  'pen', 'highlighter', 'line', 'arrow', 'rect', 'ellipse', 'polygon', 'polyline', 'eraser',
]));

/** Screen pixels of drag before the gesture picks which setting it changes. */
export const BRUSH_ADJUST_AXIS_LOCK_PX = 4;
/** Screen pixels of sideways drag that double (or halve) the width. */
export const BRUSH_ADJUST_DOUBLING_PX = 120;
/** Screen pixels of up / down drag per 1 % of opacity. */
export const BRUSH_ADJUST_PX_PER_PERCENT = 2;
/** The least opacity the drag sets: a 0 % stroke would draw nothing. */
export const BRUSH_ADJUST_MIN_OPACITY = 5;

/** Does this press start the gesture? */
export function isBrushAdjustPress(event) {
  if (!event || event.pointerType === 'touch') return false;
  if (event.altKey !== true) return false;
  if (event.button === 2) return true;
  return event.button === 0 && event.ctrlKey === true;
}

function roundTo(value, step) {
  return Math.round(value / step) * step;
}

/**
 * The values for a drag of (dx, dy) screen pixels from the press.
 *
 * start: { width, opacity } as they were at the press.
 * axis: null until locked, then 'width' or 'opacity' (pass back what the
 *   previous call returned).
 * limits: { minWidth, maxWidth, decimals, opacity: false to never change it }.
 *
 * Returns { width, opacity, axis }.
 */
export function resolveBrushAdjust({ start, dx = 0, dy = 0, axis = null, limits = {} } = {}) {
  const minWidth = Number.isFinite(limits.minWidth) ? limits.minWidth : 1;
  const maxWidth = Number.isFinite(limits.maxWidth) ? limits.maxWidth : 50;
  const decimals = Number.isFinite(limits.decimals) ? limits.decimals : 1;
  const canOpacity = limits.opacity !== false;
  const startWidth = Math.min(maxWidth, Math.max(minWidth, Number(start?.width) || minWidth));
  const startOpacity = Math.min(100, Math.max(0, Number.isFinite(Number(start?.opacity)) ? Number(start.opacity) : 100));
  const x = Number(dx) || 0;
  const y = Number(dy) || 0;

  let lock = axis === 'width' || axis === 'opacity' ? axis : null;
  if (!lock && Math.max(Math.abs(x), Math.abs(y)) >= BRUSH_ADJUST_AXIS_LOCK_PX) {
    lock = (!canOpacity || Math.abs(x) >= Math.abs(y)) ? 'width' : 'opacity';
  }

  let width = startWidth;
  if (lock === 'width') {
    const raw = startWidth * 2 ** (x / BRUSH_ADJUST_DOUBLING_PX);
    // Half points under 10 (where they show), whole points above, and never
    // finer than the field keeps.
    const step = Math.max(raw < 10 ? 0.5 : 1, decimals > 0 ? 10 ** -decimals : 1);
    width = Math.min(maxWidth, Math.max(minWidth, roundTo(raw, step)));
    width = Number(width.toFixed(Math.max(0, decimals)));
  }

  let opacity = startOpacity;
  if (lock === 'opacity' && canOpacity) {
    const raw = startOpacity - y / BRUSH_ADJUST_PX_PER_PERCENT;
    opacity = Math.min(100, Math.max(Math.min(BRUSH_ADJUST_MIN_OPACITY, startOpacity), Math.round(raw)));
  }

  return { width, opacity, axis: lock };
}

/** The words under the preview dot. */
export function formatBrushAdjustLabel({ width, opacity, eraser = false } = {}) {
  const widthText = `${eraser ? 'Size' : 'Width'} ${Number(width)} pt`;
  return eraser ? widthText : `${widthText} · Opacity ${Math.round(Number(opacity))}%`;
}

// ---------------------------------------------------------------------------
// Live gesture (browser only)
// ---------------------------------------------------------------------------

// One source per open document viewer (every tab keeps its own): a function
// returning { enabled, container, tool, width, opacity, color, minWidth,
// maxWidth, decimals, onCommit({ width, opacity }) } as of now.
const sources = new Set();

/** Register a viewer's settings source; returns the unregister function. */
export function registerBrushAdjustSource(source) {
  if (typeof source !== 'function') return () => {};
  sources.add(source);
  return () => { sources.delete(source); };
}

function configFor(target) {
  for (const source of sources) {
    let config = null;
    try { config = source(); } catch (_) { config = null; }
    if (config?.enabled && config.container?.contains?.(target)) return config;
  }
  return null;
}

const PAGE_SELECTOR = '.survey-pdfjs-page-div';
// After the gesture ends, the right-click menu that follows the release on
// Windows (and the Alt key-up) still belongs to it.
const AFTERMATH_MS = 600;

let active = null;
let aftermathUntil = 0;
// The Alt held for the gesture: its key-up must not open the browser's menu.
let swallowAltUp = false;

function now() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function swallow(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

/** Screen pixels per page unit for the page under the press. */
function pageScaleAt(pageEl) {
  const svg = pageEl.querySelector('svg[viewBox]');
  const viewBoxWidth = Number(svg?.getAttribute('viewBox')?.split(/\s+/)?.[2]);
  const rect = (svg || pageEl).getBoundingClientRect();
  if (Number.isFinite(viewBoxWidth) && viewBoxWidth > 0 && rect.width > 0) return rect.width / viewBoxWidth;
  return 1;
}

function colorWithOpacity(color, opacity) {
  const hex = /^#([0-9a-f]{6})$/i.exec(String(color || '').trim());
  const alpha = Math.max(0, Math.min(1, Number(opacity) / 100));
  if (!hex) return `rgba(220, 38, 38, ${alpha})`;
  const n = parseInt(hex[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function buildHud(x, y) {
  const root = document.createElement('div');
  root.setAttribute('data-brush-adjust-hud', 'true');
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  Object.assign(root.style, {
    position: 'fixed',
    left: `${x}px`,
    top: `${y}px`,
    width: '0',
    height: '0',
    zIndex: '2147483000',
    pointerEvents: 'none',
  });
  const dot = document.createElement('div');
  Object.assign(dot.style, {
    position: 'absolute',
    borderRadius: '50%',
    transform: 'translate(-50%, -50%)',
    // Readable on a white page and a dark drawing alike.
    boxShadow: '0 0 0 1px rgba(255,255,255,0.95), 0 0 0 2px rgba(0,0,0,0.55)',
  });
  const label = document.createElement('div');
  Object.assign(label.style, {
    position: 'absolute',
    transform: 'translateX(-50%)',
    background: 'var(--surface-2, #1f2329)',
    color: 'var(--text-2, #e6e8eb)',
    border: '1px solid var(--border, rgba(255,255,255,0.12))',
    padding: '4px 8px',
    borderRadius: '6px',
    fontSize: '11.5px',
    whiteSpace: 'nowrap',
    boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
    fontVariantNumeric: 'tabular-nums',
  });
  root.appendChild(dot);
  root.appendChild(label);
  document.body.appendChild(root);
  return { root, dot, label };
}

function paintHud(state) {
  const { hud, values, scale, config } = state;
  const eraser = config.tool === 'eraser';
  const diameter = Math.max(3, values.width * scale);
  Object.assign(hud.dot.style, {
    width: `${diameter}px`,
    height: `${diameter}px`,
    background: eraser ? 'transparent' : colorWithOpacity(config.color, values.opacity),
  });
  hud.label.style.top = `${diameter / 2 + 10}px`;
  hud.label.textContent = formatBrushAdjustLabel({ width: values.width, opacity: values.opacity, eraser });
}

function end(commit) {
  const state = active;
  active = null;
  aftermathUntil = now() + AFTERMATH_MS;
  state?.hud?.root?.remove();
  if (!commit || !state) return;
  const { values, start, config } = state;
  if (values.width === start.width && values.opacity === start.opacity) return;
  try {
    config.onCommit?.({
      width: values.width !== start.width ? values.width : null,
      opacity: values.opacity !== start.opacity ? values.opacity : null,
    });
  } catch (_) { /* a failed commit must never leave the gesture stuck */ }
}

function onPointerDown(event) {
  if (active) {
    swallow(event);
    return;
  }
  if (!isBrushAdjustPress(event)) return;
  const pageEl = event.target?.closest?.(PAGE_SELECTOR);
  if (!pageEl) return;
  const config = configFor(pageEl);
  if (!config || !BRUSH_ADJUST_TOOLS.has(config.tool)) return;
  if (document.body?.getAttribute('data-readonly') === 'true') return;
  swallow(event);
  swallowAltUp = true;
  const eraser = config.tool === 'eraser';
  const start = {
    width: Number(config.width) || 1,
    opacity: eraser ? 100 : (Number.isFinite(Number(config.opacity)) ? Number(config.opacity) : 100),
  };
  active = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    start,
    values: { ...start, axis: null },
    scale: pageScaleAt(pageEl),
    config,
    hud: buildHud(event.clientX, event.clientY),
  };
  paintHud(active);
}

function onPointerMove(event) {
  if (!active || event.pointerId !== active.pointerId) return;
  swallow(event);
  const { config } = active;
  active.values = resolveBrushAdjust({
    start: active.start,
    dx: event.clientX - active.startX,
    dy: event.clientY - active.startY,
    axis: active.values.axis,
    limits: {
      minWidth: config.minWidth,
      maxWidth: config.maxWidth,
      decimals: config.decimals,
      opacity: config.tool !== 'eraser',
    },
  });
  paintHud(active);
}

function onPointerUp(event) {
  if (!active || event.pointerId !== active.pointerId) return;
  swallow(event);
  end(true);
}

function onPointerCancel(event) {
  if (!active || event.pointerId !== active.pointerId) return;
  end(false);
}

function onContextMenu(event) {
  if (active || now() < aftermathUntil) swallow(event);
}

function onKey(event) {
  if (active && event.type === 'keydown' && event.key === 'Escape') {
    swallow(event);
    end(false);
    return;
  }
  // A bare Alt press and release focuses the browser's menu on Windows; the
  // Alt that went with the gesture must not.
  if (event.key === 'Alt' && event.type === 'keyup' && swallowAltUp) {
    event.preventDefault();
    swallowAltUp = false;
  } else if (event.type === 'keydown' && event.key !== 'Alt') {
    swallowAltUp = false;
  }
}

let installed = false;

/** Install the window listeners (once). Called on import in the browser. */
export function installBrushAdjustGesture(target = (typeof window !== 'undefined' ? window : null)) {
  if (installed || !target?.addEventListener || typeof document === 'undefined') return;
  installed = true;
  const capture = { capture: true };
  target.addEventListener('pointerdown', onPointerDown, capture);
  target.addEventListener('pointermove', onPointerMove, capture);
  target.addEventListener('pointerup', onPointerUp, capture);
  target.addEventListener('pointercancel', onPointerCancel, capture);
  target.addEventListener('contextmenu', onContextMenu, capture);
  target.addEventListener('auxclick', onContextMenu, capture);
  target.addEventListener('keydown', onKey, capture);
  target.addEventListener('keyup', onKey, capture);
  target.addEventListener('blur', () => {
    swallowAltUp = false;
    if (active) end(false);
  });
}

installBrushAdjustGesture();
