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
 * - A big dock stays small to carry and never runs off its edge (owner
 *   2026-10-27, 17 pins): carried, its box clips it to six pins long;
 *   docked, the pins that do not fit (or past 7 slots with "Compact dock" on)
 *   wait behind a "+N" button in the last slot.
 * - Every change moves (owner 2026-11-12, "as smooth as Walkthu"): adding a
 *   pin pops it in, unpinning shrinks it away, the dock's box eases to its new
 *   length, hiding shrinks the dock away. Nothing jumps a frame.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import Icon from '../Icons.jsx';
import { watchLightPopover } from './dismissRules.js';
import { useMenuFocus } from '../hooks/useMenuFocus.js';
import { withOwnHandlers } from './Tooltip.jsx';
import { isTypingTarget } from '../utils/typingTarget.js';
import {
  CARRIED_DOCK_SLOTS,
  COMPACT_DOCK_SLOTS,
  chooseDockPlacement,
  colorLuminance,
  dropDurationMs,
  magnetPull,
  makePin,
  matchPinKinds,
  pinBadge,
  pinDescription,
  pinFaceColor,
  pinKind,
  pinKindForTool,
  reorderIndexAt,
  reorderShift,
  slotsThatFit,
  visiblePinCount,
} from '../pinnedTools/pinnedTools.js';
import { armPin, endPinSession, pinEditFromViewer, sessionStatus, startingStyleFor } from '../pinnedTools/pinSession.js';
import { PinIcon, getPinnedToolsStore, usePinnedTools } from '../pinnedTools/pinnedToolsShared.jsx';
import './PinnedToolsDock.css';

export { PinIcon, getPinnedToolsStore, usePinnedTools };

const DRAG_START_PX = 6;
const SETTLE_EASING = 'cubic-bezier(0.25, 0.55, 0.35, 1)';
const DOCK_MORPH_MS = 320;
const DOCK_MORPH_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
const DOCK_MORPH_MIN_MS = 300;
const LIFT_SCALE_TRANSITION = 'scale 110ms cubic-bezier(0.2, 0.8, 0.2, 1)';
const ZONES_FADE_OUT_MS = 240;
const PIN_SLIDE_MS = 180;
// How fast a carried dock catches up when something other than the pointer
// moves it (its grip shifting as it reshapes, the magnet): eased over about
// this long instead of in one frame. Pointer moves still pass straight on.
const CARRY_EASE_MS = 80;
const CARRY_CATCH_UP_PX_PER_MS = 1.1;
const PIN_ENTER_MS = 200;
const PIN_ENTER_EASING = 'cubic-bezier(0.2, 0.9, 0.25, 1.15)'; // walkthu's pop
const PIN_LEAVE_MS = 150;
const DOCK_RESIZE_MS = 200;
const DOCK_HIDE_MS = 150;
const PIN_GAP_PX = 2; // .pinned-dock__pins gap
const PIN_SIZE_PX = 32; // .pinned-dock__pin
const PHONE_PIN_SIZE_PX = 38;

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

