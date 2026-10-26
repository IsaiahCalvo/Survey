/**
 * The pinned tools dock (Survey Nightly, beta flag 'pinned-tools'; owner
 * 2026-10-22). Rules and the pure parts: src/pinnedTools/pinnedTools.js and
 * src/pinnedTools/pinSession.js.
 *
 * - Each pin is a tool with its own settings, drawn as the tool's glyph in the
 *   pin's colour with its width in the corner (Drawboard PDF's favourites bar).
 * - Press a pin to arm it. While it is armed, colour / width / line style
 *   changes in the settings row are saved into that pin.
 * - "+" pins the tool in use, or any tool, with no limit on how many.
 * - Drag a pin along the dock to reorder it (mouse or pen): the others slide
 *   aside and it glides into its slot; Alt+arrows from the keyboard.
 *   Right-click a pin to duplicate or unpin it; "Edit pins" in the dock's
 *   menu shows a remove mark on each for touch.
 * - Drag the grip to dock it left, right or bottom, as walkthu's
 *   favourite-tools dock: drop zones fade in, the nearest one pulls the dock
 *   in like a magnet, the dock morphs to that zone's shape, and it glides
 *   into place on release. Arrow keys on the grip move it too.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import Icon from '../Icons.jsx';
import { watchLightPopover } from './dismissRules.js';
import { useMenuFocus } from '../hooks/useMenuFocus.js';
import { withOwnHandlers } from './Tooltip.jsx';
import {
  PINNABLE_TOOLS,
  chooseDockPlacement,
  colorLuminance,
  createPinnedToolsStore,
  dropDurationMs,
  magnetPull,
  makePin,
  pinBadge,
  pinDescription,
  pinFaceColor,
  pinKind,
  pinKindForTool,
  reorderIndexAt,
  reorderShift,
} from '../pinnedTools/pinnedTools.js';
import { armPin, endPinSession, pinEditFromViewer, sessionStatus, startingStyleFor } from '../pinnedTools/pinSession.js';
import './PinnedToolsDock.css';

let sharedStore = null;
export function getPinnedToolsStore() {
  sharedStore ??= createPinnedToolsStore();
  return sharedStore;
}

export function usePinnedTools(store = getPinnedToolsStore()) {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

const DRAG_START_PX = 6;
const SETTLE_EASING = 'cubic-bezier(0.25, 0.55, 0.35, 1)';
const DOCK_MORPH_MS = 320;
const DOCK_MORPH_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
const ZONES_FADE_OUT_MS = 240;
const PIN_SLIDE_MS = 180;
const PIN_GAP_PX = 2; // .pinned-dock__pins gap

const prefersReducedMotion = () => (
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
);

// A glyph in a very dark or very light colour would vanish into the dock on
// one theme or the other: give it a thin halo of the opposite tone.
function glyphHalo(color) {
  if (!color) return undefined;
  const lum = colorLuminance(color);
  if (lum < 0.06) return 'drop-shadow(0 0 0.6px rgba(255,255,255,0.9)) drop-shadow(0 0 0.6px rgba(255,255,255,0.6))';
  if (lum > 0.8) return 'drop-shadow(0 0 0.6px rgba(0,0,0,0.85))';
  return undefined;
}

function PinGlyph({ kindId, color, size = 16 }) {
  const kind = pinKind(kindId);
  if (!kind) return null;
  return (
    <span className="pinned-dock__glyph" style={{ filter: glyphHalo(color) }} aria-hidden="true">
      <Icon name={kind.iconName} size={size} color={color || 'currentColor'} />
    </span>
  );
}

// Lucide's `pin` (lucide-static 1.61.0, ISC), drawn at the chrome's 1.5 stroke.
export function PinIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  );
}

function GripIcon({ vertical }) {
  const dots = vertical
    ? [[9, 7], [15, 7], [9, 12], [15, 12], [9, 17], [15, 17]]
    : [[7, 9], [7, 15], [12, 9], [12, 15], [17, 9], [17, 15]];
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      {dots.map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.4" fill="currentColor" />)}
    </svg>
  );
}

export default function PinnedToolsDock({ api, tip, store: suppliedStore, phone = false }) {
  const store = suppliedStore || getPinnedToolsStore();
  const state = usePinnedTools(store);
  const { pins, visible } = state;
  // The phone has one place for it: a row above its bottom bar. The saved
  // desktop placement is left alone.
  const placement = phone ? 'bottom' : state.placement;
  const [dockDrag, setDockDrag] = useState(null); // { target } while the grip is carried
  // While carried over a zone, the dock already takes that zone's shape.
  const shapePlacement = dockDrag?.target || placement;
  const vertical = shapePlacement !== 'bottom';
  const tipSide = placement === 'left' ? 'right' : placement === 'right' ? 'left' : 'above';
  const bindTip = typeof tip === 'function' ? tip : () => ({});

  const [menu, setMenu] = useState(null); // { kind: 'add' | 'settings' | 'pin', pinId?, rect }
  const [editing, setEditing] = useState(false);
  const [pinDrag, setPinDrag] = useState(null); // { pinId, index, offset }
  const [, setSessionTick] = useState(0);

  const shellRef = useRef(null);
  const dockRef = useRef(null);
  const listRef = useRef(null);
  const menuRef = useRef(null);
  const sessionRef = useRef(null);
  const apiRef = useRef(api);
  apiRef.current = api;
  const suppressClickRef = useRef(false);
  const settleCleanupRef = useRef(null);
  const wasVisibleRef = useRef(visible);

  const setSession = useCallback((next) => {
    sessionRef.current = next;
    setSessionTick((tick) => tick + 1);
  }, []);

  // --- arming pins ---------------------------------------------------------
  const arm = useCallback((pin) => {
    const current = apiRef.current;
    if (!current || !pin) return;
    setSession(armPin(current, sessionRef.current, pin));
  }, [setSession]);

  // Leave the pin when another tool is armed or the document changes.
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (sessionStatus(session, api) === 'end') {
      endPinSession(session);
      setSession(null);
    }
  }, [api, api?.activeTool, api?.__ownerToken, setSession]);

  // Save settings-row edits into the armed pin.
  useEffect(() => {
    const session = sessionRef.current;
    if (!session || !api) return;
    const pin = pins.find((entry) => entry.id === session.pinId);
    if (!pin) return;
    const edit = pinEditFromViewer(session, pin, api);
    if (edit) store.updatePinStyle(pin.id, edit);
  }, [api, pins, store]);

  // An unpinned armed pin stops being a session (its tool stays armed, with
  // the tool's own settings back).
  useEffect(() => {
    const session = sessionRef.current;
    if (session && !pins.some((pin) => pin.id === session.pinId)) {
      endPinSession(session);
      setSession(null);
    }
  }, [pins, setSession]);

  useEffect(() => () => {
    endPinSession(sessionRef.current);
    sessionRef.current = null;
    settleCleanupRef.current?.();
  }, []);

  // The dock pops in when it is shown again (walkthu: 190 ms, slight overshoot).
  useEffect(() => {
    if (visible && !wasVisibleRef.current && !prefersReducedMotion()) {
      dockRef.current?.animate?.(
        [{ opacity: 0, transform: 'scale(0.82)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: 190, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1.15)' },
      );
    }
    wasVisibleRef.current = visible;
  }, [visible]);

  // --- menus ---------------------------------------------------------------
  const closeMenu = useCallback(() => setMenu(null), []);
  useMenuFocus(menuRef, Boolean(menu));
  useEffect(() => {
    if (!menu) return undefined;
    return watchLightPopover({
      contains: (target) => Boolean(menuRef.current?.contains(target) || (menu.opener && menu.opener.contains?.(target))),
      close: () => setMenu(null),
    });
  }, [menu]);

  const openMenu = (kind, element, extra = {}) => {
    if (menu?.kind === kind && menu.pinId === extra.pinId) {
      setMenu(null);
      return;
    }
    setMenu({ kind, rect: element.getBoundingClientRect(), opener: element, ...extra });
  };

  const addPin = (kindId, style) => {
    const pin = store.addPin(makePin(kindId, style));
    closeMenu();
    if (pin) arm(pin);
  };

  const currentKind = api ? pinKindForTool(api.activeTool, api.lineBorderStyle) : null;
  const pinCurrent = () => {
    if (!currentKind || !api) return;
    const source = typeof api.readToolStyle === 'function'
      ? api.readToolStyle(currentKind.tool, currentKind.lineStyle)
      : {};
    // Pinning what is armed: it stays armed, now as the new pin.
    addPin(currentKind.id, { ...source, lineStyle: currentKind.lineStyle || api.lineBorderStyle });
  };

  const unpin = (pinId) => {
    store.removePin(pinId);
    closeMenu();
  };

  const duplicate = (pin) => {
    const index = pins.findIndex((entry) => entry.id === pin.id);
    store.addPin(makePin(pin.kind, pin.style), index + 1);
    closeMenu();
  };

  // --- dock drag (grip) -----------------------------------------------------
  // walkthu's favourite-tools dock, move for move:
  // - Pressed and moved 6px, the dock lifts (1.1x; 0.95x from the bottom) and
  //   a dim veil with the three drop zones fades in.
  // - The grip stays under the pointer, except that the zone the dock would
  //   land in pulls it in (magnetPull): nothing at the middle of the page
  //   area, most of the way at the edge.
  // - Over a zone the dock takes that zone's shape (a column at the sides, a
  //   row at the bottom), and its box morphs to it over 320ms rather than
  //   jumping, its tools fading back in.
  // - Every frame it is kept inside the page area.
  // - Let go, it glides home (FLIP, 240-320ms by distance) and the veil fades.
  const dockDragRef = useRef(null);
  const morphRef = useRef(null);
  const onGripPointerDown = (event) => {
    if (event.button !== 0) return;
    const dock = dockRef.current;
    const shell = shellRef.current;
    const root = shell?.parentElement?.getBoundingClientRect();
    if (!dock || !shell || !root) return;
    settleCleanupRef.current?.();
    setMenu(null);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* synthetic events */ }
    const gripRect = event.currentTarget.getBoundingClientRect();
    const drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      grabX: event.clientX - (gripRect.left + gripRect.width / 2),
      grabY: event.clientY - (gripRect.top + gripRect.height / 2),
      activated: false,
      target: null,
      root,
      frame: 0,
      scale: prefersReducedMotion() ? 1 : (placement === 'bottom' ? 0.95 : 1.1),
    };
    // Where the zone a placement lands in sits, in page-area pixels.
    const homeOf = (target) => {
      const zone = document.querySelector(`[data-pinned-dock-zone="${target}"]`);
      const rect = zone?.getBoundingClientRect();
      if (!rect || !(rect.width > 0)) return null;
      return {
        x: rect.left + rect.width / 2 - drag.root.left,
        y: rect.top + rect.height / 2 - drag.root.top,
        bottom: rect.bottom - drag.root.top,
      };
    };
    // Put the grip under the pointer, pick the zone from there, let that
    // zone's magnet pull the dock in, and keep it inside the page area.
    drag.place = () => {
      const grip = dock.querySelector('[data-pinned-tools-grip]');
      if (!grip) return;
      const shellRect = shell.getBoundingClientRect();
      const w = dock.offsetWidth;
      const h = dock.offsetHeight;
      const s = drag.activated ? drag.scale : 1;
      const gx = grip.offsetLeft + grip.offsetWidth / 2 - w / 2;
      const gy = grip.offsetTop + grip.offsetHeight / 2 - h / 2;
      const baseX = shellRect.left + dock.offsetLeft + w / 2;
      const baseY = shellRect.top + dock.offsetTop + h / 2;
      let tx = drag.lastX - drag.grabX - (baseX + s * gx);
      let ty = drag.lastY - drag.grabY - (baseY + s * gy);
      if (drag.activated) {
        const { root: area } = drag;
        const free = {
          left: baseX + tx - (w * s) / 2 - area.left,
          right: baseX + tx + (w * s) / 2 - area.left,
          top: baseY + ty - (h * s) / 2 - area.top,
          bottom: baseY + ty + (h * s) / 2 - area.top,
        };
        const target = chooseDockPlacement(free, area.width, area.height, drag.target);
        if (target !== drag.target) {
          drag.target = target;
          // Measured before React reshapes it, for the morph.
          drag.morphFrom = { width: w, height: h };
          setDockDrag({ target });
        }
        const pull = magnetPull(free, target, area.width, area.height, homeOf(target));
        tx += pull.x;
        ty += pull.y;
        const left = baseX + tx - (w * s) / 2;
        const top = baseY + ty - (h * s) / 2;
        tx += Math.max(0, area.left + 1 - left) - Math.max(0, left + w * s - (area.left + area.width - 1));
        ty += Math.max(0, area.top + 1 - top) - Math.max(0, top + h * s - (area.top + area.height - 1));
      }
      dock.style.translate = `${tx}px ${ty}px`;
    };
    const tick = () => {
      drag.place();
      drag.frame = window.requestAnimationFrame(tick);
    };
    const move = (ev) => {
      if (ev.pointerId !== drag.pointerId) return;
      drag.lastX = ev.clientX;
      drag.lastY = ev.clientY;
      if (!drag.activated) {
        if (Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) < DRAG_START_PX) return;
        drag.activated = true;
        dockDragRef.current = drag;
        dock.style.transformOrigin = 'center';
        dock.style.transition = prefersReducedMotion() ? 'none' : 'scale 110ms cubic-bezier(0.2, 0.8, 0.2, 1)';
        dock.style.scale = String(drag.scale);
        setDockDrag({ target: null });
        // The morph and the zones move under a still pointer too.
        drag.frame = window.requestAnimationFrame(tick);
      }
      drag.place();
    };
    const finish = (ev, drop) => {
      if (ev.pointerId !== drag.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.cancelAnimationFrame(drag.frame);
      dockDragRef.current = null;
      if (!drag.activated) return;
      const from = dock.getBoundingClientRect();
      morphRef.current?.cancel();
      morphRef.current = null;
      dock.style.transition = 'none';
      dock.style.removeProperty('translate');
      dock.style.scale = '1';
      flushSync(() => {
        setDockDrag(null);
        setZonesLeaving(true);
        if (drop && drag.target) store.setPlacement(drag.target);
      });
      settleInto(dock, from, drag.root);
    };
    const up = (ev) => finish(ev, true);
    const cancel = (ev) => finish(ev, false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  // The dock changed shape under the pointer: morph its box from the old
  // shape to the new one (its tools reflow inside at once, clipped, and fade
  // back in), and put its grip back under the pointer.
  useLayoutEffect(() => {
    const drag = dockDragRef.current;
    const dock = dockRef.current;
    if (!drag || !dock) return;
    const from = drag.morphFrom;
    drag.morphFrom = null;
    const to = { width: dock.offsetWidth, height: dock.offsetHeight };
    if (from && !prefersReducedMotion() && typeof dock.animate === 'function'
      && (Math.abs(from.width - to.width) > 1 || Math.abs(from.height - to.height) > 1)) {
      morphRef.current?.cancel();
      morphRef.current = dock.animate(
        [{ width: `${from.width}px`, height: `${from.height}px` }, { width: `${to.width}px`, height: `${to.height}px` }],
        { duration: DOCK_MORPH_MS, easing: DOCK_MORPH_EASING },
      );
      listRef.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: DOCK_MORPH_MS, easing: DOCK_MORPH_EASING });
    }
    drag.place();
  }, [dockDrag?.target]);

  // The veil fades out after the drop rather than vanishing.
  const [zonesLeaving, setZonesLeaving] = useState(false);
  useEffect(() => {
    if (!zonesLeaving) return undefined;
    const timer = window.setTimeout(() => setZonesLeaving(false), prefersReducedMotion() ? 0 : ZONES_FADE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [zonesLeaving]);

  // FLIP: start the docked box where the dragged one was and glide it home.
  // The start is kept inside the page area (`area`), so a dock let go half
  // off an edge does not swing in from outside.
  const settleInto = (dock, from, area = null) => {
    const clear = () => {
      dock.style.removeProperty('transition');
      dock.style.removeProperty('transform');
      dock.style.removeProperty('translate');
      dock.style.removeProperty('scale');
      dock.style.removeProperty('transform-origin');
      settleCleanupRef.current = null;
    };
    const to = dock.getBoundingClientRect();
    if (prefersReducedMotion() || !(from.width > 0) || !(to.width > 0)) {
      clear();
      return;
    }
    const sx = from.width / to.width;
    const sy = from.height / to.height;
    const scale = Math.abs(sx - sy) <= 0.03 ? (sx + sy) / 2 : 1;
    const clampTo = (value, min, max) => (max < min ? value : Math.min(max, Math.max(min, value)));
    const fromX = area
      ? clampTo(from.left + from.width / 2, area.left + to.width / 2, area.left + area.width - to.width / 2)
      : from.left + from.width / 2;
    const fromY = area
      ? clampTo(from.top + from.height / 2, area.top + to.height / 2, area.top + area.height - to.height / 2)
      : from.top + from.height / 2;
    const dx = fromX - (to.left + to.width / 2);
    const dy = fromY - (to.top + to.height / 2);
    const duration = dropDurationMs(from, to);
    dock.style.transformOrigin = 'center';
    dock.style.scale = String(scale);
    dock.style.transform = `translate(${dx / scale}px, ${dy / scale}px)`;
    void dock.getBoundingClientRect();
    if (scale === 1 && Math.abs(sx - sy) > 0.03) {
      // The dock turned (side <-> bottom): fade its pins in as it lands.
      listRef.current?.animate?.([{ opacity: 0.35 }, { opacity: 1 }], { duration, easing: SETTLE_EASING });
    }
    let done = false;
    const frame = window.requestAnimationFrame(() => {
      dock.style.transition = `transform ${duration}ms ${SETTLE_EASING}, scale ${duration}ms ${SETTLE_EASING}`;
      dock.style.transform = 'translate(0px, 0px)';
      dock.style.scale = '1';
    });
    const timer = window.setTimeout(() => finishSettle(), duration + 80);
    const onEnd = (event) => { if (event.target === dock && event.propertyName === 'transform') finishSettle(); };
    dock.addEventListener('transitionend', onEnd);
    function finishSettle() {
      if (done) return;
      done = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      dock.removeEventListener('transitionend', onEnd);
      clear();
    }
    settleCleanupRef.current = finishSettle;
  };

  const onGripKeyDown = (event) => {
    const next = { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'bottom' }[event.key];
    if (!next) return;
    event.preventDefault();
    const dock = dockRef.current;
    const from = dock?.getBoundingClientRect();
    flushSync(() => store.setPlacement(next));
    if (dock && from) settleInto(dock, from);
  };

  // --- pin drag (reorder) ---------------------------------------------------
  // The pin lifts and follows the pointer along the dock; the others slide
  // aside to open its slot (rather than a line marking it), and on release it
  // glides into that slot. Alt+arrows move it a slot with the same glide.
  // `mutate` runs the reorder; every pin then glides from where it was drawn.
  const flipPins = (mutate) => {
    const list = listRef.current;
    const before = new Map();
    list?.querySelectorAll('[data-pin-slot]').forEach((el) => before.set(el.dataset.pinSlot, el.getBoundingClientRect()));
    flushSync(mutate);
    if (!list || prefersReducedMotion()) return;
    list.querySelectorAll('[data-pin-slot]').forEach((el) => {
      const was = before.get(el.dataset.pinSlot);
      if (!was || typeof el.animate !== 'function') return;
      const now = el.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if (Math.hypot(dx, dy) < 0.5) return;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }],
        { duration: PIN_SLIDE_MS, easing: SETTLE_EASING },
      );
    });
  };

  const onPinPointerDown = (event, pin, index) => {
    if (event.button !== 0 || event.pointerType === 'touch' || editing) return;
    const list = listRef.current;
    if (!list) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const slotEl = event.currentTarget.closest('[data-pin-slot]');
    let activated = false;
    let target = index;
    let rects = [];
    let scroll0 = { x: 0, y: 0 };
    let slot = 0;
    const pinId = pin.id;
    const move = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!activated) {
        if (Math.abs(vertical ? dy : dx) < DRAG_START_PX) return;
        activated = true;
        // The other pins' boxes as laid out now, before any slides aside.
        rects = [...list.querySelectorAll('[data-pin-slot]')]
          .filter((el) => el.dataset.pinSlot !== pinId)
          .map((el) => el.getBoundingClientRect());
        scroll0 = { x: list.scrollLeft, y: list.scrollTop };
        slot = (vertical ? slotEl?.offsetHeight : slotEl?.offsetWidth) + PIN_GAP_PX || 0;
      }
      // A long dock scrolls under the pin: measure in its scrolled frame.
      const sx = list.scrollLeft - scroll0.x;
      const sy = list.scrollTop - scroll0.y;
      target = reorderIndexAt({ x: ev.clientX + sx, y: ev.clientY + sy }, rects, vertical);
      setPinDrag({ pinId, index: target, offset: vertical ? dy + sy : dx + sx, slot });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!activated) return;
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      flipPins(() => {
        setPinDrag(null);
        store.movePin(pinId, target);
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const onPinKeyDown = (event, pin, index) => {
    if (!event.altKey) return;
    const delta = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[event.key];
    if (!delta) return;
    event.preventDefault();
    flipPins(() => store.movePin(pin.id, Math.max(0, Math.min(pins.length - 1, index + delta))));
    const id = pin.id;
    window.requestAnimationFrame(() => listRef.current?.querySelector(`[data-pin-slot="${CSS.escape(id)}"] button`)?.focus());
  };

  // Keep the reordered pin visible inside a long, scrolling dock.
  useLayoutEffect(() => {
    if (!pinDrag) return;
    const el = listRef.current?.querySelector(`[data-pin-slot="${CSS.escape(pinDrag.pinId)}"]`);
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [pinDrag]);

  if (!api) return null;
  if (!visible) {
    if (!phone) return null;
    // The phone has no top-bar toggle: hidden, the dock folds to one button.
    return (
      <div className="pinned-dock-shell is-bottom is-phone" data-pinned-dock-shell="bottom">
        <div className="pinned-dock is-horizontal">
          <button
            type="button"
            className="btn chrome-subcontrol btn-ghost pinned-dock__folded"
            aria-label="Show pinned tools"
            data-pinned-tools-show="true"
            onClick={() => store.setVisible(true)}
          >
            <PinIcon size={18} />
          </button>
        </div>
      </div>
    );
  }

  const session = sessionRef.current;
  const activeTool = api.activeTool;

  // The veil stays a moment after the drop to fade out (zonesLeaving).
  const zones = dockDrag || zonesLeaving ? (
    <div
      className={`pinned-dock-zones${dockDrag ? '' : ' is-leaving'}`}
      aria-hidden="true"
      data-pinned-dock-zones="true"
      data-visible={dockDrag ? 'true' : 'false'}
    >
      {['left', 'right', 'bottom'].map((zone) => (
        <div
          key={zone}
          className={`pinned-dock-zone is-${zone}${dockDrag?.target === zone ? ' is-target' : ''}`}
          data-pinned-dock-zone={zone}
          data-active={dockDrag?.target === zone ? 'true' : 'false'}
        />
      ))}
    </div>
  ) : null;

  const draggedIndex = pinDrag ? pins.findIndex((pin) => pin.id === pinDrag.pinId) : -1;
  const slotStyle = (pin, index) => {
    if (!pinDrag) return undefined;
    const axis = vertical ? 'translateY' : 'translateX';
    if (pin.id === pinDrag.pinId) return { transform: `${axis}(${pinDrag.offset}px) scale(1.08)` };
    const shift = reorderShift(index, draggedIndex, pinDrag.index);
    return shift ? { transform: `${axis}(${shift * pinDrag.slot}px)` } : undefined;
  };

  return (
    <>
      {zones}
      <div ref={shellRef} className={`pinned-dock-shell is-${placement}${phone ? ' is-phone' : ''}`} data-pinned-dock-shell={placement}>
        <div
          ref={dockRef}
          className={`pinned-dock ${vertical ? 'is-vertical' : 'is-horizontal'}${dockDrag ? ' is-dragging' : ''}${pinDrag ? ' is-reordering' : ''}`}
          role="toolbar"
          aria-label="Pinned tools"
          aria-orientation={vertical ? 'vertical' : 'horizontal'}
          data-pinned-tools-dock="true"
          data-placement={placement}
        >
          <div ref={listRef} className="pinned-dock__pins">
            {pins.map((pin, index) => {
              const kind = pinKind(pin.kind);
              const color = pinFaceColor(pin);
              const badge = pinBadge(pin);
              const description = pinDescription(pin);
              const pressed = Boolean(session && session.pinId === pin.id && activeTool === kind.tool);
              return (
                <div
                  key={pin.id}
                  className={`pinned-dock__slot${pinDrag?.pinId === pin.id ? ' is-dragged' : ''}`}
                  data-pin-slot={pin.id}
                  style={slotStyle(pin, index)}
                >
                  <button
                    type="button"
                    className={`btn chrome-subcontrol pinned-dock__pin ${pressed ? 'btn-active' : 'btn-ghost'}`}
                    aria-pressed={pressed}
                    aria-label={`Pinned ${description}`}
                    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                    data-pinned-tool={pin.kind}
                    data-pin-id={pin.id}
                    data-pin-color={color || undefined}
                    data-pin-width={badge || undefined}
                    data-tool-switch="true"
                    {...withOwnHandlers(bindTip(description, tipSide), {
                      onPointerDown: (event) => onPinPointerDown(event, pin, index),
                      onKeyDown: (event) => onPinKeyDown(event, pin, index),
                    })}
                    onClick={(event) => {
                      if (suppressClickRef.current) return;
                      // A phone has no right-click: tapping the armed pin
                      // again opens its menu (as Drawboard does).
                      if (phone && pressed) {
                        openMenu('pin', event.currentTarget, { pinId: pin.id });
                        return;
                      }
                      arm(pin);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openMenu('pin', event.currentTarget, { pinId: pin.id });
                    }}
                  >
                    <PinGlyph kindId={pin.kind} color={color} />
                    {badge ? <span className="pinned-dock__badge" aria-hidden="true">{badge}</span> : null}
                  </button>
                  {editing ? (
                    <button
                      type="button"
                      className="pinned-dock__remove"
                      aria-label={`Unpin ${description}`}
                      data-pin-remove={pin.id}
                      onClick={() => unpin(pin.id)}
                    >
                      <Icon name="close" size={10} color="currentColor" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="btn chrome-subcontrol btn-ghost pinned-dock__add"
            aria-label="Pin a tool"
            aria-haspopup="menu"
            aria-expanded={menu?.kind === 'add'}
            data-pinned-tools-add="true"
            {...bindTip('Pin a tool', tipSide)}
            onClick={(event) => openMenu('add', event.currentTarget)}
          >
            <Icon name="plus" size={16} color="currentColor" />
          </button>
          <span className="pinned-dock__rule" aria-hidden="true" />
          <button
            type="button"
            className={`btn chrome-subcontrol pinned-dock__settings ${menu?.kind === 'settings' || editing ? 'btn-active' : 'btn-ghost'}`}
            aria-label="Pinned tools menu"
            aria-haspopup="menu"
            aria-expanded={menu?.kind === 'settings'}
            data-pinned-tools-menu="true"
            {...bindTip('Pinned tools menu', tipSide)}
            onClick={(event) => openMenu('settings', event.currentTarget)}
          >
            <Icon name="moreHorizontal" size={16} color="currentColor" />
          </button>
          {phone ? null : (
          <button
            type="button"
            className="btn chrome-subcontrol btn-ghost pinned-dock__grip"
            aria-label="Move pinned tools"
            aria-keyshortcuts="ArrowLeft ArrowRight ArrowDown"
            data-pinned-tools-grip="true"
            {...withOwnHandlers(bindTip('Drag to dock left, right or bottom', tipSide), {
              onPointerDown: onGripPointerDown,
              onKeyDown: onGripKeyDown,
            })}
          >
            <GripIcon vertical={vertical} />
          </button>
          )}
        </div>
      </div>
      {menu ? createPortal(
        <PinnedToolsMenu
          menuRef={menuRef}
          menu={menu}
          placement={placement}
          phone={phone}
          pins={pins}
          editing={editing}
          currentKind={currentKind}
          onPinCurrent={pinCurrent}
          onAdd={(kindId) => addPin(kindId, startingStyleFor(apiRef.current, sessionRef.current, kindId))}
          onUnpin={unpin}
          onDuplicate={duplicate}
          onPlacement={(next) => {
            closeMenu();
            const dock = dockRef.current;
            const from = dock?.getBoundingClientRect();
            flushSync(() => store.setPlacement(next));
            if (dock && from) settleInto(dock, from);
          }}
          onToggleEditing={() => { setEditing((value) => !value); closeMenu(); }}
          onHide={() => { closeMenu(); setEditing(false); store.setVisible(false); }}
          api={api}
        />,
        document.body,
      ) : null}
    </>
  );
}

function menuPosition(rect, placement, width = 240) {
  const gap = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (placement === 'bottom') {
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), vw - width - 8);
    return { left, bottom: Math.max(8, vh - rect.top + gap), maxHeight: Math.max(160, rect.top - 16) };
  }
  const top = Math.max(8, Math.min(rect.top - 8, vh - 200));
  const base = { top, maxHeight: vh - top - 8 };
  return placement === 'left'
    ? { ...base, left: Math.min(rect.right + gap, vw - width - 8) }
    : { ...base, right: Math.max(8, vw - rect.left + gap) };
}

function PinnedToolsMenu({
  menuRef, menu, placement, phone, pins, editing, currentKind, onPinCurrent, onAdd, onUnpin, onDuplicate,
  onPlacement, onToggleEditing, onHide, api,
}) {
  const width = menu.kind === 'add' ? 264 : 200;
  const style = { ...menuPosition(menu.rect, placement, width), width };
  if (menu.kind === 'pin') {
    const pin = pins.find((entry) => entry.id === menu.pinId);
    if (!pin) return null;
    return (
      <div ref={menuRef} role="menu" aria-label={`Pinned ${pinDescription(pin)}`} className="pinned-dock-menu" style={style} data-pinned-tools-pin-menu="true">
        <button type="button" role="menuitem" onClick={() => onDuplicate(pin)}>
          <Icon name="duplicate" size={14} color="currentColor" /><span>Duplicate</span>
        </button>
        <button type="button" role="menuitem" className="is-danger" onClick={() => onUnpin(pin.id)}>
          <Icon name="close" size={14} color="currentColor" /><span>Unpin</span>
        </button>
      </div>
    );
  }
  if (menu.kind === 'settings') {
    return (
      <div ref={menuRef} role="menu" aria-label="Pinned tools menu" className="pinned-dock-menu" style={style} data-pinned-tools-settings="true">
        {phone ? null : (
          <>
            <div className="pinned-dock-menu__heading">Dock</div>
            {[['left', 'Left'], ['bottom', 'Bottom'], ['right', 'Right']].map(([value, label]) => (
              <button key={value} type="button" role="menuitemradio" aria-checked={placement === value} onClick={() => onPlacement(value)}>
                <span className="pinned-dock-menu__check">{placement === value ? <Icon name="check" size={14} color="currentColor" /> : null}</span>
                <span>{label}</span>
              </button>
            ))}
            <div className="pinned-dock-menu__rule" />
          </>
        )}
        <button type="button" role="menuitem" onClick={onToggleEditing} disabled={!pins.length && !editing}>
          <Icon name="edit" size={14} color="currentColor" /><span>{editing ? 'Done editing pins' : 'Edit pins'}</span>
        </button>
        <button type="button" role="menuitem" onClick={onHide}>
          <Icon name="close" size={14} color="currentColor" /><span>Hide pinned tools</span>
        </button>
      </div>
    );
  }
  const groups = ['Draw', 'Shapes', 'Text'];
  const currentStyle = currentKind && typeof api?.readToolStyle === 'function'
    ? api.readToolStyle(currentKind.tool, currentKind.lineStyle)
    : null;
  const currentPreview = currentKind ? makePin(currentKind.id, { ...currentStyle, lineStyle: currentKind.lineStyle || api?.lineBorderStyle }, 'preview') : null;
  return (
    <div ref={menuRef} role="menu" aria-label="Pin a tool" className="pinned-dock-menu is-picker" style={style} data-pinned-tools-picker="true">
      {currentPreview ? (
        <>
          <button type="button" role="menuitem" className="pinned-dock-menu__current" onClick={onPinCurrent} data-pin-current="true">
            <span className="pinned-dock-menu__face">
              <PinGlyph kindId={currentPreview.kind} color={pinFaceColor(currentPreview)} />
            </span>
            <span className="pinned-dock-menu__text">
              <span>Pin the tool in use</span>
              <span className="pinned-dock-menu__sub">{pinDescription(currentPreview)}</span>
            </span>
          </button>
          <div className="pinned-dock-menu__rule" />
        </>
      ) : null}
      {groups.map((group) => (
        <div key={group} role="group" aria-label={group}>
          <div className="pinned-dock-menu__heading">{group}</div>
          <div className="pinned-dock-menu__grid">
            {PINNABLE_TOOLS.filter((kind) => kind.group === group).map((kind) => (
              <button key={kind.id} type="button" role="menuitem" data-pin-kind={kind.id} onClick={() => onAdd(kind.id)}>
                <Icon name={kind.iconName} size={16} color="currentColor" />
                <span>{kind.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
