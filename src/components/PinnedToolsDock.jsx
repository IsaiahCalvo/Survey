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
 * - Drag a pin along the dock to reorder it (mouse or pen); Alt+arrows from
 *   the keyboard. Right-click a pin to duplicate or unpin it; "Edit pins" in
 *   the dock's menu shows a remove mark on each for touch.
 * - Drag the grip to dock it left, right or bottom; drop zones show while you
 *   drag and the dock glides into place (walkthu's favourite-tools dock).
 *   Arrow keys on the grip move it too.
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
  makePin,
  pinBadge,
  pinDescription,
  pinFaceColor,
  pinKind,
  pinKindForTool,
  reorderIndexAt,
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

export function PinIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4h6l-1 6 3 3H7l3-3-1-6Z" />
      <path d="M12 13v7" />
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

export default function PinnedToolsDock({ api, tip, store: suppliedStore }) {
  const store = suppliedStore || getPinnedToolsStore();
  const state = usePinnedTools(store);
  const { placement, pins, visible } = state;
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
  // The grip stays under the pointer while the dock is carried (it is lifted
  // a little: 1.1x, 0.95x from the bottom). Over a drop zone the dock already
  // takes that zone's shape (a column at the sides, a row at the bottom), as
  // walkthu's does, so the drop only has to glide it into place.
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
      scale: prefersReducedMotion() ? 1 : (placement === 'bottom' ? 0.95 : 1.1),
    };
    // Where the dock must move so its grip sits under the pointer.
    drag.place = () => {
      const grip = dock.querySelector('[data-pinned-tools-grip]');
      if (!grip) return;
      const shellRect = shell.getBoundingClientRect();
      const w = dock.offsetWidth;
      const h = dock.offsetHeight;
      const s = drag.activated ? drag.scale : 1;
      const gx = grip.offsetLeft + grip.offsetWidth / 2 - w / 2;
      const gy = grip.offsetTop + grip.offsetHeight / 2 - h / 2;
      const tx = drag.lastX - drag.grabX - (shellRect.left + dock.offsetLeft + w / 2 + s * gx);
      const ty = drag.lastY - drag.grabY - (shellRect.top + dock.offsetTop + h / 2 + s * gy);
      dock.style.translate = `${tx}px ${ty}px`;
    };
    drag.retarget = () => {
      const rect = dock.getBoundingClientRect();
      const target = chooseDockPlacement({
        left: rect.left - drag.root.left,
        right: rect.right - drag.root.left,
        bottom: rect.bottom - drag.root.top,
      }, drag.root.width, drag.root.height, drag.target);
      if (target !== drag.target) {
        drag.target = target;
        setDockDrag({ target });
      }
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
      }
      drag.place();
      drag.retarget();
    };
    const finish = (ev, drop) => {
      if (ev.pointerId !== drag.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      dockDragRef.current = null;
      if (!drag.activated) return;
      const from = dock.getBoundingClientRect();
      dock.style.transition = 'none';
      dock.style.removeProperty('translate');
      dock.style.scale = '1';
      flushSync(() => {
        setDockDrag(null);
        if (drop && drag.target) store.setPlacement(drag.target);
      });
      settleInto(dock, from);
    };
    const up = (ev) => finish(ev, true);
    const cancel = (ev) => finish(ev, false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  // The dock changed shape under the pointer: put its grip back under it.
  useLayoutEffect(() => {
    const drag = dockDragRef.current;
    if (!drag) return;
    drag.place();
  }, [dockDrag?.target]);

  // FLIP: start the docked box where the dragged one was and glide it home.
  const settleInto = (dock, from) => {
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
    const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
    const dy = (from.top + from.height / 2) - (to.top + to.height / 2);
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
  const onPinPointerDown = (event, pin, index) => {
    if (event.button !== 0 || event.pointerType === 'touch' || editing) return;
    const list = listRef.current;
    if (!list) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let activated = false;
    let target = index;
    const pinId = pin.id;
    const rects = () => [...list.querySelectorAll('[data-pin-slot]')]
      .filter((el) => el.dataset.pinSlot !== pinId)
      .map((el) => el.getBoundingClientRect());
    const move = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!activated) {
        if (Math.abs(vertical ? dy : dx) < DRAG_START_PX) return;
        activated = true;
      }
      target = reorderIndexAt({ x: ev.clientX, y: ev.clientY }, rects(), vertical);
      setPinDrag({ pinId, index: target, offset: vertical ? dy : dx });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!activated) return;
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      setPinDrag(null);
      store.movePin(pinId, target);
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
    store.movePin(pin.id, Math.max(0, Math.min(pins.length - 1, index + delta)));
    const id = pin.id;
    window.requestAnimationFrame(() => listRef.current?.querySelector(`[data-pin-slot="${CSS.escape(id)}"] button`)?.focus());
  };

  // Keep the reordered pin visible inside a long, scrolling dock.
  useLayoutEffect(() => {
    if (!pinDrag) return;
    const el = listRef.current?.querySelector(`[data-pin-slot="${CSS.escape(pinDrag.pinId)}"]`);
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [pinDrag]);

  if (!visible || !api) return null;

  const session = sessionRef.current;
  const activeTool = api.activeTool;

  const zones = dockDrag ? (
    <div className="pinned-dock-zones" aria-hidden="true" data-pinned-dock-zones="true">
      {['left', 'right', 'bottom'].map((zone) => (
        <div
          key={zone}
          className={`pinned-dock-zone is-${zone}${dockDrag.target === zone ? ' is-target' : ''}`}
          data-pinned-dock-zone={zone}
          data-active={dockDrag.target === zone ? 'true' : 'false'}
        />
      ))}
    </div>
  ) : null;

  // The insertion line while a pin is dragged along the dock.
  const dropLine = pinDrag ? pinDrag.index : null;
  const draggedIndex = pinDrag ? pins.findIndex((pin) => pin.id === pinDrag.pinId) : -1;

  return (
    <>
      {zones}
      <div ref={shellRef} className={`pinned-dock-shell is-${placement}`} data-pinned-dock-shell={placement}>
        <div
          ref={dockRef}
          className={`pinned-dock ${vertical ? 'is-vertical' : 'is-horizontal'}${dockDrag ? ' is-dragging' : ''}`}
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
              // Index among the pins other than the dragged one.
              const slotIndex = draggedIndex >= 0 && index > draggedIndex ? index - 1 : index;
              const showLineBefore = dropLine != null && pin.id !== pinDrag.pinId && slotIndex === dropLine;
              return (
                <div
                  key={pin.id}
                  className={`pinned-dock__slot${pinDrag?.pinId === pin.id ? ' is-dragged' : ''}${showLineBefore ? ' has-drop-line' : ''}`}
                  data-pin-slot={pin.id}
                  style={pinDrag?.pinId === pin.id
                    ? { transform: vertical ? `translateY(${pinDrag.offset}px)` : `translateX(${pinDrag.offset}px)` }
                    : undefined}
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
                    onClick={() => {
                      if (suppressClickRef.current) return;
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
            {dropLine != null && dropLine >= pins.length - 1 && draggedIndex >= 0 ? (
              <span className="pinned-dock__end-line" aria-hidden="true" />
            ) : null}
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
        </div>
      </div>
      {menu ? createPortal(
        <PinnedToolsMenu
          menuRef={menuRef}
          menu={menu}
          placement={placement}
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
  menuRef, menu, placement, pins, editing, currentKind, onPinCurrent, onAdd, onUnpin, onDuplicate,
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
        <div className="pinned-dock-menu__heading">Dock</div>
        {[['left', 'Left'], ['bottom', 'Bottom'], ['right', 'Right']].map(([value, label]) => (
          <button key={value} type="button" role="menuitemradio" aria-checked={placement === value} onClick={() => onPlacement(value)}>
            <span className="pinned-dock-menu__check">{placement === value ? <Icon name="check" size={14} color="currentColor" /> : null}</span>
            <span>{label}</span>
          </button>
        ))}
        <div className="pinned-dock-menu__rule" />
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