/** A pin's hint: its words, then the number key that arms it (1 to 9). */
export function pinTipText(description, index, phone = false) {
  return !phone && index >= 0 && index < 9 ? `${description}  ${index + 1}` : description;
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
  // Escape ends "Edit pins" like every other mode (an open dock menu takes
  // the Escape first and closes itself). The viewer's capture-phase Escape
  // asks "survey-cancel-selection-gesture" first; claiming it there keeps
  // that same Escape from also dropping the pick or putting the tool down.
  // The plain keydown listener covers a screen with no viewer listening.
  useEffect(() => {
    if (!editing) return undefined;
    const onCancelAsk = (e) => {
      if (menu) return;
      setEditing(false);
      if (e.detail) e.detail.cancelled = true;
    };
    const onKey = (e) => { if (e.key === 'Escape' && !menu) setEditing(false); };
    window.addEventListener('survey-cancel-selection-gesture', onCancelAsk);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('survey-cancel-selection-gesture', onCancelAsk);
      window.removeEventListener('keydown', onKey);
    };
  }, [editing, menu]);
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

  // How long the pins' row may be: the shell's length less the dock's own
  // buttons (measured while docked, not while carried).
  const [room, setRoom] = useState(Infinity);
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell || !visible) return undefined;
    const measure = () => {
      const dock = dockRef.current;
      const list = listRef.current;
      if (!dock || !list || dockDragRef.current) return;
      const docked = placement !== 'bottom';
      const own = docked
        ? dock.offsetHeight - list.offsetHeight
        : dock.offsetWidth - list.offsetWidth;
      const length = docked ? shell.clientHeight : shell.clientWidth;
      if (!(length > 0)) return;
      const next = Math.max(0, length - own);
      setRoom((current) => (Math.abs(current - next) < 1 ? current : next));
    };
    measure();
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [placement, visible, editing, Boolean(api)]);

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

  // Number keys 1 to 9 arm the pins in their order, and 0 the last (Drawboard PDF Pro trial
  // audit 2026-11-09: its favourites answer to the number keys). Not while
  // typing, not with a modifier (Ctrl+1 is Fit width), not on a phone.
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  useEffect(() => {
    if (!visible || phone) return undefined;
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.__surveyRemapped || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (!/^[0-9]$/.test(event.key) || editingRef.current) return;
      if (isTypingTarget(event.target) || isTypingTarget(document.activeElement)) return;
      // 0 arms the last pin, however many there are (Drawboard's 0 is its
      // last favourites slot; R3-H 2026-11-10).
      const list = pinsRef.current;
      const pin = event.key === '0' ? list[list.length - 1] : list[Number(event.key) - 1];
      if (!pin || !apiRef.current) return;
      event.preventDefault();
      arm(pin);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible, phone, arm]);

  // Survey mode has its own pins (owner 2026-11-09): the dock shows the
  // survey set while Survey is on and the markup set everywhere else.
  const surveyOn = Boolean(api?.showSurveyPanel);
  useEffect(() => {
    store.setPinSet(surveyOn ? 'survey' : 'markup');
  }, [store, surveyOn]);

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

  // Hidden, the dock shrinks away rather than vanishing: it stays drawn for
  // DOCK_HIDE_MS (`leaving`), decided in the same render as `visible` so no
  // frame goes by with it gone and its exit not begun. Not on a phone, where
  // hiding swaps it for the one "Show pinned tools" button.
  const [leaving, setLeaving] = useState(false);
  const [visibleBefore, setVisibleBefore] = useState(visible);
  if (visible !== visibleBefore) {
    setVisibleBefore(visible);
    setLeaving(!visible && !phone && !prefersReducedMotion());
  }
  const leaveAnimationRef = useRef(null);
  useLayoutEffect(() => {
    if (!leaving) return undefined;
    const dock = dockRef.current;
    if (!dock || typeof dock.animate !== 'function') {
      setLeaving(false);
      return undefined;
    }
    const animation = dock.animate(
      [{ opacity: 1, scale: '1' }, { opacity: 0, scale: '0.82' }],
      { duration: DOCK_HIDE_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
    );
    leaveAnimationRef.current = animation;
    let live = true;
    animation.finished.catch(() => undefined).then(() => { if (live) setLeaving(false); });
    return () => { live = false; };
  }, [leaving]);

  // The dock pops in when it is shown again (walkthu: 190 ms, slight overshoot).
  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      leaveAnimationRef.current?.cancel();
      leaveAnimationRef.current = null;
      if (!prefersReducedMotion()) {
        dockRef.current?.animate?.(
          [{ opacity: 0, transform: 'scale(0.82)' }, { opacity: 1, transform: 'scale(1)' }],
          { duration: 190, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1.15)' },
        );
      }
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

  // Adding, unpinning or duplicating a pin (owner 2026-11-12: "as smooth as
  // Walkthu"): the dock's box eases to its new length, the pins after the
  // change slide to their new slots, a new pin pops in and an unpinned one
  // shrinks away where it stood. `mutate` runs the change and returns the new
  // pin, if there is one. The pins' row grows into the box (CSS flex-grow), so
  // while the box eases the dock's own buttons ride its far edge.
  const animateDock = (mutate, { leavingId = null } = {}) => {
    const dock = dockRef.current;
    const list = listRef.current;
    let result = null;
    if (!dock || !list || prefersReducedMotion() || dockDragRef.current || typeof dock.animate !== 'function') {
      flushSync(() => { result = mutate(); });
      return result;
    }
    const box0 = dock.getBoundingClientRect();
    const where = (el, frame) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - frame.left + list.scrollLeft, y: r.top - frame.top + list.scrollTop };
    };
    const list0 = list.getBoundingClientRect();
    const before = new Map();
    list.querySelectorAll('[data-pin-slot]').forEach((el) => before.set(el.dataset.pinSlot, where(el, list0)));
    let ghost = null;
    const leavingEl = leavingId ? list.querySelector(`[data-pin-slot="${CSS.escape(leavingId)}"]`) : null;
    if (leavingEl) {
      const r = leavingEl.getBoundingClientRect();
      ghost = { node: leavingEl.cloneNode(true), left: r.left - box0.left - dock.clientLeft, top: r.top - box0.top - dock.clientTop };
    }
    flushSync(() => { result = mutate(); });
    const enterId = result?.id || null;
    const box1 = { width: dock.offsetWidth, height: dock.offsetHeight };
    const options = { duration: DOCK_RESIZE_MS, easing: SETTLE_EASING };
    if (Math.abs(box0.width - box1.width) > 0.5 || Math.abs(box0.height - box1.height) > 0.5) {
      dock.animate(
        [{ width: `${box0.width}px`, height: `${box0.height}px` }, { width: `${box1.width}px`, height: `${box1.height}px` }],
        options,
      );
    }
    const list1 = list.getBoundingClientRect();
    list.querySelectorAll('[data-pin-slot]').forEach((el) => {
      const id = el.dataset.pinSlot;
      if (id === enterId) {
        el.animate([{ opacity: 0, scale: '0.6' }, { opacity: 1, scale: '1' }], { duration: PIN_ENTER_MS, easing: PIN_ENTER_EASING });
        return;
      }
      const was = before.get(id);
      if (!was) return;
      const now = where(el, list1);
      const dx = was.x - now.x;
      const dy = was.y - now.y;
      if (Math.hypot(dx, dy) < 0.5) return;
      el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }], options);
    });
    if (ghost && dock.isConnected) {
      const { node } = ghost;
      // A picture only: none of the pin's hooks (tests and the viewer look
      // pins up by their data- attributes) or names.
      [node, ...node.querySelectorAll('*')].forEach((el) => {
        [...el.attributes].forEach(({ name }) => {
          if (name.startsWith('data-') || name.startsWith('aria-') || name === 'role') el.removeAttribute(name);
        });
      });
      node.setAttribute('aria-hidden', 'true');
      node.inert = true;
      node.dataset.pinLeaving = 'true';
      node.style.cssText = `position:absolute;left:${ghost.left}px;top:${ghost.top}px;margin:0;pointer-events:none;z-index:1`;
      dock.appendChild(node);
      const leave = node.animate(
        [{ opacity: 1, scale: '1' }, { opacity: 0, scale: '0.6' }],
        { duration: PIN_LEAVE_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
      );
      leave.finished.catch(() => undefined).then(() => node.remove());
    }
    return result;
  };

  const addPin = (kindId, style) => {
    closeMenu();
    const pin = animateDock(() => store.addPin(makePin(kindId, style)));
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
    closeMenu();
    animateDock(() => { store.removePin(pinId); }, { leavingId: pinId });
  };

  const duplicate = (pin) => {
    const index = pins.findIndex((entry) => entry.id === pin.id);
    closeMenu();
    animateDock(() => store.addPin(makePin(pin.kind, pin.style), index + 1));
  };

  // A pin behind "+N" cannot be dragged into view: its menu moves it first.
  const moveToStart = (pin) => {
    closeMenu();
    flipPins(() => store.movePin(pin.id, 0));
  };

  // --- dock drag (grip) -----------------------------------------------------
  // walkthu's favourite-tools dock, move for move (owner 2026-11-12: "much
  // smoother in Walkthu"; frame captures in the PR):
  // - Pressed and moved 6px, the dock lifts (1.1x; 0.95x from the bottom) and
  //   a dim veil with the three drop zones fades in. Its tools stay as they
  //   are: nothing folds away or fades out as it lifts.
  // - The grip stays under the pointer, except that the zone the dock would
  //   land in pulls it in (magnetPull): nothing at the middle of the page
  //   area, most of the way at the edge. Anything that moves the dock other
  //   than the pointer (the magnet, its grip shifting as it reshapes) is eased
  //   in over CARRY_EASE_MS, so it never jumps a frame.
  // - Its box is an explicit size that eases over 320ms (walkthu's morph):
  //   over a zone it takes that zone's shape (a column at the sides, a row at
  //   the bottom), and a long dock shrinks to CARRIED_DOCK_SLOTS pins long
  //   while carried (owner 2026-10-27, 17 pins). The tools stay in sight;
  //   the box only clips them.
  // - Every frame it is kept inside the page area.
  // - Let go, the same box glides home (240-320ms by distance) and eases to
  //   its docked length on the way; the veil fades.
  const dockDragRef = useRef(null);
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
      shown: null,
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
          setDockDrag({ target });
        }
        const pull = magnetPull(free, target, area.width, area.height, homeOf(target));
        tx += pull.x;
        ty += pull.y;
        // Ease in whatever the pointer did not do (see CARRY_EASE_MS).
        const now = performance.now();
        if (drag.shown) {
          const dt = Math.max(0, now - drag.shown.t);
          const k = 1 - Math.exp(-dt / CARRY_EASE_MS);
          const px = drag.shown.x + (drag.lastX - drag.shown.px);
          const py = drag.shown.y + (drag.lastY - drag.shown.py);
          let cx = (tx - px) * k;
          let cy = (ty - py) * k;
          // A big catch-up (the grip crossing the dock as it turns from a row
          // to a column) moves no faster than walkthu's morph does.
          const most = CARRY_CATCH_UP_PX_PER_MS * dt;
          const length = Math.hypot(cx, cy);
          if (length > most) {
            cx *= most / length;
            cy *= most / length;
          }
          tx = px + cx;
          ty = py + cy;
        }
        const left = baseX + tx - (w * s) / 2;
        const top = baseY + ty - (h * s) / 2;
        tx += Math.max(0, area.left + 1 - left) - Math.max(0, left + w * s - (area.left + area.width - 1));
        ty += Math.max(0, area.top + 1 - top) - Math.max(0, top + h * s - (area.top + area.height - 1));
        drag.shown = { x: tx, y: ty, px: drag.lastX, py: drag.lastY, t: now };
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
        // It lifts from where it sits: translate 0 with the pointer at its
        // press point, so the first frames ease the grip under the pointer.
        drag.shown = { x: 0, y: 0, px: drag.startX, py: drag.startY, t: performance.now() };
        dock.style.transformOrigin = 'center';
        // Its box, fixed at the size it is now; the morph eases it from here.
        dock.style.width = `${dock.offsetWidth}px`;
        dock.style.height = `${dock.offsetHeight}px`;
        dock.style.transition = prefersReducedMotion() ? 'none' : LIFT_SCALE_TRANSITION;
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
      const box = { width: dock.offsetWidth, height: dock.offsetHeight, vertical: dock.classList.contains('is-vertical') };
      // Let go before the drop target was reached (or cancelled): the dock
      // goes home in its old shape, which the carried box may not have.
      const snap = snapshotDock(dock);
      dock.style.transition = 'none';
      dock.style.removeProperty('translate');
      dock.style.removeProperty('width');
      dock.style.removeProperty('height');
      dock.style.scale = '1';
      flushSync(() => {
        setDockDrag(null);
        setZonesLeaving(true);
        if (drop && drag.target) store.setPlacement(drag.target);
      });
      glideHome(dock, from, drag.root, box, drag.scale, snap);
    };
    const up = (ev) => finish(ev, true);
    const cancel = (ev) => finish(ev, false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  // The carried box takes its new size: the dock's natural size in the shape
  // it has now, no longer than CARRIED_DOCK_SLOTS pins. Its explicit width and
  // height ease there from wherever they are (a CSS transition, as walkthu's
  // dock), its tools reflowing inside it at once, clipped, never faded.
  useLayoutEffect(() => {
    const drag = dockDragRef.current;
    const dock = dockRef.current;
    const list = listRef.current;
    if (!drag || !dock || !list) return;
    const vertical = dock.classList.contains('is-vertical');
    const current = getComputedStyle(dock);
    const fromWidth = current.width;
    const fromHeight = current.height;
    // Measured with only the lift's scale easing, so that keeps running.
    dock.style.transition = prefersReducedMotion() ? 'none' : LIFT_SCALE_TRANSITION;
    dock.style.removeProperty('width');
    dock.style.removeProperty('height');
    const natural = { width: dock.offsetWidth, height: dock.offsetHeight };
    const listLength = vertical ? list.offsetHeight : list.offsetWidth;
    const own = (vertical ? natural.height : natural.width) - listLength;
    const slot = PIN_SIZE_PX + PIN_GAP_PX;
    const longest = own + CARRIED_DOCK_SLOTS * slot - PIN_GAP_PX;
    const size = vertical
      ? { width: natural.width, height: Math.min(natural.height, longest) }
      : { width: Math.min(natural.width, longest), height: natural.height };
    dock.style.width = fromWidth;
    dock.style.height = fromHeight;
    void dock.offsetWidth;
    dock.style.transition = prefersReducedMotion()
      ? 'none'
      : `width ${DOCK_MORPH_MS}ms ${DOCK_MORPH_EASING}, height ${DOCK_MORPH_MS}ms ${DOCK_MORPH_EASING}, ${LIFT_SCALE_TRANSITION}`;
    dock.style.width = `${size.width}px`;
    dock.style.height = `${size.height}px`;
    drag.place();
  }, [dockDrag?.target, Boolean(dockDrag)]);

  // The veil fades out after the drop rather than vanishing.
  const [zonesLeaving, setZonesLeaving] = useState(false);
  useEffect(() => {
    if (!zonesLeaving) return undefined;
    const timer = window.setTimeout(() => setZonesLeaving(false), prefersReducedMotion() ? 0 : ZONES_FADE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [zonesLeaving]);

  // The dock as drawn now (its tools in their current shape), for the morph.
  const snapshotDock = (dock) => (dock ? { clone: dock.cloneNode(true), width: dock.offsetWidth, height: dock.offsetHeight } : null);

  // Shape change (owner 2026-11-09: "buttery smooth ... every permutation").
  // Growing the real dock's box from a column to a row reflowed its tools at
  // once and, anchored by its shell, swung through the middle of the page.
  // Instead a stand-in box with the dock's own look glides and reshapes from
  // where the dock was to where it lands, the old tools fading out and the
  // new ones fading in at its centre; then the real dock, already in place,
  // takes over on the same pixels.
  const morphInto = (dock, from, to, area, snap, done) => {
    const host = shellRef.current?.parentElement;
    if (!host || typeof dock.animate !== 'function' || !(snap?.width > 0) || !(snap?.height > 0)) return false;
    const hostRect = host.getBoundingClientRect();
    const clampTo = (value, min, max) => (max < min ? value : Math.min(max, Math.max(min, value)));
    const cx = area ? clampTo(from.left + from.width / 2, area.left + from.width / 2, area.left + area.width - from.width / 2) : from.left + from.width / 2;
    const cy = area ? clampTo(from.top + from.height / 2, area.top + from.height / 2, area.top + area.height - from.height / 2) : from.top + from.height / 2;
    const box = (left, top, width, height) => ({
      left: `${left - hostRect.left}px`, top: `${top - hostRect.top}px`, width: `${width}px`, height: `${height}px`,
    });
    const start = box(cx - from.width / 2, cy - from.height / 2, from.width, from.height);
    const end = box(to.left, to.top, to.width, to.height);
    const layer = (node, width, height, scale) => {
      node.removeAttribute('id');
      node.setAttribute('aria-hidden', 'true');
      node.inert = true;
      node.className = `${node.className} pinned-dock-morph__layer`;
      node.style.cssText = `width:${width}px;height:${height}px;scale:${scale}`;
      return node;
    };
    const oldLayer = layer(snap.clone, snap.width, snap.height, Math.min(from.width / snap.width, from.height / snap.height));
    const newLayer = layer(dock.cloneNode(true), dock.offsetWidth, dock.offsetHeight, 1);
    const plate = document.createElement('div');
    plate.className = 'pinned-dock-morph';
    plate.setAttribute('aria-hidden', 'true');
    plate.dataset.pinnedDockMorph = 'true';
    Object.assign(plate.style, start);
    plate.append(oldLayer, newLayer);
    host.appendChild(plate);
    dock.style.opacity = '0';
    const duration = Math.max(DOCK_MORPH_MIN_MS, dropDurationMs(from, to));
    const options = { duration, easing: SETTLE_EASING, fill: 'forwards' };
    plate.animate([start, end], options);
    oldLayer.animate([{ opacity: 1 }, { opacity: 0, offset: 0.55 }, { opacity: 0 }], options);
    newLayer.animate([{ opacity: 0 }, { opacity: 0, offset: 0.25 }, { opacity: 1 }], options);
    let finished = false;
    const timer = window.setTimeout(() => finish(), duration + 20);
    function finish() {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      plate.remove();
      dock.style.removeProperty('opacity');
      done();
    }
    settleCleanupRef.current = finish;
    return true;
  };

  // A carried dock let go: the same box glides from where it was let go to
  // its docked place, scale easing from the lift's back to 1 and its size
  // from the carried box to the docked one (walkthu's 240-320ms drop). The
  // start is kept inside the page area, so a dock let go half off an edge does
  // not swing in from outside. Only a dock let go in another shape than it
  // lands in (dropped before reaching a zone, or a cancelled drag) morphs
  // through a stand-in instead.
  const glideHome = (dock, from, area, box, scale, snap) => {
    const vertical = dock.classList.contains('is-vertical');
    if (box.vertical !== vertical) {
      settleInto(dock, from, area, snap);
      return;
    }
    const clear = () => {
      dock.style.removeProperty('transition');
      dock.style.removeProperty('translate');
      dock.style.removeProperty('scale');
      dock.style.removeProperty('transform-origin');
      dock.style.removeProperty('overflow');
      settleCleanupRef.current = null;
    };
    const to = dock.getBoundingClientRect();
    if (prefersReducedMotion() || typeof dock.animate !== 'function' || !(from.width > 0) || !(to.width > 0)) {
      clear();
      return;
    }
    const clampTo = (value, min, max) => (max < min ? value : Math.min(max, Math.max(min, value)));
    const fromX = clampTo(from.left + from.width / 2, area.left + from.width / 2, area.left + area.width - from.width / 2);
    const fromY = clampTo(from.top + from.height / 2, area.top + from.height / 2, area.top + area.height - from.height / 2);
    const dx = fromX - (to.left + to.width / 2);
    const dy = fromY - (to.top + to.height / 2);
    const duration = dropDurationMs(from, to);
    const options = { duration, easing: SETTLE_EASING };
    dock.style.transformOrigin = 'center';
    const animations = [
      dock.animate([{ translate: `${dx}px ${dy}px`, scale: String(scale) }, { translate: '0px 0px', scale: '1' }], options),
    ];
    if (Math.abs(box.width - to.width) > 0.5 || Math.abs(box.height - to.height) > 0.5) {
      dock.style.overflow = 'hidden';
      animations.push(dock.animate(
        [{ width: `${box.width}px`, height: `${box.height}px` }, { width: `${to.width}px`, height: `${to.height}px` }],
        options,
      ));
    }
    let done = false;
    const timer = window.setTimeout(() => finishGlide(), duration + 80);
    Promise.all(animations.map((animation) => animation.finished)).then(() => finishGlide(), () => {});
    function finishGlide() {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      animations.forEach((animation) => animation.cancel());
      clear();
    }
    settleCleanupRef.current = finishGlide;
  };

  // FLIP: start the docked box where the dragged one was and glide it home.
  // The start is kept inside the page area (`area`), so a dock let go half
  // off an edge does not swing in from outside.
  const settleInto = (dock, from, area = null, snap = null) => {
    const clear = () => {
      dock.style.removeProperty('transition');
      dock.style.removeProperty('transform');
      dock.style.removeProperty('translate');
      dock.style.removeProperty('scale');
      dock.style.removeProperty('transform-origin');
      dock.style.removeProperty('overflow');
      settleCleanupRef.current = null;
    };
    const to = dock.getBoundingClientRect();
    if (prefersReducedMotion() || !(from.width > 0) || !(to.width > 0)) {
      clear();
      return;
    }
    const sx = from.width / to.width;
    const sy = from.height / to.height;
    // A dock that unfolds as it lands (carried small, docked long) grows its
    // box from the carried size instead of stretching its pins.
    const unfolds = typeof dock.animate === 'function'
      && (Math.abs(from.width - to.width) > 1 || Math.abs(from.height - to.height) > 1)
      && Math.abs(sx - sy) > 0.03;
    // A change of shape (column <-> row, or a longer or shorter dock) morphs
    // a stand-in box instead, its old and new tools crossfading inside it.
    if (unfolds && snap && morphInto(dock, from, to, area, snap, clear)) return;
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
    if (unfolds) {
      dock.style.overflow = 'hidden';
      dock.animate(
        [{ width: `${from.width}px`, height: `${from.height}px` }, { width: `${to.width}px`, height: `${to.height}px` }],
        { duration, easing: SETTLE_EASING },
      );
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
    const snap = snapshotDock(dock);
    flushSync(() => store.setPlacement(next));
    if (dock && from) settleInto(dock, from, null, snap);
  };

  // --- pin drag (reorder) ---------------------------------------------------
  // The pin lifts and follows the pointer along the dock; the others slide
  // aside to open its slot (rather than a line marking it), and on release it
  // glides into that slot. Alt+arrows move it a slot with the same glide.
  // `mutate` runs the reorder; every pin then glides from where it was drawn
  // (the dropped one also eases back from its lifted 1.08x).
  const flipPins = (mutate, liftedId = null) => {
    const list = listRef.current;
    const slotsNow = () => (list ? [...list.querySelectorAll('[data-pin-slot]')] : []);
    const before = new Map();
    slotsNow().forEach((el) => {
      before.set(el.dataset.pinSlot, el.getBoundingClientRect());
      // The slide-aside easing must not run again as the pins take their new
      // order: it did, and every pin that had slid aside jumped back a slot
      // for a frame before gliding on (seen frame by frame, 2026-11-12).
      el.style.transition = 'none';
    });
    flushSync(mutate);
    const after = slotsNow();
    after.forEach((el) => {
      const was = before.get(el.dataset.pinSlot);
      if (!was || prefersReducedMotion() || typeof el.animate !== 'function') return;
      const now = el.getBoundingClientRect();
      const dx = (was.left + was.width / 2) - (now.left + now.width / 2);
      const dy = (was.top + was.height / 2) - (now.top + now.height / 2);
      const lifted = el.dataset.pinSlot === liftedId;
      if (Math.hypot(dx, dy) < 0.5 && !lifted) return;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)${lifted ? ' scale(1.08)' : ''}` }, { transform: 'translate(0px, 0px)' }],
        { duration: PIN_SLIDE_MS, easing: SETTLE_EASING },
      );
    });
    after.forEach((el) => el.style.removeProperty('transition'));
  };

  // The lifted pin follows the pointer straight from the pointer event (no
  // render per move); the dock re-renders only when the slot it would land
  // in changes, to slide the others aside.
  const pinDragOffsetRef = useRef(0);
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
    const axis = vertical ? 'translateY' : 'translateX';
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
        target = -1;
      }
      // A long dock scrolls under the pin: measure in its scrolled frame.
      const sx = list.scrollLeft - scroll0.x;
      const sy = list.scrollTop - scroll0.y;
      const next = reorderIndexAt({ x: ev.clientX + sx, y: ev.clientY + sy }, rects, vertical);
      pinDragOffsetRef.current = vertical ? dy + sy : dx + sx;
      if (slotEl) slotEl.style.transform = `${axis}(${pinDragOffsetRef.current}px) scale(1.08)`;
      if (next !== target) {
        target = next;
        setPinDrag({ pinId, index: target, slot });
      }
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
      }, pinId);
      if (slotEl) slotEl.style.removeProperty('transform');
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
  if (!visible && !leaving) {
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
    if (pin.id === pinDrag.pinId) return { transform: `${axis}(${pinDragOffsetRef.current}px) scale(1.08)` };
    const shift = reorderShift(index, draggedIndex, pinDrag.index);
    return shift ? { transform: `${axis}(${shift * pinDrag.slot}px)` } : undefined;
  };

  // How many pins the dock shows (the phone's row scrolls under a finger).
  const carried = Boolean(dockDrag);
  const slotLength = (phone ? PHONE_PIN_SIZE_PX : PIN_SIZE_PX) + PIN_GAP_PX;
  let slots = phone ? Infinity : slotsThatFit(room, slotLength, PIN_GAP_PX);
  if (!phone && state.compact) slots = Math.min(slots, COMPACT_DOCK_SLOTS);
  // Carried, it keeps the pins it shows docked: its box clips a long one to
  // CARRIED_DOCK_SLOTS pins instead (the morph above), so nothing reflows as
  // it lifts.
  const shown = visiblePinCount(pins.length, slots);
  const hidden = pins.slice(shown);
  const armedPin = session ? pins.find((pin) => pin.id === session.pinId && activeTool === pinKind(pin.kind)?.tool) : null;
  const armedHidden = armedPin && hidden.includes(armedPin) ? armedPin : null;

  const renderPin = (pin, index, { inMenu = false } = {}) => {
    const kind = pinKind(pin.kind);
    const color = pinFaceColor(pin);
    const badge = pinBadge(pin);
    const description = pinDescription(pin);
    const pressed = armedPin === pin;
    return (
      <div
        key={pin.id}
        className={`pinned-dock__slot${pinDrag?.pinId === pin.id ? ' is-dragged' : ''}`}
        data-pin-slot={inMenu ? undefined : pin.id}
        style={inMenu ? undefined : slotStyle(pin, index)}
      >
        <button
          type="button"
          className={`btn chrome-subcontrol pinned-dock__pin ${pressed ? 'btn-active' : 'btn-ghost'}`}
          role={inMenu ? 'menuitem' : undefined}
          aria-pressed={inMenu ? undefined : pressed}
          aria-current={inMenu && pressed ? 'true' : undefined}
          aria-label={`Pinned ${description}`}
          aria-keyshortcuts={inMenu ? undefined : 'Alt+ArrowUp Alt+ArrowDown'}
          data-pinned-tool={pin.kind}
          data-pin-id={pin.id}
          data-pin-color={color || undefined}
          data-pin-width={badge || undefined}
          data-pin-armed={pressed ? 'true' : undefined}
          data-tool-switch="true"
          {...withOwnHandlers(bindTip(pinTipText(description, index, phone), inMenu ? 'above' : tipSide), inMenu ? {} : {
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
            if (inMenu) closeMenu();
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
  };

  // The last slot when the pins do not all fit: "+N", or the armed pin's
  // glyph when the armed one is among them. It opens them as a grid.
  const moreLabel = `${hidden.length} more pinned tool${hidden.length === 1 ? '' : 's'}`;
  const moreButton = hidden.length ? (
    <div className="pinned-dock__slot">
      <button
        type="button"
        className={`btn chrome-subcontrol pinned-dock__pin pinned-dock__more ${armedHidden || menu?.kind === 'more' ? 'btn-active' : 'btn-ghost'}`}
        aria-label={armedHidden ? `${moreLabel}; ${pinDescription(armedHidden)} is in use` : moreLabel}
        aria-haspopup="menu"
        aria-expanded={menu?.kind === 'more'}
        aria-pressed={armedHidden ? true : undefined}
        data-pinned-tools-more={hidden.length}
        {...bindTip(armedHidden ? `${pinDescription(armedHidden)} and ${hidden.length - 1} more` : moreLabel, tipSide)}
        onClick={(event) => openMenu('more', event.currentTarget)}
      >
        {armedHidden ? (
          <>
            <PinGlyph kindId={armedHidden.kind} color={pinFaceColor(armedHidden)} />
            <span className="pinned-dock__badge" aria-hidden="true">+{hidden.length}</span>
          </>
        ) : (
          <span className="pinned-dock__count" aria-hidden="true">+{hidden.length}</span>
        )}
      </button>
    </div>
  ) : null;

  return (
    <>
      {zones}
      <div ref={shellRef} className={`pinned-dock-shell is-${placement}${phone ? ' is-phone' : ''}`} data-pinned-dock-shell={placement}>
        <div
          ref={dockRef}
          className={`pinned-dock ${vertical ? 'is-vertical' : 'is-horizontal'}${carried ? ' is-dragging' : ''}${pinDrag ? ' is-reordering' : ''}${leaving ? ' is-leaving' : ''}`}
          role="toolbar"
          aria-label="Pinned tools"
          aria-orientation={vertical ? 'vertical' : 'horizontal'}
          data-pinned-tools-dock="true"
          data-placement={placement}
          data-pins-shown={shown}
        >
          <div ref={listRef} className="pinned-dock__pins">
            {pins.slice(0, shown).map((pin, index) => renderPin(pin, index))}
            {moreButton}
          </div>
          {/* Carried, it keeps its own buttons too (walkthu's does): taking
              them away as it lifts made its tools jump. */}
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
          hiddenPins={hidden}
          renderPin={renderPin}
          compact={state.compact}
          pinSet={state.pinSet}
          editing={editing}
          currentKind={currentKind}
          onPinCurrent={pinCurrent}
          onAdd={(kindId) => addPin(kindId, startingStyleFor(apiRef.current, sessionRef.current, kindId))}
          onUnpin={unpin}
          onDuplicate={duplicate}
          onMoveToStart={moveToStart}
          onPlacement={(next) => {
            closeMenu();
            const dock = dockRef.current;
            const from = dock?.getBoundingClientRect();
            const snap = snapshotDock(dock);
            flushSync(() => store.setPlacement(next));
            if (dock && from) settleInto(dock, from, null, snap);
          }}
          onToggleCompact={() => {
            closeMenu();
            const dock = dockRef.current;
            const from = dock?.getBoundingClientRect();
            const snap = snapshotDock(dock);
            flushSync(() => store.setCompact(!state.compact));
            if (dock && from) settleInto(dock, from, null, snap);
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
  menuRef, menu, placement, phone, pins, hiddenPins, renderPin, compact, pinSet, editing, currentKind, onPinCurrent, onAdd,
  onUnpin, onDuplicate, onMoveToStart, onPlacement, onToggleCompact, onToggleEditing, onHide, api,
}) {
  // The picker's search words; a fresh picker starts empty.
  const [query, setQuery] = useState('');
  useEffect(() => { if (menu.kind !== 'add') setQuery(''); }, [menu.kind]);
  // The "+N" grid: five pins a row, each the dock's own pin button.
  const moreColumns = Math.min(5, Math.max(1, hiddenPins.length));
  const width = menu.kind === 'add' ? 264 : menu.kind === 'more' ? moreColumns * 34 + 10 : 200;
  const style = { ...menuPosition(menu.rect, placement, width), width };
  // A menu above a bottom dock slides up into place (motion.css), not down.
  const side = placement === 'bottom' ? 'top' : undefined;
  if (menu.kind === 'more') {
    if (!hiddenPins.length) return null;
    const first = pins.length - hiddenPins.length;
    return (
      <div
        ref={menuRef}
        role="menu"
        aria-label="More pinned tools"
        className="pinned-dock-menu pinned-dock-menu--pins"
        style={{ ...style, gridTemplateColumns: `repeat(${moreColumns}, 32px)` }}
        data-pinned-tools-more-menu="true" data-side={side}
      >
        {hiddenPins.map((pin, index) => renderPin(pin, first + index, { inMenu: true }))}
      </div>
    );
  }
  if (menu.kind === 'pin') {
    const pin = pins.find((entry) => entry.id === menu.pinId);
    if (!pin) return null;
    return (
      <div ref={menuRef} role="menu" aria-label={`Pinned ${pinDescription(pin)}`} className="pinned-dock-menu" style={style} data-pinned-tools-pin-menu="true" data-side={side}>
        <button type="button" role="menuitem" onClick={() => onDuplicate(pin)}>
          <Icon name="duplicate" size={14} color="currentColor" /><span>Duplicate</span>
        </button>
        {pins[0]?.id === pin.id ? null : (
          <button type="button" role="menuitem" data-pin-move-first="true" onClick={() => onMoveToStart(pin)}>
            <Icon name="chevronUp" size={14} color="currentColor" /><span>Move to start</span>
          </button>
        )}
        <button type="button" role="menuitem" className="is-danger" onClick={() => onUnpin(pin.id)}>
          <Icon name="close" size={14} color="currentColor" /><span>Unpin</span>
        </button>
      </div>
    );
  }
  if (menu.kind === 'settings') {
    return (
      <div ref={menuRef} role="menu" aria-label="Pinned tools menu" className="pinned-dock-menu" style={style} data-pinned-tools-settings="true" data-side={side}>
        {pinSet === 'survey' ? (
          <p className="pinned-dock-menu__note" data-pin-set-note="survey">Survey pins: these show only in Survey mode.</p>
        ) : null}
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
            <button type="button" role="menuitemcheckbox" aria-checked={compact} onClick={onToggleCompact} data-pinned-tools-compact="true">
              <span className="pinned-dock-menu__check">{compact ? <Icon name="check" size={14} color="currentColor" /> : null}</span>
              <span>Compact dock ({COMPACT_DOCK_SLOTS} slots)</span>
            </button>
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
  const found = matchPinKinds(query);
  const searching = query.trim().length > 0;
  const currentStyle = currentKind && typeof api?.readToolStyle === 'function'
    ? api.readToolStyle(currentKind.tool, currentKind.lineStyle)
    : null;
  const currentPreview = currentKind ? makePin(currentKind.id, { ...currentStyle, lineStyle: currentKind.lineStyle || api?.lineBorderStyle }, 'preview') : null;
  return (
    <div ref={menuRef} role="menu" aria-label="Pin a tool" className="pinned-dock-menu is-picker" style={style} data-pinned-tools-picker="true" data-side={side}>
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
      {/* Drawboard's add-tool sheet has a search: type a name ("circle",
          "cloud", "note") and Enter pins the first match. Not focused on a
          phone, so the keyboard only comes up when asked for. */}
      <div className="pinned-dock-menu__search">
        <Icon name="search" size={14} color="currentColor" />
        <input
          type="search"
          value={query}
          placeholder="Find a tool"
          aria-label="Find a tool"
          data-pin-search="true"
          autoFocus={!phone}
          enterKeyHint="done"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && searching && found.length) {
              event.preventDefault();
              onAdd(found[0].id);
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              menuRef.current?.querySelector('[data-pin-kind]')?.focus();
            }
          }}
        />
      </div>
      {searching && !found.length ? (
        <p className="pinned-dock-menu__note" data-pin-search-empty="true">No tool matches “{query.trim()}”.</p>
      ) : null}
      {groups.map((group) => {
        const kinds = found.filter((kind) => kind.group === group);
        if (!kinds.length) return null;
        return (
        <div key={group} role="group" aria-label={group}>
          <div className="pinned-dock-menu__heading">{group}</div>
          <div className="pinned-dock-menu__grid">
            {kinds.map((kind) => (
              <button key={kind.id} type="button" role="menuitem" data-pin-kind={kind.id} onClick={() => onAdd(kind.id)}>
                <Icon name={kind.iconName} size={16} color="currentColor" />
                <span>{kind.label}</span>
              </button>
            ))}
          </div>
        </div>
        );
      })}
    </div>
  );
}
